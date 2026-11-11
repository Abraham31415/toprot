import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Flutterwave v3 (https://developer.flutterwave.com/v3.0). Server-side only. Credentials come from the environment and
// are never logged or sent to the browser. Every network call takes an injectable fetch so it can be tested offline.
//
//  Create a hosted checkout:   POST {base}/payments                      -> data.link
//  Verify a transaction:       GET  {base}/transactions/{id}/verify      -> data.{status, tx_ref, amount, currency}
//  Verify by our reference:    GET  {base}/transactions/verify_by_reference?tx_ref=...
//  Webhooks:                   header `verif-hash` must equal the secret hash set in the Flutterwave dashboard.

export type FlwConfig = {
  secretKey: string;
  /** The "secret hash" configured for webhooks in the dashboard. Without it the webhook endpoint refuses everything. */
  webhookHash: string | null;
  baseUrl: string;
  mode: "test" | "live";
  /** Live keys are refused unless BILLING_LIVE_ENABLED=true, so a live key cannot be used by accident. */
  liveEnabled: boolean;
};

export function loadFlwConfig(env: Record<string, string | undefined> = process.env): FlwConfig | null {
  const secretKey = env.FLW_SECRET_KEY?.trim();
  if (!secretKey) return null;
  return {
    secretKey,
    webhookHash: env.FLW_WEBHOOK_HASH?.trim() || null,
    baseUrl: (env.FLW_BASE_URL?.trim() || "https://api.flutterwave.com/v3").replace(/\/$/, ""),
    mode: /^FLWSECK_TEST/i.test(secretKey) ? "test" : "live",
    liveEnabled: env.BILLING_LIVE_ENABLED === "true",
  };
}

/** Whether checkout may be offered, and if not, a message that is safe to show. */
export function checkoutReady(cfg: FlwConfig | null): { ok: true } | { ok: false; message: string } {
  if (!cfg) return { ok: false, message: "Payments are not switched on yet." };
  if (!cfg.webhookHash) return { ok: false, message: "Payments are not fully set up yet." };
  if (cfg.mode === "live" && !cfg.liveEnabled) return { ok: false, message: "Payments are not open yet." };
  return { ok: true };
}

export const newTxRef = () => `toprot-${randomUUID()}`;

export class FlwError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
    this.name = "FlwError";
  }
}

type Fetch = typeof fetch;

async function call(cfg: FlwConfig, path: string, init: RequestInit, f: Fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await f(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new FlwError("The payment provider could not be reached.", true);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const retryable = res.status >= 500 || res.status === 429;
    const msg = typeof (body as { message?: unknown })?.message === "string" ? String((body as { message: string }).message).slice(0, 200) : `HTTP ${res.status}`;
    throw new FlwError(msg, retryable, res.status);
  }
  return body;
}

// ---- Checkout ----

export type CheckoutInput = {
  txRef: string;
  amount: number;
  currency: string;
  redirectUrl: string;
  customer: { email: string; name?: string };
  title: string;
  description: string;
  meta?: Record<string, string>;
};

const CheckoutResponse = z.object({ status: z.string(), data: z.object({ link: z.string().url() }) });

export function paymentOptionsFor(currency: string): string {
  // Ugandan Mobile Money is charged in UGX. These only apply if "Disable preferred payment methods" is off in the dashboard.
  return currency === "UGX" ? "mobilemoneyuganda,card" : "card";
}

export async function createCheckout(cfg: FlwConfig, i: CheckoutInput, f: Fetch = fetch): Promise<{ link: string }> {
  const body = await call(cfg, "/payments", {
    method: "POST",
    body: JSON.stringify({
      tx_ref: i.txRef, amount: i.amount, currency: i.currency, redirect_url: i.redirectUrl,
      payment_options: paymentOptionsFor(i.currency),
      customer: { email: i.customer.email, ...(i.customer.name ? { name: i.customer.name } : {}) },
      customizations: { title: i.title, description: i.description },
      ...(i.meta ? { meta: i.meta } : {}),
    }),
  }, f);
  const parsed = CheckoutResponse.safeParse(body);
  if (!parsed.success || parsed.data.status !== "success") throw new FlwError("The payment provider returned an unexpected response.", false);
  const link = new URL(parsed.data.data.link);
  // Only ever send a customer to Flutterwave's own checkout.
  if (link.protocol !== "https:" || !/(^|\.)flutterwave\.com$/i.test(link.hostname)) throw new FlwError("The payment provider returned an unexpected link.", false);
  return { link: link.toString() };
}

// ---- Verification ----

export type VerifiedTransaction = { id: string; txRef: string; status: string; amount: number; currency: string; paymentType: string | null };

const VerifyResponse = z.object({
  status: z.string(),
  data: z.object({
    id: z.union([z.number(), z.string()]),
    tx_ref: z.string(),
    status: z.string(),
    amount: z.union([z.number(), z.string()]),
    currency: z.string(),
    payment_type: z.string().nullish(),
  }),
});

function toVerified(body: unknown): VerifiedTransaction {
  const p = VerifyResponse.safeParse(body);
  if (!p.success || p.data.status !== "success") throw new FlwError("The payment provider returned an unexpected response.", false);
  const amount = Number(p.data.data.amount);
  if (!Number.isFinite(amount)) throw new FlwError("The payment provider returned an invalid amount.", false);
  return { id: String(p.data.data.id), txRef: p.data.data.tx_ref, status: p.data.data.status.toLowerCase(), amount, currency: p.data.data.currency.toUpperCase(), paymentType: p.data.data.payment_type ?? null };
}

export async function verifyById(cfg: FlwConfig, transactionId: string, f: Fetch = fetch): Promise<VerifiedTransaction> {
  if (!/^\d{1,20}$/.test(transactionId)) throw new FlwError("Invalid transaction id.", false);
  return toVerified(await call(cfg, `/transactions/${transactionId}/verify`, { method: "GET" }, f));
}

/** Null when Flutterwave has no transaction for the reference (the customer never paid). */
export async function verifyByReference(cfg: FlwConfig, txRef: string, f: Fetch = fetch): Promise<VerifiedTransaction | null> {
  try {
    return toVerified(await call(cfg, `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`, { method: "GET" }, f));
  } catch (e) {
    if (e instanceof FlwError && !e.retryable && (e.status === 400 || e.status === 404)) return null;
    throw e;
  }
}

// ---- Webhook authentication ----

/** Constant-time comparison of the `verif-hash` header with the configured secret hash. */
export function webhookAuthentic(cfg: FlwConfig, header: string | null): boolean {
  if (!cfg.webhookHash || !header) return false;
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(cfg.webhookHash).digest();
  return timingSafeEqual(a, b);
}

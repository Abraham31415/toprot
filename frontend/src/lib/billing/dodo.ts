import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Dodo Payments (https://docs.dodopayments.com), a merchant of record. Server-side only; the API key and webhook secret come
// from the environment and are never logged or sent to the browser. Every network call takes an injectable fetch.
//
//   Create a hosted checkout:  POST {base}/checkouts                      -> { session_id, checkout_url }
//   Look up a payment:         GET  {base}/payments/{payment_id}          -> status, total_amount, tax, currency, metadata, ...
//   Look up a subscription:    GET  {base}/subscriptions/{subscription_id}
//   Cancel at period end:      PATCH {base}/subscriptions/{subscription_id}
//   Webhooks:                  Standard Webhooks (headers webhook-id, webhook-timestamp, webhook-signature)
//
// Test keys (dodo_test_...) work only against test.dodopayments.com; live keys (dodo_live_...) only against live.dodopayments.com.

export type DodoConfig = {
  apiKey: string;
  /** The signing secret of the webhook endpoint (starts with whsec_). Without it the webhook endpoint refuses everything. */
  webhookSecret: string | null;
  baseUrl: string;
  mode: "test" | "live";
  /** Live keys are refused unless BILLING_LIVE_ENABLED=true, so a live key cannot be used by accident. */
  liveEnabled: boolean;
};

export function loadDodoConfig(env: Record<string, string | undefined> = process.env): DodoConfig | null {
  const apiKey = env.DODO_PAYMENTS_API_KEY?.trim();
  if (!apiKey) return null;
  const mode: "test" | "live" = /^dodo_live_/.test(apiKey) ? "live" : "test";
  return {
    apiKey,
    webhookSecret: env.DODO_PAYMENTS_WEBHOOK_SECRET?.trim() || null,
    baseUrl: (env.DODO_PAYMENTS_BASE_URL?.trim() || (mode === "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com")).replace(/\/$/, ""),
    mode,
    liveEnabled: env.BILLING_LIVE_ENABLED === "true",
  };
}

export function dodoCheckoutReady(cfg: DodoConfig | null): { ok: true } | { ok: false; message: string } {
  if (!cfg) return { ok: false, message: "Payments are not switched on yet." };
  if (!cfg.webhookSecret) return { ok: false, message: "Payments are not fully set up yet." };
  if (cfg.mode === "live" && !cfg.liveEnabled) return { ok: false, message: "Payments are not open yet." };
  return { ok: true };
}

export const newDodoTxRef = () => `toprot-${randomUUID()}`;

export class DodoError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
    this.name = "DodoError";
  }
}

type Fetch = typeof fetch;

async function call(cfg: DodoConfig, path: string, init: RequestInit, f: Fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await f(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new DodoError("The payment provider could not be reached.", true);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const retryable = res.status >= 500 || res.status === 429;
    const m = (body as { message?: unknown })?.message;
    throw new DodoError(typeof m === "string" ? m.slice(0, 200) : `HTTP ${res.status}`, retryable, res.status);
  }
  return body;
}

// ---- Checkout ----

export type CheckoutInput = {
  productId: string;
  returnUrl: string;
  email: string;
  metadata: Record<string, string>;
};

const CheckoutResponse = z.object({ session_id: z.string(), checkout_url: z.string().url() });

export async function createCheckout(cfg: DodoConfig, i: CheckoutInput, f: Fetch = fetch): Promise<{ link: string; sessionId: string }> {
  const body = await call(cfg, "/checkouts", {
    method: "POST",
    body: JSON.stringify({
      product_cart: [{ product_id: i.productId, quantity: 1 }],
      customer: { email: i.email },
      return_url: i.returnUrl,
      // Our prices are in USD, so lock the currency: the amount can then be compared with what we expect.
      billing_currency: "USD",
      feature_flags: { allow_currency_selection: false },
      metadata: i.metadata,
    }),
  }, f);
  const parsed = CheckoutResponse.safeParse(body);
  if (!parsed.success) throw new DodoError("The payment provider returned an unexpected response.", false);
  const link = new URL(parsed.data.checkout_url);
  // Only ever send a customer to Dodo's own checkout.
  if (link.protocol !== "https:" || !/(^|\.)dodopayments\.com$/i.test(link.hostname)) throw new DodoError("The payment provider returned an unexpected link.", false);
  return { link: link.toString(), sessionId: parsed.data.session_id };
}

// ---- Verification ----

const PaymentResponse = z.object({
  payment_id: z.string(),
  status: z.string().nullish(),
  total_amount: z.number(),
  tax: z.number().nullish(),
  currency: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  subscription_id: z.string().nullish(),
  product_cart: z.array(z.object({ product_id: z.string(), quantity: z.number() })).nullish(),
  payment_method: z.string().nullish(),
  checkout_session_id: z.string().nullish(),
});

export type VerifiedPayment = {
  paymentId: string;
  status: string;
  /** Amount before tax in major units (7.99 for $7.99). Dodo adds tax on top, so this is what is compared with our price. */
  preTaxAmount: number;
  currency: string;
  metadata: Record<string, unknown>;
  subscriptionId: string | null;
  productIds: string[];
  method: string | null;
};

const PAYMENT_ID = /^[A-Za-z0-9_-]{3,100}$/;
// Currencies with no minor unit. Dodo reports amounts in the currency's smallest unit.
const ZERO_DECIMAL = new Set(["JPY", "KRW", "UGX", "VND", "CLP", "RWF"]);
const toMajor = (minor: number, currency: string) => (ZERO_DECIMAL.has(currency) ? minor : minor / 100);

export async function getPayment(cfg: DodoConfig, paymentId: string, f: Fetch = fetch): Promise<VerifiedPayment> {
  if (!PAYMENT_ID.test(paymentId)) throw new DodoError("Invalid payment id.", false);
  const p = PaymentResponse.safeParse(await call(cfg, `/payments/${encodeURIComponent(paymentId)}`, { method: "GET" }, f));
  if (!p.success) throw new DodoError("The payment provider returned an unexpected response.", false);
  const d = p.data;
  const currency = d.currency.toUpperCase();
  return {
    paymentId: d.payment_id,
    status: (d.status ?? "unknown").toLowerCase(),
    preTaxAmount: Math.round(toMajor(d.total_amount - (d.tax ?? 0), currency) * 100) / 100,
    currency,
    metadata: (d.metadata ?? {}) as Record<string, unknown>,
    subscriptionId: d.subscription_id ?? null,
    productIds: (d.product_cart ?? []).filter((c) => c.quantity > 0).map((c) => c.product_id),
    method: d.payment_method ?? null,
  };
}

const SubscriptionResponse = z.object({
  subscription_id: z.string(),
  status: z.string(),
  product_id: z.string().nullish(),
  cancel_at_next_billing_date: z.boolean().nullish(),
  next_billing_date: z.string().nullish(),
});
export type SubscriptionInfo = { subscriptionId: string; status: string; productId: string | null; cancelAtPeriodEnd: boolean; nextBillingDate: string | null };

const toSub = (body: unknown): SubscriptionInfo => {
  const p = SubscriptionResponse.safeParse(body);
  if (!p.success) throw new DodoError("The payment provider returned an unexpected response.", false);
  return { subscriptionId: p.data.subscription_id, status: p.data.status.toLowerCase(), productId: p.data.product_id ?? null, cancelAtPeriodEnd: p.data.cancel_at_next_billing_date === true, nextBillingDate: p.data.next_billing_date ?? null };
};

export async function getSubscription(cfg: DodoConfig, subscriptionId: string, f: Fetch = fetch): Promise<SubscriptionInfo> {
  if (!PAYMENT_ID.test(subscriptionId)) throw new DodoError("Invalid subscription id.", false);
  return toSub(await call(cfg, `/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "GET" }, f));
}

/** Stops renewal. The customer keeps access until the end of the period they have paid for. */
export async function cancelAtPeriodEnd(cfg: DodoConfig, subscriptionId: string, f: Fetch = fetch): Promise<SubscriptionInfo> {
  if (!PAYMENT_ID.test(subscriptionId)) throw new DodoError("Invalid subscription id.", false);
  return toSub(await call(cfg, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled", cancel_at_next_billing_date: true, cancel_reason: "cancelled_by_customer" }),
  }, f));
}

// ---- Webhook authentication (Standard Webhooks) ----

const TOLERANCE_S = 5 * 60;

export type WebhookHeaders = { id: string | null; timestamp: string | null; signature: string | null };

/**
 * Verifies a Standard Webhooks delivery against the RAW request body: HMAC-SHA256 over "{id}.{timestamp}.{body}" with the
 * base64-decoded secret (the part after "whsec_"), compared in constant time against every "v1,<signature>" entry. Rejects
 * deliveries whose timestamp is more than five minutes from now, so a captured request cannot be replayed later.
 */
export function verifyDodoWebhook(cfg: DodoConfig, headers: WebhookHeaders, rawBody: string, nowMs: number = Date.now()): boolean {
  if (!cfg.webhookSecret || !headers.id || !headers.timestamp || !headers.signature) return false;
  if (!/^\d{9,12}$/.test(headers.timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(headers.timestamp)) > TOLERANCE_S) return false;
  const secretText = cfg.webhookSecret.startsWith("whsec_") ? cfg.webhookSecret.slice(6) : cfg.webhookSecret;
  let key: Buffer;
  try { key = Buffer.from(secretText, "base64"); } catch { return false; }
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest();
  for (const part of headers.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

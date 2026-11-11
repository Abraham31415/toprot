import type { SupabaseClient } from "@supabase/supabase-js";
import { DodoError, getPayment, getSubscription, type DodoConfig, type VerifiedPayment } from "./dodo";

// The only route by which a Dodo payment turns into a subscription or credits. The webhook body and the browser redirect are
// hints. The payment is always re-fetched from Dodo with our API key, then checked: it must have succeeded, carry OUR
// reference (set when we created the checkout) or belong to a subscription we know, be for the product we sold for that
// order, and be at least our price before tax in USD. Only then does billing_fulfill_payment grant anything, and it
// re-checks amount and currency itself and is idempotent.

export type DodoOutcome =
  | { outcome: "fulfilled"; kind?: string }
  | { outcome: "duplicate" }
  | { outcome: "failed" }
  | { outcome: "pending" }
  | { outcome: "ignored" }
  | { outcome: "rejected"; code: string };

type Fetch = typeof fetch;
const TX_REF = /^toprot-[0-9a-f-]{36}$/;

async function expectedProductId(db: SupabaseClient, kind: string, productKey: string): Promise<string | null> {
  const { data } = await db.from("billing_provider_products").select("product_id").eq("provider", "dodo").eq("kind", kind === "subscription" ? "plan" : "pack").eq("product_key", productKey).maybeSingle();
  return (data?.product_id as string | undefined) ?? null;
}

export async function fulfilDodoPayment(db: SupabaseClient, cfg: DodoConfig, input: { paymentId: string; eventKey?: string | null }, f: Fetch = fetch): Promise<DodoOutcome> {
  // Throws DodoError(retryable) on network or provider trouble, so a webhook can ask Dodo to retry.
  const p: VerifiedPayment = await getPayment(cfg, input.paymentId, f);
  const waiting = ["processing", "requires_customer_action", "requires_merchant_action", "requires_payment_method", "requires_confirmation", "requires_capture", "partially_captured", "partially_captured_and_capturable", "unknown"];
  if (waiting.includes(p.status)) return { outcome: "pending" };

  // Which of our orders is this? A first payment carries our reference; a renewal is identified by its subscription.
  let txRef = typeof p.metadata.toprot_tx_ref === "string" && TX_REF.test(p.metadata.toprot_tx_ref) ? p.metadata.toprot_tx_ref : null;
  const isRenewal = !txRef;
  if (!txRef) {
    if (!p.subscriptionId) return { outcome: "ignored" };
    if (p.status !== "succeeded") return { outcome: "ignored" };
    const renewal = await db.rpc("billing_start_renewal_payment", { p_provider: "dodo", p_provider_subscription_id: p.subscriptionId, p_provider_payment_id: p.paymentId });
    if (renewal.error) throw new DodoError("Could not record the payment.", true);
    const r = renewal.data as { ok?: boolean; tx_ref?: string };
    if (!r.ok || !r.tx_ref) return { outcome: "ignored" };
    txRef = r.tx_ref;
  }

  const { data: order } = await db.from("payments").select("kind, product_key").eq("tx_ref", txRef).maybeSingle();
  if (!order) return { outcome: "ignored" };

  if (p.status === "succeeded") {
    // Product identity. A pack must be exactly the one product we sold. A subscription payment names its subscription, whose
    // product must be our plan's.
    const expected = await expectedProductId(db, order.kind as string, order.product_key as string);
    if (!expected) return { outcome: "rejected", code: "product_not_configured" };
    if (order.kind === "pack") {
      if (p.productIds.length !== 1 || p.productIds[0] !== expected) return { outcome: "rejected", code: "product_mismatch" };
    } else {
      if (!p.subscriptionId) return { outcome: "rejected", code: "not_a_subscription_payment" };
      const sub = await getSubscription(cfg, p.subscriptionId, f);
      if (sub.productId !== expected) return { outcome: "rejected", code: "product_mismatch" };
    }
  }

  const { data, error } = await db.rpc("billing_fulfill_payment", {
    p_tx_ref: txRef, p_provider_txn: p.paymentId, p_provider_status: p.status === "succeeded" ? "successful" : p.status,
    p_amount: p.preTaxAmount, p_currency: p.currency, p_method: p.method, p_event_key: input.eventKey ?? null,
  });
  if (error) throw new DodoError("Could not record the payment.", true);
  const r = (data ?? {}) as { ok?: boolean; code?: string; duplicate?: boolean; status?: string; kind?: string };
  if (r.ok === true) {
    if (r.duplicate) return { outcome: "duplicate" };
    if (r.status === "failed") return { outcome: "failed" };
    if (order.kind === "subscription" && p.subscriptionId && !isRenewal) {
      // Remember the provider's subscription id so renewals and cancellation can be matched to this customer.
      await db.rpc("billing_link_provider_subscription", { p_tx_ref: txRef, p_provider_subscription_id: p.subscriptionId });
    }
    return { outcome: "fulfilled", kind: r.kind };
  }
  if (r.code === "unknown_reference") return { outcome: "ignored" };
  return { outcome: "rejected", code: r.code ?? "rejected" };
}

/** Subscription lifecycle events: keep our "will it renew" flag in step with Dodo. Access never depends on it. */
export async function syncDodoSubscription(db: SupabaseClient, cfg: DodoConfig, subscriptionId: string, f: Fetch = fetch): Promise<void> {
  const sub = await getSubscription(cfg, subscriptionId, f);
  const stopped = sub.cancelAtPeriodEnd || ["cancelled", "expired", "failed", "on_hold"].includes(sub.status);
  const { error } = await db.rpc("billing_mark_subscription_cancel", { p_provider: "dodo", p_provider_subscription_id: subscriptionId, p_cancel: stopped });
  if (error) throw new DodoError("Could not record the subscription change.", true);
}

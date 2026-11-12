"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";
import { checkoutReady, createCheckout as flwCreateCheckout, FlwError, loadFlwConfig, newTxRef } from "@/lib/billing/flutterwave";
import { cancelAtPeriodEnd, createCheckout as dodoCreateCheckout, DodoError, loadDodoConfig, newDodoTxRef } from "@/lib/billing/dodo";
import { activeProvider, providerReady } from "@/lib/billing/provider";

// Starts a payment. A pending payment row is written FIRST, at the price stored in the database; only then is the customer
// sent to the payment provider. Nothing is granted here: credits and subscriptions are issued only after the backend has
// independently verified the payment with the provider (see lib/billing/dodo-fulfil.ts and fulfil.ts).

const MESSAGES: Record<string, string> = {
  invalid_request: "That purchase could not be started.",
  unknown_product: "That item is not available.",
  currency_unavailable: "That item is not available in the chosen currency.",
  too_many_attempts: "You have started several payments in the last hour. Please wait a little and try again.",
};

function mapCreateError(created: { code?: string; renew_from?: string; renews_on?: string }): string {
  const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");
  if (created.code === "too_early") return `You can renew in the last few days of your billing period${created.renew_from ? `, from ${day(created.renew_from)}` : ""}.`;
  if (created.code === "already_subscribed") return `You already have an active subscription${created.renews_on ? ` that renews on ${day(created.renews_on)}` : ""}. It renews automatically, so there is nothing to buy.`;
  return MESSAGES[created.code ?? ""] ?? MESSAGES.invalid_request;
}

export async function startCheckout(kind: "subscription" | "pack", productKey: string, currency: string): Promise<{ url?: string; error?: string }> {
  const ready = providerReady();
  if (!ready.ok) return { error: ready.message };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Sign in to continue." };
  if (!["subscription", "pack"].includes(kind) || !/^[a-z][a-z0-9_]{1,30}$/.test(productKey) || !/^[A-Z]{3}$/.test(currency)) return { error: MESSAGES.invalid_request };
  const admin = createAdminClient();

  if (ready.provider === "dodo") {
    const cfg = loadDodoConfig()!;
    if (currency !== "USD") return { error: "Payments are in US dollars." };
    const { data: prod } = await admin.from("billing_provider_products").select("product_id").eq("provider", "dodo").eq("kind", kind === "subscription" ? "plan" : "pack").eq("product_key", productKey).maybeSingle();
    if (!prod?.product_id) return { error: "That item is not available for purchase yet." };
    const txRef = newDodoTxRef();
    const { data, error } = await admin.rpc("billing_create_payment", { p_user: user.id, p_kind: kind, p_product: productKey, p_currency: currency, p_tx_ref: txRef, p_provider: "dodo" });
    if (error) return { error: "Could not start the payment. Please try again." };
    const created = data as { ok: boolean; code?: string; renew_from?: string; renews_on?: string };
    if (!created.ok) return { error: mapCreateError(created) };
    try {
      const { link, sessionId } = await dodoCreateCheckout(cfg, {
        productId: prod.product_id as string, returnUrl: `${SITE_URL}/billing/return?tx_ref=${txRef}`, email: user.email,
        metadata: { toprot_tx_ref: txRef, toprot_kind: kind, toprot_product: productKey },
      });
      await admin.from("payments").update({ meta: { checkout_session_id: sessionId } }).eq("tx_ref", txRef);
      return { url: link };
    } catch (e) {
      console.error(JSON.stringify({ evt: "dodo_checkout_error", mode: cfg.mode, base: cfg.baseUrl, status: e instanceof DodoError ? e.status ?? null : null, retryable: e instanceof DodoError ? e.retryable : null, msg: e instanceof Error ? e.message.slice(0, 240) : "unknown" }));
      await admin.from("payments").update({ status: "failed", failure_reason: "checkout_creation_failed" }).eq("tx_ref", txRef).eq("status", "pending");
      return { error: e instanceof DodoError && e.retryable ? "The payment provider is not responding. Please try again in a moment." : "Could not open the checkout. Please try again later." };
    }
  }

  // Flutterwave (only when it, and not Dodo, is the configured provider)
  const cfg = loadFlwConfig();
  const flwReady = checkoutReady(cfg);
  if (!flwReady.ok || !cfg) return { error: flwReady.ok ? "Payments are not switched on yet." : flwReady.message };
  const txRef = newTxRef();
  const { data, error } = await admin.rpc("billing_create_payment", { p_user: user.id, p_kind: kind, p_product: productKey, p_currency: currency, p_tx_ref: txRef, p_provider: "flutterwave" });
  if (error) return { error: "Could not start the payment. Please try again." };
  const created = data as { ok: boolean; code?: string; amount?: number; renew_from?: string; renews_on?: string };
  if (!created.ok) return { error: mapCreateError(created) };
  let title = "Toprot";
  let description = kind === "subscription" ? "Toprot Pro, one month" : "Toprot AI credits";
  if (kind === "pack") {
    const { data: pack } = await admin.from("credit_packs").select("name").eq("pack_key", productKey).maybeSingle();
    if (pack?.name) description = `Toprot AI credits: ${pack.name}`;
  } else {
    const { data: plan } = await admin.from("plans").select("name").eq("plan_key", productKey).maybeSingle();
    if (plan?.name) { title = plan.name as string; description = `${plan.name}, one month`; }
  }
  try {
    const { link } = await flwCreateCheckout(cfg, {
      txRef, amount: Number(created.amount), currency, redirectUrl: `${SITE_URL}/billing/return`,
      customer: { email: user.email }, title, description, meta: { toprot_kind: kind, toprot_product: productKey },
    });
    return { url: link };
  } catch (e) {
    await admin.from("payments").update({ status: "failed", failure_reason: "checkout_creation_failed" }).eq("tx_ref", txRef).eq("status", "pending");
    return { error: e instanceof FlwError && e.retryable ? "The payment provider is not responding. Please try again in a moment." : "Could not open the checkout. Please try again later." };
  }
}

/** Stops the monthly renewal. The customer keeps access until the end of the period they have paid for. */
export async function cancelRenewal(): Promise<{ error?: string }> {
  if (activeProvider() !== "dodo") return { error: "Renewal is not managed here." };
  const cfg = loadDodoConfig();
  if (!cfg) return { error: "Payments are not switched on yet." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to continue." };
  const admin = createAdminClient();
  // The subscription id comes from our own record of this signed-in user, never from the request.
  const { data: sub } = await admin.from("ai_subscriptions").select("provider, provider_subscription_id, status, current_period_end").eq("user_id", user.id).maybeSingle();
  if (!sub || sub.provider !== "dodo" || !sub.provider_subscription_id) return { error: "You do not have a subscription that renews automatically." };
  try {
    await cancelAtPeriodEnd(cfg, sub.provider_subscription_id as string);
  } catch (e) {
    return { error: e instanceof DodoError && e.retryable ? "The payment provider is not responding. Please try again in a moment." : "Could not cancel the renewal. Please try again, or contact support." };
  }
  await admin.rpc("billing_mark_subscription_cancel", { p_provider: "dodo", p_provider_subscription_id: sub.provider_subscription_id, p_cancel: true });
  revalidatePath("/billing");
  return {};
}

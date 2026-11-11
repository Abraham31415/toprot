"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";
import { checkoutReady, createCheckout, FlwError, loadFlwConfig, newTxRef } from "@/lib/billing/flutterwave";

// Starts a payment. A pending payment row is written FIRST, at the price stored in the database; only then is the
// customer sent to Flutterwave. Nothing is granted here: credits and subscriptions are issued only after the backend
// has independently verified the transaction (see lib/billing/fulfil.ts).

const MESSAGES: Record<string, string> = {
  invalid_request: "That purchase could not be started.",
  unknown_product: "That item is not available.",
  currency_unavailable: "That item is not available in the chosen currency.",
  too_many_attempts: "You have started several payments in the last hour. Please wait a little and try again.",
};

export async function startCheckout(kind: "subscription" | "pack", productKey: string, currency: string): Promise<{ url?: string; error?: string }> {
  const cfg = loadFlwConfig();
  const ready = checkoutReady(cfg);
  if (!ready.ok || !cfg) return { error: ready.ok ? "Payments are not switched on yet." : ready.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Sign in to continue." };
  if (!["subscription", "pack"].includes(kind) || !/^[a-z][a-z0-9_]{1,30}$/.test(productKey) || !/^[A-Z]{3}$/.test(currency)) return { error: MESSAGES.invalid_request };

  const admin = createAdminClient();
  const txRef = newTxRef();
  const { data, error } = await admin.rpc("billing_create_payment", { p_user: user.id, p_kind: kind, p_product: productKey, p_currency: currency, p_tx_ref: txRef });
  if (error) return { error: "Could not start the payment. Please try again." };
  const created = data as { ok: boolean; code?: string; amount?: number; renew_from?: string };
  if (!created.ok) {
    if (created.code === "too_early") return { error: `You can renew in the last few days of your billing period${created.renew_from ? `, from ${new Date(created.renew_from).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}.` };
    return { error: MESSAGES[created.code ?? ""] ?? MESSAGES.invalid_request };
  }

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
    const { link } = await createCheckout(cfg, {
      txRef, amount: Number(created.amount), currency, redirectUrl: `${SITE_URL}/billing/return`,
      customer: { email: user.email }, title, description, meta: { toprot_kind: kind, toprot_product: productKey },
    });
    return { url: link };
  } catch (e) {
    await admin.from("payments").update({ status: "failed", failure_reason: "checkout_creation_failed" }).eq("tx_ref", txRef).eq("status", "pending");
    return { error: e instanceof FlwError && e.retryable ? "The payment provider is not responding. Please try again in a moment." : "Could not open the checkout. Please try again later." };
  }
}

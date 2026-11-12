import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";
import { loadDodoConfig } from "@/lib/billing/dodo";
import { fulfilDodoPayment } from "@/lib/billing/dodo-fulfil";
import { loadFlwConfig } from "@/lib/billing/flutterwave";
import { verifyAndFulfil } from "@/lib/billing/fulfil";

// Where the payment provider sends the customer after checkout. The query string is NOT trusted: we confirm the payment
// belongs to the signed-in user, then verify it with the provider ourselves. A missed or slow webhook is covered by this
// and by the webhook itself (the provider retries it).

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const to = (state: string) => NextResponse.redirect(`${SITE_URL}/billing?checkout=${state}`);
  const txRef = req.nextUrl.searchParams.get("tx_ref") ?? "";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${SITE_URL}/login`);

  // Dodo sends the customer back with its own payment id and may not keep our reference in the query string. The payment id
  // is still only a hint: fulfilDodoPayment re-fetches the payment from Dodo and finds our order from Dodo's own metadata.
  const dodoPaymentId = req.nextUrl.searchParams.get("payment_id");
  if (!txRef.startsWith("toprot-") && dodoPaymentId && /^[A-Za-z0-9_-]{3,100}$/.test(dodoPaymentId)) {
    const cfg = loadDodoConfig();
    if (cfg) {
      try {
        const r = await fulfilDodoPayment(createAdminClient(), cfg, { paymentId: dodoPaymentId });
        if (r.outcome === "fulfilled" || r.outcome === "duplicate") return to("success");
        if (r.outcome === "failed" || r.outcome === "rejected") return to("failed");
        if (r.outcome === "pending") return to("pending");
        // "ignored" (Dodo's payment id did not map to one of our orders): fall through to the latest-payment check below.
      } catch {
        return to("pending");
      }
    }
  }
  if (!txRef.startsWith("toprot-")) {
    // Neither our reference nor a usable payment id came back (Dodo's subscription redirect can look like this). Fall back to
    // this customer's own most recent payment from the last hour. Row-level security means only their own rows can be seen,
    // and the status shown is whatever the verified webhook or verification has already recorded; nothing is granted here.
    console.info(JSON.stringify({ evt: "billing_return_without_reference", params: [...req.nextUrl.searchParams.keys()].slice(0, 12) }));
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { data: recent } = await supabase.from("payments").select("status").gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (recent?.status === "succeeded") return to("success");
    if (recent?.status === "pending") return to("pending");
    if (recent?.status === "failed") return to("failed");
    return to("unknown");
  }

  // Row-level security: the user can only see their own payments, so this also proves the payment is theirs.
  const { data: own } = await supabase.from("payments").select("id, status").eq("tx_ref", txRef).maybeSingle();
  if (!own) return to("unknown");
  const admin = createAdminClient();
  const { data: row } = await admin.from("payments").select("provider").eq("tx_ref", txRef).maybeSingle();

  try {
    if (row?.provider === "dodo") {
      const cfg = loadDodoConfig();
      if (!cfg) return to("unavailable");
      const paymentId = req.nextUrl.searchParams.get("payment_id");
      if (paymentId && /^[A-Za-z0-9_-]{3,100}$/.test(paymentId)) {
        const r = await fulfilDodoPayment(admin, cfg, { paymentId });
        if (r.outcome === "fulfilled" || r.outcome === "duplicate") return to("success");
        if (r.outcome === "failed" || r.outcome === "rejected") return to("failed");
      }
      // Without a payment id we cannot ask Dodo, so see whether the webhook has already confirmed it.
      const { data: now } = await admin.from("payments").select("status").eq("tx_ref", txRef).maybeSingle();
      return to(now?.status === "succeeded" ? "success" : now?.status === "failed" ? "failed" : "pending");
    }

    const cfg = loadFlwConfig();
    if (!cfg) return to("unavailable");
    const transactionId = req.nextUrl.searchParams.get("transaction_id");
    const r = await verifyAndFulfil(admin, cfg, { txRef, transactionId: transactionId && /^\d+$/.test(transactionId) ? transactionId : null });
    if (r.outcome === "fulfilled" || r.outcome === "duplicate") return to("success");
    if (r.outcome === "pending") return to("pending");
    return to("failed");
  } catch {
    return to("pending");
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";
import { loadFlwConfig } from "@/lib/billing/flutterwave";
import { verifyAndFulfil } from "@/lib/billing/fulfil";

// Where Flutterwave sends the customer after checkout. The query string is NOT trusted: we confirm the payment belongs
// to the signed-in user, then verify it with Flutterwave ourselves. A missed or slow webhook is covered by this and by
// the scheduled reconciliation.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const to = (state: string) => NextResponse.redirect(`${SITE_URL}/billing?checkout=${state}`);
  const txRef = req.nextUrl.searchParams.get("tx_ref") ?? "";
  const transactionId = req.nextUrl.searchParams.get("transaction_id");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${SITE_URL}/login`);
  if (!txRef.startsWith("toprot-")) return to("unknown");

  const cfg = loadFlwConfig();
  if (!cfg) return to("unavailable");
  const { data: own } = await supabase.from("payments").select("id").eq("tx_ref", txRef).maybeSingle();
  if (!own) return to("unknown");

  try {
    const r = await verifyAndFulfil(createAdminClient(), cfg, { txRef, transactionId: transactionId && /^\d+$/.test(transactionId) ? transactionId : null });
    if (r.outcome === "fulfilled" || r.outcome === "duplicate") return to("success");
    if (r.outcome === "pending") return to("pending");
    return to("failed");
  } catch {
    return to("pending");
  }
}

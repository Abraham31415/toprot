import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FlwError, loadFlwConfig, webhookAuthentic } from "@/lib/billing/flutterwave";
import { verifyAndFulfil } from "@/lib/billing/fulfil";

// Flutterwave webhook. Authenticated by the `verif-hash` header. The body is only a hint: the transaction is re-fetched
// from Flutterwave and verified before anything is granted. Returns 200 for anything that retrying cannot fix, and 5xx
// for temporary trouble so Flutterwave retries. Repeated deliveries are harmless: fulfilment is idempotent.

export const dynamic = "force-dynamic";
const MAX_BODY = 100_000;

export async function POST(req: Request) {
  const cfg = loadFlwConfig();
  if (!cfg || !cfg.webhookHash) return new NextResponse("not configured", { status: 503 });
  if (!webhookAuthentic(cfg, req.headers.get("verif-hash"))) return new NextResponse("unauthorized", { status: 401 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return new NextResponse("too large", { status: 413 });
  let body: { event?: unknown; data?: { id?: unknown; tx_ref?: unknown } };
  try { body = JSON.parse(raw); } catch { return new NextResponse("bad request", { status: 400 }); }

  if (body.event !== "charge.completed") return NextResponse.json({ ok: true, ignored: true });
  const txRef = typeof body.data?.tx_ref === "string" ? body.data.tx_ref : "";
  const id = body.data?.id;
  const transactionId = typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id)) ? String(id) : null;
  if (!txRef.startsWith("toprot-") || !transactionId) return NextResponse.json({ ok: true, ignored: true });

  try {
    const result = await verifyAndFulfil(createAdminClient(), cfg, { txRef, transactionId, eventKey: `${body.event}:${transactionId}` });
    return NextResponse.json({ ok: true, outcome: result.outcome });
  } catch (e) {
    if (e instanceof FlwError && !e.retryable) return NextResponse.json({ ok: true, outcome: "unverifiable" });
    console.error(JSON.stringify({ evt: "billing_webhook_error", txRef, err: e instanceof Error ? e.message : "unknown" }));
    return new NextResponse("try again", { status: 500 });
  }
}

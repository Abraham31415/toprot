import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DodoError, loadDodoConfig, verifyDodoWebhook } from "@/lib/billing/dodo";
import { fulfilDodoPayment, syncDodoSubscription } from "@/lib/billing/dodo-fulfil";

// Dodo Payments webhook (Standard Webhooks). Authenticated by the signature over the RAW body, with a five minute timestamp
// window. The body is only a hint: the payment is re-fetched from Dodo and verified before anything is granted. Returns 2xx
// for anything retrying cannot fix and 5xx for temporary trouble so Dodo retries. Repeated deliveries are harmless.

export const dynamic = "force-dynamic";
const MAX_BODY = 200_000;
const ID = /^[A-Za-z0-9_-]{3,100}$/;

export async function POST(req: Request) {
  const cfg = loadDodoConfig();
  if (!cfg || !cfg.webhookSecret) return new NextResponse("not configured", { status: 503 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return new NextResponse("too large", { status: 413 });
  const ok = verifyDodoWebhook(cfg, { id: req.headers.get("webhook-id"), timestamp: req.headers.get("webhook-timestamp"), signature: req.headers.get("webhook-signature") }, raw);
  if (!ok) return new NextResponse("unauthorized", { status: 401 });

  let body: { type?: unknown; data?: { payment_id?: unknown; subscription_id?: unknown } };
  try { body = JSON.parse(raw); } catch { return new NextResponse("bad request", { status: 400 }); }
  const type = typeof body.type === "string" ? body.type : "";
  const eventKey = `dodo:${req.headers.get("webhook-id")}`;
  const db = createAdminClient();

  try {
    if (type === "payment.succeeded" || type === "payment.failed" || type === "payment.cancelled" || type === "payment.processing") {
      const paymentId = body.data?.payment_id;
      if (typeof paymentId !== "string" || !ID.test(paymentId)) return NextResponse.json({ ok: true, ignored: true });
      const r = await fulfilDodoPayment(db, cfg, { paymentId, eventKey });
      return NextResponse.json({ ok: true, outcome: r.outcome });
    }
    if (type.startsWith("subscription.")) {
      const subId = body.data?.subscription_id;
      if (typeof subId !== "string" || !ID.test(subId)) return NextResponse.json({ ok: true, ignored: true });
      await syncDodoSubscription(db, cfg, subId);
      return NextResponse.json({ ok: true, synced: true });
    }
    return NextResponse.json({ ok: true, ignored: true });
  } catch (e) {
    if (e instanceof DodoError && !e.retryable) return NextResponse.json({ ok: true, outcome: "unverifiable" });
    console.error(JSON.stringify({ evt: "dodo_webhook_error", type, err: e instanceof Error ? e.message : "unknown" }));
    return new NextResponse("try again", { status: 500 });
  }
}

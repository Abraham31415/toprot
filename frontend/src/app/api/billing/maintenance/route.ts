import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadFlwConfig } from "@/lib/billing/flutterwave";
import { verifyAndFulfil } from "@/lib/billing/fulfil";

// Scheduled housekeeping (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`):
//   1. re-check payments still pending with Flutterwave, in case a webhook was missed
//   2. close checkouts that were never completed
//   3. expire purchased credits past their expiry date

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function GET(req: Request) {
  if (!authorised(req)) return new NextResponse("unauthorized", { status: 401 });
  const db = createAdminClient();
  const cfg = loadFlwConfig();
  const out = { rechecked: 0, fulfilled: 0, closed: 0, expiredLots: 0 };

  if (cfg) {
    const { data } = await db.rpc("billing_pending_to_check", { p_older_than_minutes: 10, p_limit: 50 });
    for (const row of (data ?? []) as { tx_ref: string }[]) {
      out.rechecked++;
      try {
        const r = await verifyAndFulfil(db, cfg, { txRef: row.tx_ref });
        if (r.outcome === "fulfilled") out.fulfilled++;
      } catch { /* try again next run */ }
    }
  }
  const closed = await db.rpc("billing_close_stale_payments");
  out.closed = Number(closed.data ?? 0);
  const expired = await db.rpc("billing_sweep_expired_lots");
  out.expiredLots = Number(expired.data ?? 0);
  return NextResponse.json({ ok: true, ...out });
}

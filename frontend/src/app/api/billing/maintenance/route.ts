import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadFlwConfig } from "@/lib/billing/flutterwave";
import { verifyAndFulfil } from "@/lib/billing/fulfil";
import { resendSender } from "@/lib/ai/alerts";

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
  const out = { rechecked: 0, fulfilled: 0, closed: 0, expiredLots: 0, eventsPruned: 0, newAlerts: 0 };
  // Each run is recorded, so the admin console can show when the job last ran and whether it failed.
  const started = new Date().toISOString();
  const run = await db.rpc("job_run_start", { p_job: "billing_maintenance" });
  const runId = typeof run.data === "number" || typeof run.data === "string" ? run.data : null;
  try {
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
    // Admin console housekeeping. These functions exist only once the admin migration is applied; until then they are skipped.
    const pruned = await db.rpc("analytics_prune", { p_days: 400 });
    out.eventsPruned = Number(pruned.data ?? 0);
    const scan = await db.rpc("admin_scan_alerts");
    out.newAlerts = Number((scan.data as { new_alerts?: number } | null)?.new_alerts ?? 0);
    if (out.newAlerts > 0 && process.env.AI_ADMIN_ALERT_EMAIL) {
      // Email only what needs attention now. Warnings stay on the console so routine events do not become noise.
      const { data: fresh } = await db.from("system_alerts").select("severity, message").eq("severity", "critical").is("acknowledged_at", null).gte("created_at", started);
      if (fresh && fresh.length) {
        const lines = fresh.map((f) => "- " + f.message).join(String.fromCharCode(10));
        const text = lines + String.fromCharCode(10, 10) + "Open the admin console, System Health, to review and acknowledge.";
        await resendSender(process.env.AI_ADMIN_ALERT_EMAIL, `ToProt: ${fresh.length} critical alert${fresh.length === 1 ? "" : "s"}`, text).catch(() => undefined);
      }
    }
    if (runId !== null) await db.rpc("job_run_finish", { p_id: runId, p_ok: true, p_summary: out });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    if (runId !== null) await db.rpc("job_run_finish", { p_id: runId, p_ok: false, p_summary: out, p_error: e instanceof Error ? e.name : "error" });
    throw e;
  }
}

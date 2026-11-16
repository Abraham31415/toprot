import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchNotificationEmails } from "@/lib/collab/notify-email";

// Scheduled sender for queued collaboration emails (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). It also expires nothing and
// changes nothing else: quotas, throttling and retries are decided in the database.

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
  const run = await db.rpc("job_run_start", { p_job: "collab_email_dispatch" });
  const runId = typeof run.data === "number" || typeof run.data === "string" ? run.data : null;
  try {
    const result = await dispatchNotificationEmails(db, undefined, 40);
    if (runId !== null) await db.rpc("job_run_finish", { p_id: runId, p_ok: true, p_summary: result, p_error: null });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (runId !== null) await db.rpc("job_run_finish", { p_id: runId, p_ok: false, p_summary: {}, p_error: String(e).slice(0, 300) });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- rows from the database reports are untyped JSON and are only read field by field */
import { NextResponse } from "next/server";
import { adminRpc, requestIp, requireAdmin } from "@/lib/admin/auth";
import { toCsv } from "@/lib/admin/csv";
import { iso } from "@/lib/admin/load";
import { parseRange } from "@/lib/admin/range";

// CSV exports of the lists on the admin pages. The route checks the administrator itself, limits how often exports can be taken, and
// records every export in the audit log. Exports hold personal data (email addresses), so they are not cached.

export const dynamic = "force-dynamic";
const MAX_ROWS = 10_000;
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

async function allPages<T>(page: (offset: number) => Promise<{ total: number; rows: T[] }>, size: number): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += size) {
    const r = await page(offset);
    out.push(...r.rows);
    if (out.length >= r.total || r.rows.length === 0) break;
  }
  return out;
}

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const s = await requireAdmin();
  const { kind } = await params;
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams);
  if (!["users", "subscriptions", "payments", "audit"].includes(kind)) return new NextResponse("not found", { status: 404, headers: NO_STORE });
  try {
    await adminRpc(s, "admin_rate_check", { p_prefix: "export.", p_max: 10, p_window: "1 hour" });
  } catch {
    return new NextResponse("Too many exports in the last hour. Try again later.", { status: 429, headers: NO_STORE });
  }

  let head: string[] = []; let rows: unknown[][] = [];
  if (kind === "users") {
    const data = await allPages<Record<string, any>>((o) => adminRpc(s, "admin_users_page", { p_search: sp.q || null, p_filter: sp.filter || "all", p_limit: 100, p_offset: o }), 100);
    head = ["id", "name", "email", "role", "registered_at", "suspended", "plan", "last_activity", "projects", "ai_credits_available", "verified_payments"];
    rows = data.map((u) => [u.id, u.name, u.email, u.role, u.registered_at, u.suspended, u.plan, u.last_activity, u.projects, u.credits_available, (u.verified_payments ?? []).map((p: any) => `${p.amount} ${p.currency}`).join("; ")]);
  } else if (kind === "subscriptions") {
    const range = parseRange({});
    const data = await allPages<Record<string, any>>((o) => adminRpc(s, "admin_subscriptions", { p_from: iso(range.from), p_to: iso(range.to), p_filter: sp.state || "all", p_limit: 100, p_offset: o }), 100);
    head = ["user_id", "email", "plan", "status", "state", "cancel_at_period_end", "current_period_start", "current_period_end", "provider", "provider_subscription_id", "price_usd", "started_at"];
    rows = data.map((x) => [x.user_id, x.email, x.plan, x.status, x.state, x.cancel_at_period_end, x.current_period_start, x.current_period_end, x.provider, x.provider_subscription_id, x.price_usd, x.started_at]);
  } else if (kind === "payments") {
    const range = parseRange({ range: sp.range, from: sp.from, to: sp.to });
    const data = await allPages<Record<string, any>>((o) => adminRpc(s, "admin_payments_page", { p_from: iso(range.from), p_to: iso(range.to), p_status: sp.status || null, p_limit: 500, p_offset: o }), 500);
    head = ["id", "created_at", "fulfilled_at", "refunded_at", "email", "provider", "provider_transaction_id", "kind", "product_key", "amount", "currency", "status", "failure_reason"];
    rows = data.map((p) => [p.id, p.created_at, p.fulfilled_at, p.refunded_at, p.email, p.provider, p.provider_transaction_id, p.kind, p.product_key, p.amount, p.currency, p.status, p.failure_reason]);
  } else {
    const data = await allPages<Record<string, any>>((o) => adminRpc(s, "admin_audit_page", { p_action: null, p_limit: 200, p_offset: o }), 200);
    head = ["id", "created_at", "administrator", "action", "target_type", "target_id", "reason", "details", "hash"];
    rows = data.map((e) => [e.id, e.created_at, e.actor_email, e.action, e.target_type, e.target_id, e.reason, e.details, e.hash]);
  }

  await adminRpc(s, "admin_audit_write", { p_action: `export.${kind}`, p_details: { rows: rows.length, filters: sp }, p_ip: await requestIp() });
  return new NextResponse(toCsv(head, rows), { headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="toprot-${kind}-${new Date().toISOString().slice(0, 10)}.csv"` } });
}

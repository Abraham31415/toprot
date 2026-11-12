/* eslint-disable @typescript-eslint/no-explicit-any -- rows from the database reports are untyped JSON and are only read field by field */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The server actions, the CSV export route, the event endpoint and the request proxy, with the database and sign-in service stood in.
const w = vi.hoisted(() => ({
  session: null as null | { userId: string; role: string; db: any },
  rpc: [] as { fn: string; args: any }[],
  rpcFail: null as string | null,
  banCalls: [] as any[],
  inserted: [] as any[],
  suspended: false,
  lookupFails: false,
  user: { id: "u1" } as { id: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${to};307;` }); },
  notFound: () => { throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }); },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/admin/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/auth")>("@/lib/admin/auth");
  const session = () => {
    if (!w.session) throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    return w.session;
  };
  return {
    ...actual,
    requireAdmin: async () => session(),
    requireAdminWrite: async () => { const s = session(); if (s.role === "viewer") throw new actual.AdminActionError("Your administrator role is read-only, so you cannot make changes."); return s; },
    requestIp: async () => "203.0.113.9",
    adminRpc: async (_s: unknown, fn: string, args: any) => { w.rpc.push({ fn, args }); if (w.rpcFail) throw new actual.AdminActionError(w.rpcFail); return { ok: true, credits_removed: 5, total: 0, rows: [] }; },
  };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert: async (r: any) => { w.inserted.push(r); return { error: null }; } }) }) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: w.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (w.lookupFails ? { data: null, error: { message: "boom" } } : { data: w.suspended ? { user_id: "u1" } : null, error: null }) }) }) }),
  }),
}));

import { grantAction, revokeAction, suspensionAction } from "@/app/admin/users/[id]/actions";
import { settingAction } from "@/app/admin/settings/actions";
import { GET as exportGet } from "@/app/admin/export/[kind]/route";
import { POST as eventsPost } from "@/app/api/e/route";
import { updateSession } from "@/lib/supabase/middleware";
import { resetRateLimits } from "@/lib/rate-limit";

const UID = "11111111-2222-4333-8444-555555555555";
const LOT = "66666666-7777-4888-8999-000000000000";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const db = { auth: { admin: { updateUserById: async (id: string, body: any) => { w.banCalls.push({ id, body }); return { error: null }; } } } };

beforeEach(() => { w.session = { userId: "admin1", role: "admin", db }; w.rpc = []; w.rpcFail = null; w.banCalls = []; w.inserted = []; w.suspended = false; w.lookupFails = false; w.user = { id: "u1" }; resetRateLimits(); });

describe("account actions", () => {
  it("refuse without a reason, before any change is attempted", async () => {
    expect(await suspensionAction(undefined, form({ user: UID, suspend: "1", reason: "short" }))).toMatchObject({ ok: false });
    expect(await grantAction(undefined, form({ user: UID, credits: "10", days: "30", reason: "" }))).toMatchObject({ ok: false });
    expect(await revokeAction(undefined, form({ user: UID, lot: LOT, reason: "no" }))).toMatchObject({ ok: false });
    expect(w.rpc).toEqual([]);
    expect(w.banCalls).toEqual([]);
  });
  it("refuse a read-only administrator and a request from someone who is not an administrator", async () => {
    w.session = { userId: "v", role: "viewer", db };
    expect(await suspensionAction(undefined, form({ user: UID, suspend: "1", reason: "a valid reason here" }))).toMatchObject({ ok: false, error: expect.stringMatching(/read-only/) });
    expect(w.rpc).toEqual([]);
    w.session = null;
    await expect(suspensionAction(undefined, form({ user: UID, suspend: "1", reason: "a valid reason here" }))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    await expect(grantAction(undefined, form({ user: UID, credits: "5", days: "5", reason: "a valid reason here" }))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(w.rpc).toEqual([]);
  });
  it("suspend through the audited database function, and also stop the sign-in service issuing sessions", async () => {
    const r = await suspensionAction(undefined, form({ user: UID, suspend: "1", reason: "Repeated abuse of the assistant" }));
    expect(r).toMatchObject({ ok: true });
    expect(w.rpc[0]).toEqual({ fn: "admin_set_suspension", args: { p_user: UID, p_suspend: true, p_reason: "Repeated abuse of the assistant", p_ip: "203.0.113.9" } });
    expect(w.banCalls[0]).toEqual({ id: UID, body: { ban_duration: "876000h" } });
    await suspensionAction(undefined, form({ user: UID, suspend: "0", reason: "Resolved with the person" }));
    expect(w.banCalls[1].body).toEqual({ ban_duration: "none" });
  });
  it("show the database's refusal instead of claiming success", async () => {
    w.rpcFail = "You cannot suspend yourself.";
    expect(await suspensionAction(undefined, form({ user: UID, suspend: "1", reason: "a valid reason here" }))).toEqual({ ok: false, error: "You cannot suspend yourself." });
    expect(w.banCalls).toEqual([]);
  });
  it("reject ids that are not ids and non-numbers, and grant and revoke only through the database", async () => {
    expect(await suspensionAction(undefined, form({ user: "../../etc", suspend: "1", reason: "a valid reason here" }))).toMatchObject({ ok: false });
    expect(await grantAction(undefined, form({ user: UID, credits: "many", days: "30", reason: "a valid reason here" }))).toMatchObject({ ok: false });
    expect(await grantAction(undefined, form({ user: UID, credits: "50", days: "30", reason: "Pilot programme allowance" }))).toMatchObject({ ok: true });
    expect(w.rpc.at(-1)).toMatchObject({ fn: "admin_grant_credits", args: { p_user: UID, p_credits: 50, p_days: 30 } });
    expect(await revokeAction(undefined, form({ user: UID, lot: LOT, reason: "Issued to the wrong person" }))).toMatchObject({ ok: true, message: expect.stringContaining("5") });
  });
  it("accept only listed settings, in range, with a reason, and convert units", async () => {
    expect(await settingAction(undefined, form({ key: "ai.credit_value_micro_usd", value: "1", reason: "a valid reason here" }))).toMatchObject({ ok: false });
    expect(await settingAction(undefined, form({ key: "ai.platform_daily_budget_micro_usd", value: "-5", reason: "a valid reason here" }))).toMatchObject({ ok: false });
    expect(await settingAction(undefined, form({ key: "ai.platform_daily_budget_micro_usd", value: "8", reason: "short" }))).toMatchObject({ ok: false });
    expect(w.rpc).toEqual([]);
    expect(await settingAction(undefined, form({ key: "ai.platform_daily_budget_micro_usd", value: "8", reason: "Higher budget for the pilot" }))).toMatchObject({ ok: true });
    expect(w.rpc[0].args).toMatchObject({ p_scope: "ai", p_key: "platform_daily_budget_micro_usd", p_value: 8_000_000 });
  });
});

describe("CSV exports", () => {
  const get = (kind: string, q = "") => exportGet(new Request(`https://x.test/admin/export/${kind}${q}`), { params: Promise.resolve({ kind }) });
  it("need an administrator", async () => {
    w.session = null;
    await expect(get("users")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
  it("refuse an unknown kind, honour the hourly limit, and are never cached", async () => {
    expect((await get("secrets")).status).toBe(404);
    w.rpcFail = "limit";
    const limited = await get("users");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-store");
  });
  it("return a CSV attachment and record the export in the audit log", async () => {
    const res = await get("audit");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="toprot-audit-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(w.rpc.map((r) => r.fn)).toContain("admin_audit_write");
    expect(w.rpc.find((r) => r.fn === "admin_audit_write")!.args.p_action).toBe("export.audit");
  });
});

describe("page tracking endpoint", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) => eventsPost(new Request("https://toprot.test/api/e", { method: "POST", body: JSON.stringify(body), headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120", host: "toprot.test", ...headers } }));
  it("stores a page view without an address, a user agent or a query string, and says 204 whatever happens", async () => {
    const res = await post({ e: "page_view", p: "/pricing?x=secret", r: "https://www.google.com/search?q=secret", q: "?utm_source=news&utm_campaign=launch&token=abc" }, { "x-vercel-ip-country": "ug" });
    expect(res.status).toBe(204);
    expect(w.inserted).toHaveLength(1);
    const row = w.inserted[0];
    expect(row).toMatchObject({ event: "page_view", path: "/pricing", referrer_host: "google.com", utm_source: "news", utm_campaign: "launch", country: "UG", device: "desktop", authenticated: false });
    expect(JSON.stringify(row)).not.toMatch(/secret|abc|Mozilla|203\./);
    expect(res.headers.get("set-cookie")).toMatch(/tp_attr=.*HttpOnly/i);
  });
  it("ignores bots, opted-out browsers, private pages, unknown events and oversized or broken bodies", async () => {
    await post({ e: "page_view", p: "/pricing" }, { "user-agent": "Googlebot/2.1" });
    await post({ e: "page_view", p: "/pricing" }, { dnt: "1" });
    await post({ e: "page_view", p: "/pricing" }, { "sec-gpc": "1" });
    await post({ e: "page_view", p: "/admin/users" });
    await post({ e: "calculator_completed", p: "/tools/x", t: "Not A Tool" });
    await post({ e: "purchase", p: "/pricing" });
    expect((await eventsPost(new Request("https://toprot.test/api/e", { method: "POST", body: "{not json", headers: { "user-agent": "Mozilla/5.0 Chrome" } }))).status).toBe(204);
    expect((await eventsPost(new Request("https://toprot.test/api/e", { method: "POST", body: "x".repeat(5000), headers: { "user-agent": "Mozilla/5.0 Chrome" } }))).status).toBe(204);
    expect(w.inserted).toEqual([]);
  });
  it("records a calculator run with only its short tool name, and marks a signed-in visitor", async () => {
    await post({ e: "calculator_completed", p: "/tools/odds-ratio-calculator", t: "odds-ratio-calculator" }, { cookie: "sb-abc-auth-token=x" });
    expect(w.inserted[0]).toMatchObject({ event: "calculator_completed", props: { tool: "odds-ratio-calculator" }, authenticated: true });
  });
  it("is rate limited per address", async () => {
    for (let i = 0; i < 125; i++) await post({ e: "page_view", p: "/pricing" }, { "x-forwarded-for": "198.51.100.1" });
    expect(w.inserted.length).toBeLessThanOrEqual(120);
  });
});

describe("suspension at the request proxy", () => {
  const req = (path: string) => { const r: any = new Request(`https://toprot.test${path}`); r.cookies = { getAll: () => [], set: () => {} }; r.nextUrl = new URL(`https://toprot.test${path}`); return r; };
  it("sends a suspended account to the notice page on pages and actions", async () => {
    w.suspended = true;
    for (const path of ["/dashboard", "/studies/abc/protocol", "/tools", "/billing"]) {
      const res = await updateSession(req(path));
      expect(res.status, path).toBe(303);
      expect(res.headers.get("location")).toBe("https://toprot.test/suspended");
    }
  });
  it("leaves the notice page, sign-out, the auth callback and payment webhooks alone", async () => {
    w.suspended = true;
    for (const path of ["/suspended", "/logout", "/auth/callback", "/api/billing/dodo-webhook"]) expect((await updateSession(req(path))).status, path).toBe(200);
  });
  it("does nothing for an account that is not suspended, a visitor who is signed out, or when the lookup fails", async () => {
    expect((await updateSession(req("/dashboard"))).status).toBe(200);
    w.user = null; w.suspended = true;
    expect((await updateSession(req("/dashboard"))).status).toBe(200);
    w.user = { id: "u1" }; w.lookupFails = true;
    expect((await updateSession(req("/dashboard"))).status).toBe(200);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AdminDb } from "./db-harness";

let db: AdminDb;
let owner: string;
let viewer: string;
let plain: string;

const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
const range = (from = day(30), to = new Date(Date.now() + 3600_000).toISOString()) => ({ p_from: from, p_to: to });
const ref = () => `tx-${randomUUID()}`;

async function profile(id: string, name: string) {
  await db.pool.query("insert into public.profiles (id, role, full_name) values ($1, 'student', $2) on conflict (id) do update set full_name = excluded.full_name", [id, name]);
}
async function pay(user: string, over: Partial<{ kind: string; product: string; amount: number; currency: string; status: string; at: string; meta: object }> = {}) {
  const o = { kind: "subscription", product: "pro", amount: 7.99, currency: "USD", status: "succeeded", at: new Date().toISOString(), meta: {}, ...over };
  const r = await db.pool.query(
    `insert into public.payments (user_id, provider, tx_ref, kind, product_key, amount, currency, status, created_at, fulfilled_at, refunded_at, meta)
     values ($1, 'dodo', $2, $3, $4, $5, $6, $7, $8, case when $7 in ('succeeded','refunded') then $8::timestamptz end, case when $7 = 'refunded' then $8::timestamptz end, $9) returning id`,
    [user, ref(), o.kind, o.product, o.amount, o.currency, o.status, o.at, JSON.stringify(o.meta)],
  );
  return r.rows[0].id as string;
}
async function subscribe(user: string, over: Partial<{ status: string; endsInDays: number; cancel: boolean }> = {}) {
  const o = { status: "active", endsInDays: 20, cancel: false, ...over };
  await db.pool.query(
    `insert into public.ai_subscriptions (user_id, plan, status, current_period_start, current_period_end, provider, provider_subscription_id, cancel_at_period_end)
     values ($1, 'pro', $2, now() - interval '10 days', now() + make_interval(days => $3), 'dodo', $4, $5)`,
    [user, o.status, o.endsInDays, `sub_${user.slice(0, 8)}`, o.cancel],
  );
}
async function aiEvent(user: string, over: Partial<{ status: string; costMicro: number; charged: number; input: number; output: number; at: string; error: string | null }> = {}) {
  const o = { status: "committed", costMicro: 12_000, charged: 12_000, input: 1000, output: 400, at: new Date().toISOString(), error: null, ...over };
  const feature = (await db.pool.query("select feature_key from public.ai_features limit 1")).rows[0].feature_key;
  const model = (await db.pool.query("select model_id from public.ai_model_pricing limit 1")).rows[0].model_id;
  let period = (await db.pool.query("select id from public.ai_credit_periods where user_id = $1 limit 1", [user])).rows[0]?.id;
  if (!period) period = (await db.pool.query("insert into public.ai_credit_periods (user_id, kind, period_start, period_end, allowance_mcr) values ($1, 'pro', now() - interval '10 days', now() + interval '20 days', 2000000) returning id", [user])).rows[0].id;
  await db.pool.query(
    `insert into public.ai_usage_events (user_id, period_id, idempotency_key, feature_key, model_id, status, reserved_mcr, reserved_micro_usd, charged_mcr, cost_micro_usd, input_tokens, output_tokens, platform_day, expires_at, finished_at, error_code, created_at)
     values ($1, $2, $3, $4, $5, $6, 0, 0, $7, $8, $9, $10, ($11::timestamptz at time zone 'UTC')::date, now() + interval '1 day', $11::timestamptz + interval '4 seconds', $12, $11)`,
    [user, period, randomUUID(), feature, model, o.status, o.charged, o.costMicro, o.input, o.output, o.at, o.error],
  );
}

beforeAll(async () => {
  db = await AdminDb.create();
  owner = await db.admin("owner");
  viewer = await db.admin("viewer");
  plain = await db.user("plain@test.local");
  await db.pool.query("update public.billing_settings set value_num = 100 where key = 'admin_sensitive_ops_per_hour'");
}, 120_000);
afterAll(async () => { await db.close(); });

describe("access control", () => {
  it("rejects every admin function for an account that is not an administrator", async () => {
    for (const [fn, args] of [
      ["admin_overview", { p_actor: plain, ...range() }], ["admin_users_page", { p_actor: plain }], ["admin_subscriptions", { p_actor: plain, ...range() }],
      ["admin_credits", { p_actor: plain }], ["admin_revenue", { p_actor: plain, ...range() }], ["admin_ai_usage", { p_actor: plain, ...range() }],
      ["admin_research", { p_actor: plain, ...range() }], ["admin_traffic", { p_actor: plain, ...range() }], ["admin_funnel", { p_actor: plain, ...range() }],
      ["admin_system", { p_actor: plain }], ["admin_audit_page", { p_actor: plain }], ["admin_audit_verify", { p_actor: plain }],
      ["admin_user_detail", { p_actor: plain, p_user: owner }], ["admin_credit_transactions", { p_actor: plain, p_user: owner }],
    ] as [string, Record<string, unknown>][]) await db.rpcFails(fn, args, "not_admin");
  });

  it("rejects every change from a non-administrator and from a read-only administrator", async () => {
    const target = await db.user();
    for (const actor of [plain, viewer]) {
      const expected = actor === plain ? "not_admin" : "read_only_admin";
      await db.rpcFails("admin_set_suspension", { p_actor: actor, p_user: target, p_suspend: true, p_reason: "a valid reason here" }, expected);
      await db.rpcFails("admin_grant_credits", { p_actor: actor, p_user: target, p_credits: 10, p_days: 30, p_reason: "a valid reason here" }, expected);
      await db.rpcFails("admin_set_setting", { p_actor: actor, p_scope: "billing", p_key: "payment_fee_pct", p_value: 3, p_reason: "a valid reason here" }, expected);
    }
    // A read-only administrator can still read.
    expect((await db.rpc("admin_overview", { p_actor: viewer, ...range() })).users.total).toBeGreaterThan(0);
  });

  it("keeps browser roles out of the admin tables and functions", async () => {
    const someone = await db.user();
    await expect(db.asRole("authenticated", someone, "insert into public.app_admins (user_id) values ($1)", [someone])).rejects.toThrow(/permission denied/);
    await expect(db.asRole("anon", null, "insert into public.app_admins (user_id) values ($1)", [someone])).rejects.toThrow(/permission denied/);
    await expect(db.asRole("authenticated", someone, "select * from public.app_admins")).rejects.toThrow(/permission denied/);
    await expect(db.asRole("authenticated", someone, "select * from public.admin_audit_log")).rejects.toThrow(/permission denied/);
    await expect(db.asRole("authenticated", someone, "select * from public.product_events")).rejects.toThrow(/permission denied/);
    await expect(db.asRole("authenticated", someone, "select public.admin_overview($1, now() - interval '1 day', now())", [owner])).rejects.toThrow(/permission denied/);
    await expect(db.asRole("anon", null, "select public.admin_users_page($1)", [owner])).rejects.toThrow(/permission denied/);
    await expect(db.asRole("authenticated", someone, "select public.admin_grant_credits($1, $1, 5, 30, 'a valid reason here')", [someone])).rejects.toThrow(/permission denied/);
    await expect(db.asRole("authenticated", someone, "update public.app_admins set role = 'owner'")).rejects.toThrow(/permission denied/);
  });

  it("does not let a user profile or signup grant administrator status", async () => {
    const id = await db.user();
    await profile(id, "Self Promoter");
    await expect(db.asRole("authenticated", id, "update public.profiles set role = 'student' where id = $1", [id])).resolves.toBeDefined();
    expect((await db.pool.query("select count(*) from public.app_admins where user_id = $1", [id])).rows[0].count).toBe("0");
    await db.rpcFails("admin_overview", { p_actor: id, ...range() }, "not_admin");
  });
});

describe("audit log", () => {
  it("records entries in a chain that verifies", async () => {
    await db.rpc("admin_audit_write", { p_actor: owner, p_action: "test.one", p_target_type: "user", p_target_id: "x", p_reason: "first", p_details: { a: 1 } });
    await db.rpc("admin_audit_write", { p_actor: owner, p_action: "test.two", p_details: { b: 2 } });
    const v = await db.rpc("admin_audit_verify", { p_actor: owner });
    expect(v.intact).toBe(true);
    expect(v.checked).toBeGreaterThanOrEqual(2);
    const page = await db.rpc("admin_audit_page", { p_actor: owner, p_action: "test." });
    expect(page.rows.map((r: { action: string }) => r.action)).toEqual(["test.two", "test.one"]);
  });

  it("refuses to change or remove an entry, even for the table owner", async () => {
    await expect(db.pool.query("update public.admin_audit_log set reason = 'edited'")).rejects.toThrow(/append-only/);
    await expect(db.pool.query("delete from public.admin_audit_log")).rejects.toThrow(/append-only/);
    await expect(db.pool.query("truncate public.admin_audit_log")).rejects.toThrow(/append-only/);
  });

  it("detects tampering that bypasses the guards", async () => {
    await db.pool.query("alter table public.admin_audit_log disable trigger admin_audit_no_change");
    const id = (await db.pool.query("select id from public.admin_audit_log where action = 'test.one'")).rows[0].id;
    await db.pool.query("update public.admin_audit_log set reason = 'rewritten' where id = $1", [id]);
    await db.pool.query("alter table public.admin_audit_log enable trigger admin_audit_no_change");
    const v = await db.rpc("admin_audit_verify", { p_actor: owner });
    expect(v.intact).toBe(false);
    expect(Number(v.first_bad_id)).toBe(Number(id));
    // Put it back so later tests see an intact log.
    await db.pool.query("alter table public.admin_audit_log disable trigger admin_audit_no_change");
    await db.pool.query("update public.admin_audit_log set reason = 'first' where id = $1", [id]);
    await db.pool.query("alter table public.admin_audit_log enable trigger admin_audit_no_change");
    expect((await db.rpc("admin_audit_verify", { p_actor: owner })).intact).toBe(true);
  });

  it("keeps the chain whole under concurrent writes", async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => db.rpc("admin_audit_write", { p_actor: owner, p_action: "test.concurrent", p_details: { i } })));
    expect((await db.rpc("admin_audit_verify", { p_actor: owner })).intact).toBe(true);
  });

  it("limits how many sensitive actions one administrator can take in an hour", async () => {
    const limited = await db.admin();
    const target = await db.user();
    await db.pool.query("update public.billing_settings set value_num = 2 where key = 'admin_sensitive_ops_per_hour'");
    try {
      await db.rpc("admin_set_suspension", { p_actor: limited, p_user: target, p_suspend: true, p_reason: "first sensitive action" });
      await db.rpc("admin_set_suspension", { p_actor: limited, p_user: target, p_suspend: false, p_reason: "second sensitive action" });
      await db.rpcFails("admin_set_suspension", { p_actor: limited, p_user: target, p_suspend: true, p_reason: "third sensitive action" }, "rate_limited");
    } finally {
      await db.pool.query("update public.billing_settings set value_num = 100 where key = 'admin_sensitive_ops_per_hour'");
    }
  });
});

describe("suspension", () => {
  it("needs a reason, refuses to suspend an administrator or yourself, and is audited", async () => {
    const target = await db.user();
    await db.rpcFails("admin_set_suspension", { p_actor: owner, p_user: target, p_suspend: true, p_reason: "short" }, "reason_required");
    await db.rpcFails("admin_set_suspension", { p_actor: owner, p_user: viewer, p_suspend: true, p_reason: "a valid reason here" }, "cannot_suspend_admin");
    await db.rpcFails("admin_set_suspension", { p_actor: owner, p_user: owner, p_suspend: true, p_reason: "a valid reason here" }, "cannot_suspend_admin");
    await db.rpc("admin_set_suspension", { p_actor: owner, p_user: target, p_suspend: true, p_reason: "Repeated abuse of the AI assistant" });
    expect((await db.pool.query("select reason from public.account_suspensions where user_id = $1", [target])).rows[0].reason).toBe("Repeated abuse of the AI assistant");
    await db.rpc("admin_set_suspension", { p_actor: owner, p_user: target, p_suspend: false, p_reason: "Resolved with the user by email" });
    expect((await db.pool.query("select count(*) from public.account_suspensions where user_id = $1", [target])).rows[0].count).toBe("0");
    const actions = (await db.rpc("admin_audit_page", { p_actor: owner, p_action: "account." })).rows.filter((r: { target_id: string }) => r.target_id === target).map((r: { action: string }) => r.action);
    expect(actions).toEqual(["account.restore", "account.suspend"]);
  });

  it("lets a person read only their own suspension and never change it", async () => {
    const a = await db.user(); const b = await db.user();
    await db.rpc("admin_set_suspension", { p_actor: owner, p_user: a, p_suspend: true, p_reason: "A reason long enough" });
    await db.rpc("admin_set_suspension", { p_actor: owner, p_user: b, p_suspend: true, p_reason: "A reason long enough" });
    expect(await db.asRole("authenticated", a, "select user_id from public.account_suspensions")).toEqual([{ user_id: a }]);
    await expect(db.asRole("authenticated", a, "delete from public.account_suspensions where user_id = $1", [a])).rejects.toThrow(/permission denied/);
    await expect(db.asRole("authenticated", a, "update public.account_suspensions set reason = 'x' where user_id = $1", [a])).rejects.toThrow(/permission denied/);
    expect(await db.asRole("anon", null, "select 1 as ok").catch(() => [])).toBeDefined();
  });
});

describe("credit grants", () => {
  it("issues a separate, expiring lot, adds to the balance, and is audited with its reason", async () => {
    const u = await db.user();
    const before = await db.rpc("ai_get_headroom", { p_user: u });
    const r = await db.rpc("admin_grant_credits", { p_actor: owner, p_user: u, p_credits: 100, p_days: 30, p_reason: "Compensation for the outage on Monday" });
    expect(r.ok).toBe(true);
    const after = await db.rpc("ai_get_headroom", { p_user: u });
    expect(Number(after.purchased_available_mcr) - Number(before.purchased_available_mcr)).toBe(100_000);
    expect(Number(after.subscription_available_mcr)).toBe(Number(before.subscription_available_mcr));
    const lot = (await db.pool.query("select source, credits_mcr, note from public.ai_credit_lots where id = $1", [r.lot_id])).rows[0];
    expect(lot.source).toBe("grant");
    expect(Number(lot.credits_mcr)).toBe(100_000);
    const tx = (await db.pool.query("select kind, pool, amount_mcr from public.ai_credit_transactions where lot_id = $1", [r.lot_id])).rows[0];
    expect(tx.kind).toBe("adjustment");
    expect(tx.pool).toBe("purchased");
    const audit = (await db.rpc("admin_audit_page", { p_actor: owner, p_action: "credits.grant" })).rows[0];
    expect(audit.reason).toBe("Compensation for the outage on Monday");
    expect(audit.details).toMatchObject({ credits: 100, lot_id: r.lot_id });
  });

  it("enforces a reason, the per-grant maximum, the expiry range and the daily cap", async () => {
    const admin = await db.admin();
    const u = await db.user();
    await db.rpcFails("admin_grant_credits", { p_actor: admin, p_user: u, p_credits: 10, p_days: 30, p_reason: "no" }, "reason_required");
    await db.rpcFails("admin_grant_credits", { p_actor: admin, p_user: u, p_credits: 501, p_days: 30, p_reason: "a valid reason here" }, "credits_out_of_range");
    await db.rpcFails("admin_grant_credits", { p_actor: admin, p_user: u, p_credits: 0, p_days: 30, p_reason: "a valid reason here" }, "credits_out_of_range");
    await db.rpcFails("admin_grant_credits", { p_actor: admin, p_user: u, p_credits: 10, p_days: 400, p_reason: "a valid reason here" }, "expiry_out_of_range");
    await db.rpcFails("admin_grant_credits", { p_actor: admin, p_user: randomUUID(), p_credits: 10, p_days: 30, p_reason: "a valid reason here" }, "unknown_user");
    for (let i = 0; i < 4; i++) await db.rpc("admin_grant_credits", { p_actor: admin, p_user: u, p_credits: 500, p_days: 30, p_reason: "Pilot programme allowance" });
    await db.rpcFails("admin_grant_credits", { p_actor: admin, p_user: u, p_credits: 1, p_days: 30, p_reason: "one more than the daily cap" }, "daily_limit_reached");
  });

  it("takes back the unused part of a grant, and refuses to touch purchases or credits in use", async () => {
    const u = await db.user();
    const g = await db.rpc("admin_grant_credits", { p_actor: owner, p_user: u, p_credits: 50, p_days: 30, p_reason: "Granted by mistake in a test" });
    const r = await db.rpc("admin_revoke_grant", { p_actor: owner, p_lot: g.lot_id, p_reason: "Issued to the wrong account" });
    expect(r.credits_removed).toBe(50);
    expect(Number((await db.rpc("ai_get_headroom", { p_user: u })).purchased_available_mcr)).toBe(0);
    await db.rpcFails("admin_revoke_grant", { p_actor: owner, p_lot: g.lot_id, p_reason: "Issued to the wrong account" }, "already_expired");
    const purchase = (await db.pool.query("insert into public.ai_credit_lots (user_id, source, credits_mcr, expires_at) values ($1, 'purchase', 1000, now() + interval '30 days') returning id", [u])).rows[0].id;
    await db.rpcFails("admin_revoke_grant", { p_actor: owner, p_lot: purchase, p_reason: "Trying to remove a purchase" }, "not_a_grant");
  });

  it("does not change a payment, a subscription or an existing balance", async () => {
    const u = await db.user();
    await profile(u, "Buyer");
    await subscribe(u);
    const p = await pay(u, { kind: "pack", product: "credits_2000", amount: 4.99 });
    const snapshot = async () => JSON.stringify([(await db.pool.query("select * from public.payments where id = $1", [p])).rows, (await db.pool.query("select * from public.ai_subscriptions where user_id = $1", [u])).rows]);
    const before = await snapshot();
    await db.rpc("admin_grant_credits", { p_actor: owner, p_user: u, p_credits: 20, p_days: 10, p_reason: "Thank you for the feedback" });
    expect(await snapshot()).toBe(before);
  });
});

describe("users", () => {
  let a: string; let b: string; let c: string;
  beforeAll(async () => {
    a = await db.user("alice.search@example.org"); b = await db.user("bob.search@example.org"); c = await db.user("100%_user@example.org");
    await profile(a, "Alice Searchable"); await profile(b, "Bob Searchable"); await profile(c, "Percent Person");
    await subscribe(a);
    await pay(a); await pay(a, { kind: "pack", product: "credits_2000", amount: 4.99 });
    await db.pool.query("insert into public.studies (owner_id, title) values ($1, 'Private title that must not be shown')", [b]);
    await db.rpc("admin_set_suspension", { p_actor: owner, p_user: c, p_suspend: true, p_reason: "Chargeback abuse suspected" });
  });

  it("matches the database: the total, the plan filters and pagination", async () => {
    const all = await db.rpc("admin_users_page", { p_actor: owner, p_limit: 1000 });
    expect(all.total).toBe(Number((await db.pool.query("select count(*) from auth.users")).rows[0].count));
    const pro = await db.rpc("admin_users_page", { p_actor: owner, p_filter: "pro", p_limit: 1000 });
    expect(pro.rows.map((r: { email: string }) => r.email)).toContain("alice.search@example.org");
    expect(pro.rows.every((r: { plan: string }) => r.plan === "pro")).toBe(true);
    const proInDb = Number((await db.pool.query("select count(*) from public.ai_subscriptions where status = 'active' and current_period_end > now()")).rows[0].count);
    expect(pro.total).toBe(proInDb);
    expect((await db.rpc("admin_users_page", { p_actor: owner, p_filter: "free", p_limit: 1000 })).total).toBe(all.total - proInDb);
    const p1 = await db.rpc("admin_users_page", { p_actor: owner, p_limit: 2, p_offset: 0 });
    const p2 = await db.rpc("admin_users_page", { p_actor: owner, p_limit: 2, p_offset: 2 });
    expect(p1.rows).toHaveLength(2);
    expect(p1.total).toBe(all.total);
    expect(p1.rows.map((r: { id: string }) => r.id)).not.toEqual(p2.rows.map((r: { id: string }) => r.id));
  });

  it("searches by name or email, treating wildcard characters as plain text", async () => {
    expect((await db.rpc("admin_users_page", { p_actor: owner, p_search: "searchable" })).total).toBe(2);
    expect((await db.rpc("admin_users_page", { p_actor: owner, p_search: "ALICE.SEARCH" })).rows).toHaveLength(1);
    expect((await db.rpc("admin_users_page", { p_actor: owner, p_search: "100%_" })).rows.map((r: { id: string }) => r.id)).toEqual([c]);
    expect((await db.rpc("admin_users_page", { p_actor: owner, p_search: "%" })).total).toBe(1);
    expect((await db.rpc("admin_users_page", { p_actor: owner, p_search: "nobody-matches-this" })).total).toBe(0);
  });

  it("filters suspended, recent and active accounts and sums verified payments", async () => {
    const suspended = await db.rpc("admin_users_page", { p_actor: owner, p_filter: "suspended", p_limit: 1000 });
    expect(suspended.rows.map((r: { id: string }) => r.id)).toContain(c);
    expect(suspended.rows.every((r: { suspended: boolean }) => r.suspended)).toBe(true);
    expect(suspended.total).toBe(Number((await db.pool.query("select count(*) from public.account_suspensions")).rows[0].count));
    expect((await db.rpc("admin_users_page", { p_actor: owner, p_filter: "recent", p_limit: 1000 })).total).toBeGreaterThan(0);
    expect((await db.rpc("admin_users_page", { p_actor: owner, p_filter: "active", p_limit: 1000 })).rows.map((r: { id: string }) => r.id)).toContain(b);
    const row = (await db.rpc("admin_users_page", { p_actor: owner, p_search: "alice.search" })).rows[0];
    expect(row.plan).toBe("pro");
    expect(row.verified_payments).toEqual([{ currency: "USD", amount: 12.98, payments: 2 }]);
    expect(row.name).toBe("Alice Searchable");
    expect(Number(row.credits_available)).toBeGreaterThan(0);
  });

  it("shows a user's account without any project titles or research content, and logs the view", async () => {
    const d = await db.rpc("admin_user_detail", { p_actor: owner, p_user: b });
    expect(d.counts.projects).toBe(1);
    expect(JSON.stringify(d)).not.toContain("Private title");
    expect(d.account.email).toBe("bob.search@example.org");
    const views = (await db.rpc("admin_audit_page", { p_actor: owner, p_action: "user.view" })).rows.filter((r: { target_id: string }) => r.target_id === b);
    expect(views.length).toBeGreaterThanOrEqual(1);
    expect(await db.rpc("admin_user_detail", { p_actor: owner, p_user: randomUUID() })).toBeNull();
  });
});

// Every payment in the next suite is dated 100 to 105 days ago, so this window holds exactly those and nothing from other suites.
const W = { p_from: day(110), p_to: day(90) };

describe("subscriptions and revenue", () => {
  let s1: string; let s2: string; let s3: string; let s4: string;
  beforeAll(async () => {
    s1 = await db.user(); s2 = await db.user(); s3 = await db.user(); s4 = await db.user();
    await subscribe(s1);                                       // active
    await subscribe(s2, { cancel: true });                    // cancellation requested, access continues
    await subscribe(s3, { status: "active", endsInDays: -3 }); // period ended: expired in effect
    await pay(s1, { at: day(105) }); await pay(s1, { at: day(104) });       // first payment and a renewal
    await pay(s2, { at: day(103) });
    await pay(s3, { at: day(100), status: "refunded" });                     // a first payment that was refunded
    await pay(s4, { at: day(100), status: "failed", meta: { renewal: true } });
    await pay(s1, { kind: "pack", product: "credits_2000", amount: 4.99, at: day(104) });
  });

  it("separates cancellation requested from access that has actually ended", async () => {
    const r = await db.rpc("admin_subscriptions", { p_actor: owner, ...range(), p_limit: 100 });
    const byUser = Object.fromEntries(r.rows.map((x: { user_id: string; state: string }) => [x.user_id, x.state]));
    expect(byUser[s1]).toBe("active");
    expect(byUser[s2]).toBe("ending");
    expect(byUser[s3]).toBe("expired");
    expect(r.summary.scheduled_to_end).toBeGreaterThanOrEqual(1);
    const ending = await db.rpc("admin_subscriptions", { p_actor: owner, ...range(), p_filter: "ending" });
    expect(ending.rows.every((x: { state: string }) => x.state === "ending")).toBe(true);
    expect(r.rows.find((x: { user_id: string }) => x.user_id === s1).price_usd).toBe(Number((await db.pool.query("select amount from public.billing_prices where kind = 'plan' and product_key = 'pro' and currency = 'USD'")).rows[0].amount));
  });

  it("counts new subscriptions, renewals, failed payments and conversion from the payment records", async () => {
    const r = (await db.rpc("admin_subscriptions", { p_actor: owner, ...W })).summary;
    expect(r.new_in_range).toBe(3);        // s1, s2 and s3 paid for the first time in the window (s3's payment was later refunded)
    expect(r.renewals_in_range).toBe(1);   // s1's second subscription payment
    expect(r.failed_payments_in_range).toBe(1);
    expect(r.registered_in_range_now_paid).toBe(0); // these accounts registered today, outside the window
  });

  it("calculates revenue with refunds, estimated fees and MRR from the active pricing", async () => {
    const o = await db.rpc("admin_overview", { p_actor: owner, ...W });
    const price = Number((await db.pool.query("select amount from public.billing_prices where kind = 'plan' and product_key = 'pro' and currency = 'USD'")).rows[0].amount);
    const gross = o.revenue.gross_range.reduce((n: number, r: { amount: string }) => n + Number(r.amount), 0);
    expect(gross).toBeCloseTo(price * 4 + 4.99, 2);
    // s1, s2 and the two accounts from the earlier suite hold active paid periods; MRR is price times those, never a fixed number.
    const active = Number((await db.pool.query("select count(*) from public.ai_subscriptions s where s.status = 'active' and s.current_period_end > now()")).rows[0].count);
    expect(o.revenue.mrr_usd).toBeCloseTo(price * active, 2);
    expect(o.revenue.mrr_scheduled_to_end_usd).toBeCloseTo(price, 2);
    const pct = Number((await db.pool.query("select value_num from public.billing_settings where key = 'payment_fee_pct'")).rows[0].value_num);
    expect(o.revenue.estimated_fees_usd).toBeCloseTo(Math.round(((price * 4 + 4.99) * pct) / 100 * 100) / 100, 2);

    const wide = await db.rpc("admin_revenue", { p_actor: owner, ...W });
    expect(wide.refunds[0].amount).toBeCloseTo(price, 2);
    expect(wide.usd.refunds).toBeCloseTo(price, 2);
    expect(wide.usd.gross).toBeCloseTo(price * 4 + 4.99, 2);
    expect(wide.usd.chargebacks).toBeNull();
    expect(wide.usd.contribution_excludes_infrastructure).toBe(true);
    expect(wide.usd.infrastructure_cost).toBeNull();
    expect(wide.by_currency[0].subscription).toBeCloseTo(price * 4, 2);
    expect(wide.by_currency[0].credit_topups).toBeCloseTo(4.99, 2);
    expect(wide.series.length).toBe(21); // 20 days plus the partial day at each end, as calendar days
    expect(wide.series.reduce((n: number, d: { subscription_usd: string }) => n + Number(d.subscription_usd), 0)).toBeCloseTo(price * 4, 2);
    expect(wide.by_plan[0]).toMatchObject({ plan: "pro", currency: "USD", payments: 4 });
  });

  it("uses an infrastructure cost only when the owner has entered one", async () => {
    await db.rpc("admin_set_setting", { p_actor: owner, p_scope: "billing", p_key: "monthly_infrastructure_cost_usd", p_value: 30, p_reason: "Vercel and Supabase plans" });
    const r = await db.rpc("admin_revenue", { p_actor: owner, ...W });
    expect(r.usd.infrastructure_cost).toBeCloseTo(20, 0); // 30 per month for a 20 day window
    expect(r.usd.contribution_excludes_infrastructure).toBe(false);
  });
});

describe("credits and AI usage", () => {
  let u1: string; let u2: string;
  beforeAll(async () => {
    u1 = await db.user("heavy@test.local"); u2 = await db.user("light@test.local");
    await aiEvent(u1, { costMicro: 500_000, charged: 500_000 }); await aiEvent(u1, { costMicro: 20_000, charged: 20_000, status: "failed", error: "provider_error" });
    await aiEvent(u2, { costMicro: 8_000, charged: 8_000 });
  });

  it("reports credit totals from the ledgers and finds no overdrawn balance", async () => {
    const c = await db.rpc("admin_credits", { p_actor: owner });
    expect(c.ledger_check).toEqual({ lots_overdrawn: 0, periods_overdrawn: 0, negative_reserved: 0 });
    const alloc = Number((await db.pool.query("select coalesce(sum(allowance_mcr),0) as s from public.ai_credit_periods where kind = 'pro'")).rows[0].s) / 1000;
    expect(c.allocated.subscription_credits).toBeCloseTo(alloc, 1);
    expect(c.available.total).toBeCloseTo(c.available.subscription + c.available.purchased_and_granted, 3);
    expect(c.exposure_usd).toBeCloseTo((c.available.total * c.credit_value_micro_usd) / 1e6, 1);
    expect(c.top_users[0].email).toBe("heavy@test.local");
  });

  it("lists a user's credit transactions with their pool, source and running balance", async () => {
    const t = await db.rpc("admin_credit_transactions", { p_actor: owner, p_user: (await db.pool.query("select user_id from public.ai_credit_lots where source = 'grant' limit 1")).rows[0].user_id });
    expect(t.total).toBeGreaterThan(0);
    expect(t.rows[0]).toHaveProperty("pool_running_balance");
    expect(t.rows.some((r: { credit_source: string }) => r.credit_source === "grant")).toBe(true);
  });

  it("totals AI requests, tokens, cost, failures and the most expensive requests", async () => {
    const a = await db.rpc("admin_ai_usage", { p_actor: owner, ...range() });
    expect(a.totals.requests).toBe(3);
    expect(a.totals.failed).toBe(1);
    expect(a.totals.input_tokens).toBe(3000);
    expect(a.totals.output_tokens).toBe(1200);
    expect(a.totals.cost_usd).toBeCloseTo(0.528, 4);
    expect(a.totals.avg_seconds).toBeCloseTo(4, 0);
    expect(a.most_expensive[0].cost_usd).toBeCloseTo(0.5, 4);
    expect(a.errors[0]).toMatchObject({ code: "provider_error", requests: 1 });
    expect(a.by_feature.reduce((n: number, f: { requests: number }) => n + Number(f.requests), 0)).toBe(3);
    expect(a.budget.monthly_budget_usd).toBe(150);
  });

  it("lets the owner change a limit only within bounds, with a reason, and records old and new values", async () => {
    await db.rpcFails("admin_set_setting", { p_actor: owner, p_scope: "ai", p_key: "credit_value_micro_usd", p_value: 1, p_reason: "not an editable key" }, "setting_not_editable");
    await db.rpcFails("admin_set_setting", { p_actor: owner, p_scope: "ai", p_key: "platform_daily_budget_micro_usd", p_value: 5_000_000, p_reason: "short" }, "reason_required");
    await db.rpc("admin_set_setting", { p_actor: owner, p_scope: "ai", p_key: "platform_daily_budget_micro_usd", p_value: 8_000_000, p_reason: "Higher budget for the pilot" });
    expect(Number((await db.pool.query("select value_num from public.ai_settings where key = 'platform_daily_budget_micro_usd'")).rows[0].value_num)).toBe(8_000_000);
    const entry = (await db.rpc("admin_audit_page", { p_actor: owner, p_action: "setting.change" })).rows[0];
    expect(entry.details).toMatchObject({ old: 5_000_000, new: 8_000_000 });
    const feature = (await db.pool.query("select feature_key from public.ai_features limit 1")).rows[0].feature_key;
    await db.rpcFails("admin_set_feature_limits", { p_actor: owner, p_feature: feature, p_max_iterations: 99, p_max_tool_calls: 5, p_max_op_cost_usd: 1, p_enabled: true, p_reason: "out of range iterations" }, "invalid_value");
    await db.rpc("admin_set_feature_limits", { p_actor: owner, p_feature: feature, p_max_iterations: 4, p_max_tool_calls: 6, p_max_op_cost_usd: 0.2, p_enabled: true, p_reason: "Tighten the agent limits" });
    expect((await db.pool.query("select max_iterations, max_tool_calls, max_op_cost_micro_usd from public.ai_features where feature_key = $1", [feature])).rows[0]).toEqual({ max_iterations: 4, max_tool_calls: 6, max_op_cost_micro_usd: "200000" });
  });

  it("reports the month's platform spend for the application-level monthly guard", async () => {
    const s = await db.rpc("ai_platform_month_status");
    expect(Number(s.budget_micro_usd)).toBe(150_000_000);
    expect(Number(s.spent_micro_usd)).toBeGreaterThanOrEqual(0);
  });
});

describe("research activity, traffic and the funnel", () => {
  let r1: string; let r2: string;
  beforeAll(async () => {
    r1 = await db.user(); r2 = await db.user();
    await profile(r1, "Reg One"); await profile(r2, "Reg Two");
    const study = (await db.pool.query("insert into public.studies (owner_id, title) values ($1, 'Funnel study') returning id", [r1])).rows[0].id;
    await db.pool.query("insert into public.saved_calculations (study_id, tool_slug, tool_name, inputs, result, created_by) values ($1, 'sample-size-proportion', 'Sample size', '{}', '{}', $2)", [study, r1]);
    await db.pool.query("insert into public.study_references (study_id, identifier_type, title, source) values ($1, 'doi', 'A paper', 'crossref')", [study]);
    for (const [event, vis, path, ref, utm, auth, country, dev] of [
      ["page_view", "v1", "/", "google.com", null, false, "UG", "mobile"], ["page_view", "v1", "/pricing", null, null, false, "UG", "mobile"],
      ["page_view", "v2", "/tools", null, "newsletter", false, "KE", "desktop"], ["page_view", "v3", "/", null, null, true, "UG", "desktop"],
    ] as const) await db.pool.query("insert into public.product_events (event, visitor, path, referrer_host, utm_source, authenticated, country, device) values ($1,$2,$3,$4,$5,$6,$7,$8)", [event, vis, path, ref, utm, auth, country, dev]);
    await db.pool.query("insert into public.product_events (event, user_id, utm_source, utm_campaign) values ('signup_attribution', $1, 'newsletter', 'launch'), ('signup_attribution', $2, 'newsletter', 'launch')", [r1, r2]);
    await db.pool.query("insert into public.product_events (event, props) values ('calculator_completed', '{\"tool\":\"sample-size-proportion\"}'), ('calculator_completed', '{\"tool\":\"sample-size-proportion\"}'), ('calculator_completed', '{\"tool\":\"odds-ratio\"}')");
  });

  it("counts research activity and ranks tools from saved calculations and tracked completions", async () => {
    const r = await db.rpc("admin_research", { p_actor: owner, ...range() });
    expect(r.counts.projects_created).toBe(Number((await db.pool.query("select count(*) from public.studies")).rows[0].count));
    expect(r.counts.calculator_completions_tracked).toBe(3);
    expect(r.counts.references_by_source).toEqual({ crossref: 1 });
    expect(r.top_tools[0]).toMatchObject({ tool_slug: "sample-size-proportion", saved: 1 });
    expect(r.top_tools_tracked[0]).toMatchObject({ tool: "sample-size-proportion", completions: 2 });
    expect(r.tracking_since).not.toBeNull();
  });

  it("summarises traffic, separating anonymous visitors from signed-in ones", async () => {
    const t = await db.rpc("admin_traffic", { p_actor: owner, ...range() });
    expect(t.totals).toMatchObject({ page_views: 4, authenticated_views: 1, anonymous_views: 3 });
    expect(t.totals.visitor_days).toBe(3);
    expect(t.top_pages[0]).toMatchObject({ path: "/", views: 2 });
    expect(t.referrers.map((r: { referrer: string }) => r.referrer)).toContain("google.com");
    expect(t.sources.map((r: { source: string }) => r.source)).toEqual(expect.arrayContaining(["newsletter", "referral", "direct"]));
    expect(t.countries[0]).toEqual({ country: "UG", views: 3 });
    expect(t.devices.find((d: { device: string }) => d.device === "mobile").views).toBe(2);
    expect(t.landing_pages.find((l: { path: string }) => l.path === "/").entries).toBeGreaterThanOrEqual(1);
  });

  it("builds the funnel from real records and attributes registrations to campaigns", async () => {
    const f = await db.rpc("admin_funnel", { p_actor: owner, p_from: new Date(Date.now() - 3600_000).toISOString(), p_to: new Date(Date.now() + 3600_000).toISOString() });
    const stages = Object.fromEntries(f.stages.map((s: { key: string; count: number }) => [s.key, s.count]));
    expect(stages.registered).toBeGreaterThanOrEqual(2);
    expect(stages.tool).toBeLessThanOrEqual(stages.registered);
    expect(stages.project).toBeLessThanOrEqual(stages.tool);
    expect(stages.pro).toBeLessThanOrEqual(stages.project + stages.registered);
    expect(f.visitors).toBe(3 - 1); // anonymous visitor-days only: v1 and v2
    expect(f.campaigns[0]).toMatchObject({ campaign: "launch", source: "newsletter", registrations: 2, with_project: 1, active: 1 });
  });

  it("allows only one attribution per user and only known event names", async () => {
    await expect(db.pool.query("insert into public.product_events (event, user_id) values ('signup_attribution', $1)", [r1])).rejects.toThrow(/duplicate key/);
    await expect(db.pool.query("insert into public.product_events (event) values ('something_else')")).rejects.toThrow(/check constraint/);
  });

  it("measures daily and monthly activity and new users in the chosen timezone", async () => {
    const o = await db.rpc("admin_overview", { p_actor: owner, ...range(), p_tz: "Pacific/Kiritimati" });
    expect(o.tz).toBe("Pacific/Kiritimati");
    const u = await db.rpc("admin_overview", { p_actor: owner, ...range(), p_tz: "UTC" });
    expect(u.users.active_30d).toBeGreaterThanOrEqual(u.users.active_today);
    expect(u.users.total).toBe(Number((await db.pool.query("select count(*) from auth.users")).rows[0].count));
    expect(u.users.new_month).toBeGreaterThan(0);
    expect(u.users.suspended).toBe(Number((await db.pool.query("select count(*) from public.account_suspensions")).rows[0].count));
    expect(u.research.calculator_completions_tracked).toBe(3);
    expect(u.tracking.events_since).not.toBeNull();
  });
});

describe("alerts and system health", () => {
  it("raises an alert for a credit grant that was not made through the console, once", async () => {
    const u = await db.user();
    await db.pool.query("insert into public.ai_credit_lots (user_id, source, credits_mcr, expires_at, note) values ($1, 'grant', 5000, now() + interval '30 days', 'inserted directly')", [u]);
    const first = await db.rpc("admin_scan_alerts");
    expect(first.new_alerts).toBeGreaterThanOrEqual(1);
    const again = await db.rpc("admin_scan_alerts");
    expect(again.new_alerts).toBe(0);
    const sys = await db.rpc("admin_system", { p_actor: owner });
    const alert = sys.alerts.find((a: { kind: string }) => a.kind === "unexpected_credit_issuance");
    expect(alert).toBeDefined();
    expect(alert.severity).toBe("critical");
    await db.rpc("admin_ack_alert", { p_actor: owner, p_alert: alert.id });
    expect((await db.rpc("admin_system", { p_actor: owner })).alerts.find((a: { id: number }) => a.id === alert.id).acknowledged_at).not.toBeNull();
  });

  it("flags provider events that never finished and failed renewals, and reports job runs", async () => {
    const u = await db.user();
    const p = await pay(u, { status: "failed", meta: { renewal: true } });
    for (let i = 0; i < 3; i++) await db.pool.query("insert into public.payment_events (provider, event_key, payment_id, outcome, received_at) values ('dodo', $1, $2, 'received', now() - interval '1 hour')", [`stuck-${i}-${randomUUID()}`, p]);
    await db.rpc("admin_scan_alerts");
    const kinds = (await db.rpc("admin_system", { p_actor: owner })).alerts.map((a: { kind: string }) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["failed_renewals", "webhook_failures"]));
    const id = await db.rpc("job_run_start", { p_job: "billing_maintenance" });
    await db.rpc("job_run_finish", { p_id: id, p_ok: true, p_summary: { rechecked: 0 } });
    const sys = await db.rpc("admin_system", { p_actor: owner });
    expect(sys.jobs[0]).toMatchObject({ job: "billing_maintenance", ok: true });
    expect(sys.audit.intact).toBe(true);
  });

  it("groups repeated application errors by fingerprint", async () => {
    for (let i = 0; i < 3; i++) await db.rpc("app_error_record", { p_route: "/api/x", p_name: "TypeError", p_message: "boom" });
    const e = (await db.rpc("admin_system", { p_actor: owner })).errors[0];
    expect(e).toMatchObject({ route: "/api/x", name: "TypeError", occurrences: 3 });
  });

  it("prunes old analytics events only", async () => {
    await db.pool.query("insert into public.product_events (event, created_at) values ('page_view', now() - interval '500 days')");
    const before = Number((await db.pool.query("select count(*) from public.product_events")).rows[0].count);
    expect(await db.rpc("analytics_prune", { p_days: 400 })).toBe(1);
    expect(Number((await db.pool.query("select count(*) from public.product_events")).rows[0].count)).toBe(before - 1);
  });
});

describe("existing behaviour is unchanged", () => {
  it("leaves the billing and AI ledger functions working for ordinary users", async () => {
    const u = await db.user();
    const h = await db.rpc("ai_get_headroom", { p_user: u });
    expect(h.plan_key).toBe("free");
    expect(Number(h.available_mcr)).toBeGreaterThan(0);
    expect(await db.rpc("billing_user_plan", { p_user: u })).toBe("free");
    // The browser roles still cannot call the billing functions, exactly as before.
    await expect(db.asRole("authenticated", u, "select public.ai_get_headroom($1)", [u])).rejects.toThrow(/permission denied/);
  });
});

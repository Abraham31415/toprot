/* eslint-disable @typescript-eslint/no-explicit-any -- rows from the scratch database are untyped */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminDb } from "@/lib/admin/__tests__/db-harness";
import { makeHelpers, type Person } from "./helpers";

// Stage 5: Teams plan, seats, renewals, grace, refunds, and AI credit funding.
let db: AdminDb;
const { person, project, as } = makeHelpers(() => db);
let feature = ""; let model = ""; let proFeature = ""; let proModel = ""; let unit = 0; // unit: credits (milli) held by a 20,000 micro-USD request

beforeAll(async () => {
  db = await AdminDb.create();
  // A feature the Free plan includes, so the default path works for a Free person; and one that only paid plans include.
  feature = (await db.pool.query("select f.feature_key from public.ai_features f join public.plans p on p.plan_key = 'free' and f.feature_key = any (p.ai_features) where f.enabled order by 1 limit 1")).rows[0].feature_key;
  model = (await db.pool.query("select model_chain[1] m from public.ai_features where feature_key = $1", [feature])).rows[0].m;
  proFeature = (await db.pool.query("select f.feature_key from public.ai_features f join public.plans p on p.plan_key = 'team' and f.feature_key = any (p.ai_features) join public.plans fr on fr.plan_key = 'free' and not (f.feature_key = any (fr.ai_features)) where f.enabled order by 1 limit 1")).rows[0].feature_key;
  proModel = (await db.pool.query("select model_chain[1] m from public.ai_features where feature_key = $1", [proFeature])).rows[0].m;
  unit = Number((await db.pool.query("select public.ai_micro_to_mcr(20000) n")).rows[0].n);
}, 120_000);
afterAll(async () => { await db.close(); });

const ref = () => `toprot-${randomUUID()}`;
async function enableBilling(on = true) {
  await db.pool.query("update public.billing_settings set value_num = $1 where key = 'teams_billing_enabled'", [on ? 1 : 0]);
  await db.pool.query("update public.plans set active = $1 where plan_key = 'team'", [on]);
}
const newTeam = (o: Person, name = "Lab") => db.rpc<string>("team_create", { p_actor: o.id, p_name: name });
async function pay(owner: Person, team: string, seats = 3) {
  const r = await db.rpc<any>("team_create_payment", { p_actor: owner.id, p_team: team, p_seats: seats, p_currency: "USD", p_tx_ref: ref(), p_provider: "dodo" });
  return r;
}
const fulfil = (txRef: string, amount: number, over: Record<string, unknown> = {}) =>
  db.rpc<any>("billing_fulfill_payment", { p_tx_ref: txRef, p_provider_txn: `pay_${randomUUID().slice(0, 12)}`, p_provider_status: "successful", p_amount: amount, p_currency: "USD", p_method: "card", p_event_key: null, ...over });
async function subscribed(owner: Person, seats = 3) {
  const t = await newTeam(owner);
  const p = await pay(owner, t, seats);
  expect(p.ok).toBe(true);
  expect((await fulfil(p.tx_ref, p.amount)).ok).toBe(true);
  return { team: t, payment: p };
}
const ent = async (team: string) => (await db.rpc<any>("team_entitlements", { p_team: team }));

describe("team subscription payments", () => {
  it("is off until deliberately enabled, and only the owner can start a payment", async () => {
    await enableBilling(false);
    const o = await person("Owner"); const t = await newTeam(o);
    expect((await pay(o, t)).code).toBe("teams_billing_off");
    await enableBilling(true);
    const m = await person("Mem");
    const inv = await db.rpc<any>("team_invite", { p_actor: o.id, p_team: t, p_email: m.email, p_role: "guest" });
    await db.rpc("collab_accept", { p_actor: m.id, p_token: inv.token });
    expect((await pay(m, t)).code).toBe("not_team_owner");
    expect((await pay(o, t, 2)).code).toBe("invalid_seats");
    expect((await pay(o, t, 3)).ok).toBe(true);
    expect((await db.rpc<any>("team_create_payment", { p_actor: o.id, p_team: t, p_seats: 3, p_currency: "EUR", p_tx_ref: ref(), p_provider: "dodo" })).code).toBe("invalid_request");
  });

  it("prices seats from the database: 25 for 3 seats, 6 for each extra seat", async () => {
    await enableBilling();
    const o = await person("Owner"); const t = await newTeam(o);
    expect(Number((await pay(o, t, 3)).amount)).toBe(25);
    expect(Number((await pay(o, t, 6)).amount)).toBe(43);
    await db.pool.query("update public.billing_prices set amount = 30 where product_key = 'team_seat'");
    try { expect(Number((await pay(o, t, 4)).amount)).toBe(55); } finally { await db.pool.query("update public.billing_prices set amount = 6 where product_key = 'team_seat'"); }
  });

  it("activates only after a verified payment, exactly once, and credits the pool once", async () => {
    await enableBilling();
    const o = await person("Owner"); const t = await newTeam(o);
    expect((await ent(t)).state).toBe("unsubscribed");
    const p = await pay(o, t, 4);
    expect((await fulfil(p.tx_ref, 10)).code).toBe("mismatch"); // underpaid
    const p2 = await pay(o, t, 4);
    expect((await ent(t)).state).toBe("unsubscribed"); // a pending or failed payment grants nothing
    const txn = "pay_fixed_1";
    const a = await fulfil(p2.tx_ref, p2.amount, { p_provider_txn: txn });
    const b = await fulfil(p2.tx_ref, p2.amount, { p_provider_txn: txn });
    expect(a).toMatchObject({ ok: true, duplicate: false }); expect(b).toMatchObject({ ok: true, duplicate: true });
    expect(await ent(t)).toMatchObject({ state: "active", max_paid_seats: 4 });
    expect((await db.pool.query("select balance_mcr::int b from public.team_credit_pools where team_id = $1", [t])).rows[0].b).toBe(2_000_000);
    expect((await db.pool.query("select count(*)::int n from public.team_credit_transactions where team_id = $1 and kind = 'subscription_grant'", [t])).rows[0].n).toBe(1);
    expect((await db.pool.query("select kind, team_id from public.payments where tx_ref = $1", [p2.tx_ref])).rows[0]).toMatchObject({ kind: "team_subscription", team_id: t });
  });

  it("lets seats in the Teams subscription replace the Free limits, while the owner keeps their own plan", async () => {
    await enableBilling();
    const o = await person("FreeOwner");
    const { team } = await subscribed(o, 5);
    const members = [await person("A"), await person("B"), await person("C")];
    for (const m of members) { const i = await db.rpc<any>("team_invite", { p_actor: o.id, p_team: team, p_email: m.email, p_role: "member" }); await db.rpc("collab_accept", { p_actor: m.id, p_token: i.token }); }
    const x = await person("X");
    await db.rpc<any>("team_invite", { p_actor: o.id, p_team: team, p_email: x.email, p_role: "member" }); // 5th paid seat
    await expect(db.rpc("team_invite", { p_actor: o.id, p_team: team, p_email: "sixth@test.local", p_role: "member" })).rejects.toThrow(/no_paid_seat/);
    expect(await db.rpc<string>("billing_user_plan", { p_user: o.id })).toBe("free"); // personal plan unchanged: no double charging, no free Pro
    const p = (await db.pool.query("insert into public.studies (owner_id, title, team_id) values ($1, 'T', $2) returning id", [o.id, team])).rows[0].id;
    expect(await db.rpc<string>("collab_project_plan", { p_study: p })).toBe("team");
    const ed = members[0];
    await db.rpc("team_project_add_member", { p_actor: o.id, p_study: p, p_user: ed.id, p_role: "editor" }); // editors need Pro, but the Team plan allows them
    expect(await as(ed.id, "select public.study_role($1) r", [p])).toEqual([{ r: "editor" }]);
    // a personal project of the same owner still follows the owner's Free plan
    const personal = await project(o.id);
    await expect(db.rpc("collab_invite", { p_actor: o.id, p_study: personal, p_email: "e@test.local", p_role: "editor", p_label: null })).rejects.toThrow(/role_not_in_plan/);
  });

  it("does not let a renewing subscription be bought twice", async () => {
    await enableBilling();
    const o = await person("Owner"); const { team, payment } = await subscribed(o);
    expect((await pay(o, team)).ok).toBe(true); // no provider subscription yet: a manual renewal is allowed
    await db.rpc("team_link_provider_subscription", { p_tx_ref: payment.tx_ref, p_provider_subscription_id: "sub_team_1" });
    expect((await pay(o, team)).code).toBe("already_subscribed");
    const other = await person("Other"); const t2 = await newTeam(other); const p2 = await pay(other, t2); await fulfil(p2.tx_ref, p2.amount);
    expect((await db.rpc<any>("team_link_provider_subscription", { p_tx_ref: p2.tx_ref, p_provider_subscription_id: "sub_team_1" })).code).toBe("subscription_belongs_to_another_team");
  });
});

describe("renewals, failures, cancellation, refunds", () => {
  it("renews at the stored price for the seats due, and extends the period", async () => {
    await enableBilling();
    const o = await person("Owner"); const { team, payment } = await subscribed(o, 4);
    await db.rpc("team_link_provider_subscription", { p_tx_ref: payment.tx_ref, p_provider_subscription_id: "sub_r1" });
    const before = (await db.pool.query("select current_period_end e from public.team_subscriptions where team_id = $1", [team])).rows[0].e as Date;
    const r = await db.rpc<any>("team_start_renewal_payment", { p_provider: "dodo", p_provider_subscription_id: "sub_r1", p_provider_payment_id: "pay_renew_1" });
    expect(r.ok).toBe(true);
    expect(Number((await db.pool.query("select amount from public.payments where tx_ref = $1", [r.tx_ref])).rows[0].amount)).toBe(31);
    expect((await db.rpc<any>("team_start_renewal_payment", { p_provider: "dodo", p_provider_subscription_id: "sub_r1", p_provider_payment_id: "pay_renew_1" })).existing).toBe(false); // not yet fulfilled with a transaction id
    await fulfil(r.tx_ref, 31, { p_provider_txn: "pay_renew_1" });
    const after = (await db.pool.query("select current_period_end e from public.team_subscriptions where team_id = $1", [team])).rows[0].e as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime() + 25 * 86400_000);
    expect((await db.pool.query("select balance_mcr::int b from public.team_credit_pools where team_id = $1", [team])).rows[0].b).toBe(4_000_000); // a second billing period of credits
    expect((await db.rpc<any>("team_start_renewal_payment", { p_provider: "dodo", p_provider_subscription_id: "nope", p_provider_payment_id: "pay_x" })).code).toBe("unknown_subscription");
  });

  it("gives a grace period after a failed renewal, then falls back without deleting anything", async () => {
    await enableBilling();
    const o = await person("Owner"); const { team, payment } = await subscribed(o);
    await db.rpc("team_link_provider_subscription", { p_tx_ref: payment.tx_ref, p_provider_subscription_id: "sub_g1" });
    const p = (await db.pool.query("select id from public.studies limit 0")).rows;
    expect(p).toEqual([]);
    const proj = (await db.pool.query("insert into public.studies (owner_id, title, team_id) values ($1, 'T', $2) returning id", [o.id, team])).rows[0].id;
    await db.pool.query("update public.team_subscriptions set current_period_end = now() + interval '1 hour', current_period_start = now() - interval '30 days' where team_id = $1", [team]);
    const r = await db.rpc<any>("team_start_renewal_payment", { p_provider: "dodo", p_provider_subscription_id: "sub_g1", p_provider_payment_id: "pay_fail_1" });
    await fulfil(r.tx_ref, 25, { p_provider_status: "failed", p_provider_txn: "pay_fail_1" });
    expect((await db.pool.query("select status from public.team_subscriptions where team_id = $1", [team])).rows[0].status).toBe("past_due");
    await db.pool.query("update public.team_subscriptions set current_period_end = now() - interval '1 day', current_period_start = now() - interval '31 days' where team_id = $1", [team]);
    expect((await ent(team)).state).toBe("active"); // inside the grace period
    expect(await db.rpc<string>("collab_project_plan", { p_study: proj })).toBe("team");
    await db.pool.query("update public.team_subscriptions set grace_until = now() - interval '1 minute' where team_id = $1", [team]);
    expect((await ent(team)).state).toBe("lapsed");
    expect(await db.rpc<string>("collab_project_plan", { p_study: proj })).toBe("free");
    expect(await db.rpc<number>("team_billing_sweep")).toBe(1);
    expect((await db.pool.query("select count(*)::int n from public.studies where id = $1", [proj])).rows[0].n).toBe(1); // nothing is deleted
    // paying again restores it
    const again = await pay(o, team); await fulfil(again.tx_ref, again.amount);
    expect((await ent(team)).state).toBe("active");
  });

  it("keeps access to the end of the period after cancellation", async () => {
    await enableBilling();
    const o = await person("Owner"); const { team, payment } = await subscribed(o);
    await db.rpc("team_link_provider_subscription", { p_tx_ref: payment.tx_ref, p_provider_subscription_id: "sub_c1" });
    await db.rpc("team_sync_subscription", { p_provider: "dodo", p_provider_subscription_id: "sub_c1", p_state: "cancel_at_period_end" });
    expect((await ent(team))).toMatchObject({ state: "active", cancel_at_period_end: true });
    await db.pool.query("update public.team_subscriptions set current_period_end = now() - interval '1 second', current_period_start = now() - interval '31 days' where team_id = $1", [team]);
    expect((await ent(team)).state).toBe("lapsed");
    expect(await db.rpc<number>("team_billing_sweep")).toBe(1);
    expect((await ent(team)).state).toBe("unsubscribed");
  });

  it("refunds undo only what the payment granted", async () => {
    await enableBilling();
    const o = await person("Owner"); const { team, payment } = await subscribed(o);
    const id = (await db.pool.query("select id from public.payments where tx_ref = $1", [payment.tx_ref])).rows[0].id;
    expect((await db.rpc<any>("billing_refund_payment", { p_payment: id, p_reason: "test" })).ok).toBe(true);
    expect((await ent(team)).state).not.toBe("active");
    expect((await db.pool.query("select balance_mcr::int b from public.team_credit_pools where team_id = $1", [team])).rows[0].b).toBe(0);
    // an individual Pro refund still works the way it did
    const u = await person("Solo", "pro");
    const up = (await db.pool.query("insert into public.payments (user_id, provider, tx_ref, kind, product_key, amount, currency, status) values ($1, 'dodo', $2, 'subscription', 'pro', 7.99, 'USD', 'succeeded') returning id", [u.id, ref()])).rows[0].id;
    await db.rpc("billing_refund_payment", { p_payment: up, p_reason: "test" });
    expect(await db.rpc<string>("billing_user_plan", { p_user: u.id })).toBe("free");
  });

  it("adds seats with a one-off payment and lowers them only at renewal and never below use", async () => {
    await enableBilling();
    const o = await person("Owner"); const { team } = await subscribed(o, 3);
    const add = await db.rpc<any>("team_create_seats_payment", { p_actor: o.id, p_team: team, p_add: 2, p_currency: "USD", p_tx_ref: ref(), p_provider: "dodo" });
    expect(add.ok).toBe(true);
    expect(Number(add.amount)).toBe(12); // 2 seats at the seat price, exactly what the provider will charge
    expect((await ent(team)).max_paid_seats).toBe(3); // not before payment
    await fulfil(add.tx_ref, Number(add.amount));
    expect((await ent(team))).toMatchObject({ max_paid_seats: 5, seat_sync_pending: true });
    await expect(db.rpc("team_set_next_seats", { p_actor: o.id, p_team: team, p_seats: 2 })).rejects.toThrow(/seats_in_use/);
    await db.rpc("team_set_next_seats", { p_actor: o.id, p_team: team, p_seats: 4 });
    expect((await ent(team))).toMatchObject({ max_paid_seats: 5, next_paid_seats: 4 }); // effective at renewal
    await expect(db.rpc("team_set_next_seats", { p_actor: o.id, p_team: team, p_seats: 9 })).rejects.toThrow(/use_add_seats/);
    expect((await db.rpc<any>("team_create_seats_payment", { p_actor: (await person("X")).id, p_team: team, p_add: 1, p_currency: "USD", p_tx_ref: ref(), p_provider: "dodo" })).code).toBe("not_team_owner");
  });

  it("buys pool credits only for an active team", async () => {
    await enableBilling();
    const o = await person("Owner"); const t = await newTeam(o);
    await db.pool.query("insert into public.credit_packs (pack_key, name, credits, expiry_days) values ('boost', 'Boost', 500, 90) on conflict do nothing");
    await db.pool.query("insert into public.billing_prices (kind, product_key, currency, amount) values ('pack', 'boost', 'USD', 5) on conflict do nothing");
    expect((await db.rpc<any>("team_create_pack_payment", { p_actor: o.id, p_team: t, p_pack: "boost", p_currency: "USD", p_tx_ref: ref(), p_provider: "dodo" })).code).toBe("no_active_subscription");
    const p = await pay(o, t); await fulfil(p.tx_ref, p.amount);
    const pk = await db.rpc<any>("team_create_pack_payment", { p_actor: o.id, p_team: t, p_pack: "boost", p_currency: "USD", p_tx_ref: ref(), p_provider: "dodo" });
    expect(pk.ok).toBe(true);
    await fulfil(pk.tx_ref, 5);
    expect((await db.pool.query("select balance_mcr::int b from public.team_credit_pools where team_id = $1", [t])).rows[0].b).toBe(2_000_000 + 500_000);
  });
});

describe("AI credits and team pools", () => {
  async function pooled(limits: { team?: number | null; member?: number | null } = {}) {
    await enableBilling();
    const owner = await person("Owner"); const { team } = await subscribed(owner, 4);
    const m = await person("Mem"); const g = await person("Guest");
    const inv = await db.rpc<any>("team_invite", { p_actor: owner.id, p_team: team, p_email: m.email, p_role: "member" }); await db.rpc("collab_accept", { p_actor: m.id, p_token: inv.token });
    const ginv = await db.rpc<any>("team_invite", { p_actor: owner.id, p_team: team, p_email: g.email, p_role: "guest" }); await db.rpc("collab_accept", { p_actor: g.id, p_token: ginv.token });
    await db.rpc("team_ai_pool_set", { p_actor: owner.id, p_team: team, p_enabled: true, p_team_limit: limits.team ?? null, p_member_limit: limits.member ?? null });
    return { owner, m, g, team };
  }
  const reserve = (actor: string, team: string, over: Record<string, unknown> = {}) =>
    db.rpc<any>("team_ai_reserve", { p_actor: actor, p_team: team, p_study: null, p_key: `key-${randomUUID()}`, p_feature: feature, p_model: model, p_reserve_micro_usd: 20_000, p_meta: {}, ...over });
  const commit = (event: string, input = 1000, output = 400) =>
    db.rpc<any>("ai_commit", { p_event: event, p_input: input, p_output: output, p_cache_read: 0, p_cache_write_5m: 0, p_cache_write_1h: 0, p_tool_usage: {}, p_iterations: 1, p_error_code: null, p_platform_exposure_micro_usd: 0, p_usage_known: true });
  const pool = async (team: string) => (await db.pool.query("select balance_mcr::int b, reserved_mcr::int r from public.team_credit_pools where team_id = $1", [team])).rows[0];

  it("charges the requester by default and the pool only when the person opted in", async () => {
    const { m, team } = await pooled();
    expect(await db.rpc("team_ai_user_funding", { p_user: m.id })).toBeNull();
    await db.rpc("team_ai_set_funding", { p_actor: m.id, p_team: team });
    expect(await db.rpc("team_ai_user_funding", { p_user: m.id })).toBe(team);
    await db.rpc("team_ai_set_funding", { p_actor: m.id, p_team: null });
    expect(await db.rpc("team_ai_user_funding", { p_user: m.id })).toBeNull();
    // no choice, no pool: the ordinary path charges the person's own credits
    const own = await db.rpc<any>("ai_reserve", { p_user: m.id, p_key: `key-${randomUUID()}`, p_feature: feature, p_model: model, p_reserve_micro_usd: 20_000, p_meta: {} });
    expect(own.ok).toBe(true);
    expect((await db.pool.query("select funding_source, only_lot_id from public.ai_usage_events where id = $1", [own.event_id])).rows[0]).toEqual({ funding_source: "self", only_lot_id: null });
  });

  it("funds a request from the pool atomically, settles actual usage, and leaves the person's own credits alone", async () => {
    const { m, team } = await pooled();
    const periodBefore = (await db.pool.query("select coalesce(sum(used_mcr + reserved_mcr), 0)::int n from public.ai_credit_periods where user_id = $1", [m.id])).rows[0].n;
    const r = await reserve(m.id, team);
    expect(r).toMatchObject({ ok: true, funding: "team" });
    const heldPool = await pool(team);
    expect(heldPool.r).toBeGreaterThan(0);
    expect(heldPool.b).toBe(2_000_000);
    const c = await commit(r.event_id);
    expect(c.ok).toBe(true);
    const s = await db.rpc<any>("team_ai_settle", { p_event: r.event_id });
    expect(s).toMatchObject({ ok: true });
    expect(s.charged_mcr).toBe(c.charged_mcr);
    const after = await pool(team);
    expect(after.r).toBe(0);
    expect(after.b).toBe(2_000_000 - c.charged_mcr);
    expect((await db.rpc<any>("team_ai_settle", { p_event: r.event_id })).already).toBe(true); // idempotent
    expect((await db.pool.query("select count(*)::int n from public.team_credit_transactions where event_id = $1", [r.event_id])).rows[0].n).toBe(1);
    const ev = (await db.pool.query("select funding_source, funding_team_id, charged_mcr from public.ai_usage_events where id = $1", [r.event_id])).rows[0];
    expect(ev).toMatchObject({ funding_source: "team", funding_team_id: team });
    expect((await db.pool.query("select coalesce(sum(used_mcr + reserved_mcr), 0)::int n from public.ai_credit_periods where user_id = $1", [m.id])).rows[0].n).toBe(periodBefore);
    expect((await db.pool.query("select count(*)::int n from public.ai_credit_lots where user_id = $1 and expired_at is null", [m.id])).rows[0].n).toBe(0); // the advance is closed
  });

  it("returns the whole hold when the request is released", async () => {
    const { m, team } = await pooled();
    const r = await reserve(m.id, team);
    await db.rpc("ai_release", { p_event: r.event_id, p_error_code: null, p_platform_exposure_micro_usd: 0, p_usage_known: true });
    await db.rpc("team_ai_settle", { p_event: r.event_id });
    expect(await pool(team)).toEqual({ b: 2_000_000, r: 0 });
  });

  it("refuses without touching anything when the pool is exhausted, and never goes negative", async () => {
    const { m, team } = await pooled();
    await db.pool.query("update public.team_credit_pools set balance_mcr = 10 where team_id = $1", [team]);
    const r = await reserve(m.id, team);
    expect(r).toMatchObject({ ok: false, code: "team_pool_exhausted" });
    expect(await pool(team)).toEqual({ b: 10, r: 0 });
    expect((await db.pool.query("select count(*)::int n from public.ai_usage_events where user_id = $1", [m.id])).rows[0].n).toBe(0);
    await expect(db.pool.query("update public.team_credit_pools set balance_mcr = -1 where team_id = $1", [team])).rejects.toThrow(/check/);
    await expect(db.pool.query("update public.team_credit_pools set reserved_mcr = balance_mcr + 1 where team_id = $1", [team])).rejects.toThrow(/check/);
  });

  it("rolls everything back when the ledger refuses (for example a feature the plan does not allow)", async () => {
    const { m, team } = await pooled();
    await db.pool.query("update public.ai_features set enabled = false where feature_key = $1", [feature]);
    try {
      const r = await reserve(m.id, team);
      expect(r).toMatchObject({ ok: false, code: "feature_disabled" });
    } finally { await db.pool.query("update public.ai_features set enabled = true where feature_key = $1", [feature]); }
    expect(await pool(team)).toEqual({ b: 2_000_000, r: 0 });
    expect((await db.pool.query("select count(*)::int n from public.ai_credit_lots where user_id = $1", [m.id])).rows[0].n).toBe(0);
    expect((await db.pool.query("select count(*)::int n from public.team_ai_reservations where team_id = $1", [team])).rows[0].n).toBe(0);
  });

  it("enforces team and member limits, and an approved request raises a member's limit", async () => {
    const { owner, m, team } = await pooled({ team: Math.round(unit * 3), member: Math.round(unit * 1.25) });
    expect((await reserve(m.id, team, { p_reserve_micro_usd: 20_000 })).ok).toBe(true); // 1 unit
    expect(await reserve(m.id, team, { p_reserve_micro_usd: 10_000 })).toMatchObject({ ok: false, code: "member_limit_reached" }); // 1.5 > 1.25
    const req = await db.rpc<string>("team_ai_request_more", { p_actor: m.id, p_team: team, p_mcr: unit, p_reason: "Thesis analysis" });
    await expect(db.rpc("team_ai_decide", { p_actor: m.id, p_request: req, p_approve: true, p_granted: unit })).rejects.toThrow(/not_team_admin/);
    await db.rpc("team_ai_decide", { p_actor: owner.id, p_request: req, p_approve: true, p_granted: Math.round(unit * 0.75) });
    await expect(db.rpc("team_ai_decide", { p_actor: owner.id, p_request: req, p_approve: false, p_granted: null })).rejects.toThrow(/already_decided/);
    expect((await reserve(m.id, team, { p_reserve_micro_usd: 10_000 })).ok).toBe(true); // 1.5 <= 2.0 after approval
    expect((await db.rpc<any[]>("collab_notifications", { p_actor: m.id })).map((n) => n.kind)).toContain("team_ai_budget");
    await db.rpc("team_ai_member_limit_set", { p_actor: owner.id, p_team: team, p_user: m.id, p_limit: unit * 100 });
    expect(await reserve(m.id, team, { p_reserve_micro_usd: 40_000 })).toMatchObject({ ok: false, code: "team_limit_reached" }); // 1.5 + 2 > 3 for the whole team
  });

  it("lets a person on a lower plan use features the Team plan includes, only through the pool", async () => {
    const { m, team } = await pooled();
    const own = await db.rpc<any>("ai_reserve", { p_user: m.id, p_key: `key-${randomUUID()}`, p_feature: proFeature, p_model: proModel, p_reserve_micro_usd: 20_000, p_meta: {} });
    expect(own).toMatchObject({ ok: false, code: "plan_required" });
    expect((await reserve(m.id, team, { p_feature: proFeature, p_model: proModel })).ok).toBe(true);
  });

  it("never lets credit override permissions: guests, strangers and other projects are refused", async () => {
    const { m, g, team } = await pooled();
    const x = await person("X");
    expect(await reserve(g.id, team)).toMatchObject({ ok: false, code: "team_not_member" });
    expect(await reserve(x.id, team)).toMatchObject({ ok: false, code: "team_not_member" });
    await expect(db.rpc("team_ai_set_funding", { p_actor: g.id, p_team: team })).rejects.toThrow(/not_team_member/);
    const secret = await project((await person("Other")).id, "Secret");
    expect(await reserve(m.id, team, { p_study: secret })).toMatchObject({ ok: false, code: "team_not_allowed" });
    const mine = (await db.pool.query("insert into public.studies (owner_id, title, team_id) values ($1, 'Mine', $2) returning id", [m.id, team])).rows[0].id;
    expect((await reserve(m.id, team, { p_study: mine })).ok).toBe(true);
    // the pool holds no data access: a reviewer on a project does not gain edit rights by being funded
    await expect(as(x.id, "select public.team_ai_reserve($1, $2, null, 'abcdefgh', 'f', 'm', 1, '{}')", [x.id, team])).rejects.toThrow(/permission denied/);
  });

  it("stops funding when the pool is switched off or the plan lapses, with no silent fallback to personal credits", async () => {
    const { owner, m, team } = await pooled();
    await db.rpc("team_ai_set_funding", { p_actor: m.id, p_team: team });
    await db.rpc("team_ai_pool_set", { p_actor: owner.id, p_team: team, p_enabled: false, p_team_limit: null, p_member_limit: null });
    expect(await db.rpc("team_ai_user_funding", { p_user: m.id })).toBeNull();
    expect(await reserve(m.id, team)).toMatchObject({ ok: false, code: "team_pool_disabled" });
    await db.rpc("team_ai_pool_set", { p_actor: owner.id, p_team: team, p_enabled: true, p_team_limit: null, p_member_limit: null });
    await db.pool.query("update public.team_subscriptions set status = 'expired' where team_id = $1", [team]);
    expect(await reserve(m.id, team)).toMatchObject({ ok: false, code: "team_plan_inactive" });
    await expect(db.rpc("team_ai_pool_set", { p_actor: m.id, p_team: team, p_enabled: true, p_team_limit: null, p_member_limit: null })).rejects.toThrow(/not_team_admin/);
  });

  it("reconciles reservations that were never settled and repairs drift", async () => {
    const { m, team } = await pooled();
    const r = await reserve(m.id, team);
    await db.rpc("ai_release", { p_event: r.event_id, p_error_code: "provider_error", p_platform_exposure_micro_usd: 0, p_usage_known: true });
    await db.pool.query("update public.team_ai_reservations set created_at = now() - interval '1 hour' where event_id = $1", [r.event_id]);
    const out = await db.rpc<any>("team_ai_reconcile");
    expect(out.settled).toBeGreaterThanOrEqual(1);
    expect(await pool(team)).toEqual({ b: 2_000_000, r: 0 });
    // a hold with no matching reservation is corrected and reported
    await db.pool.query("update public.team_credit_pools set reserved_mcr = 500 where team_id = $1", [team]);
    expect((await db.rpc<any>("team_ai_reconcile")).drift_fixed).toBe(1);
    expect((await pool(team)).r).toBe(0);
    expect((await db.pool.query("select count(*)::int n from public.system_alerts where kind = 'team_pool_drift'")).rows[0].n).toBe(1);
  });

  it("serialises concurrent requests so the pool is never over-reserved", async () => {
    const { owner, team } = await pooled();
    const people: Person[] = [];
    for (let i = 0; i < 4; i++) { const p = await person(`C${i}`); const inv = await db.rpc<any>("team_invite", { p_actor: owner.id, p_team: team, p_email: p.email, p_role: "member" }).catch(() => null); if (inv) { await db.rpc("collab_accept", { p_actor: p.id, p_token: inv.token }); people.push(p); } }
    await db.pool.query("update public.team_credit_pools set balance_mcr = 45000 where team_id = $1", [team]); // room for two 20-credit requests
    const results = await Promise.all(people.map((p) => reserve(p.id, team)));
    const ok = results.filter((r) => r.ok).length;
    expect(ok).toBe(2);
    expect((await pool(team)).r).toBeLessThanOrEqual(45000);
  });

  it("shows each role only what it may see", async () => {
    const { owner, m, g, team } = await pooled({ member: 50_000 });
    const asOwner = await db.rpc<any>("team_ai_overview", { p_actor: owner.id, p_team: team });
    const asMember = await db.rpc<any>("team_ai_overview", { p_actor: m.id, p_team: team });
    expect(asOwner.members.length).toBeGreaterThan(1);
    expect(asMember.members).toEqual([]);
    expect(asMember.transactions).toEqual([]);
    expect(asMember.you.allowance_mcr).toBe(50_000);
    await expect(db.rpc("team_ai_overview", { p_actor: g.id, p_team: team })).rejects.toThrow(/forbidden/);
    const bill = await db.rpc<any>("team_billing_overview", { p_actor: m.id, p_team: team });
    expect(bill.subscription).toBeNull();
    expect(bill.payments).toEqual([]);
    expect((await db.rpc<any>("team_billing_overview", { p_actor: owner.id, p_team: team })).subscription).toMatchObject({ status: "active" });
  });

  it("keeps every billing and pool table and function away from browsers", async () => {
    const { owner, team } = await pooled();
    for (const t of ["team_subscriptions", "team_credit_pools", "team_credit_transactions", "team_ai_reservations", "team_ai_requests", "user_ai_funding"]) {
      await expect(as(owner.id, `select * from public.${t}`)).rejects.toThrow(/permission denied/);
    }
    await expect(as(owner.id, "select public.team_create_payment($1, $2, 3, 'USD', 'abcdefghijklmnopqrstuvwxyz', 'dodo')", [owner.id, team])).rejects.toThrow(/permission denied/);
    await expect(as(owner.id, "select public.team_apply_payment(null)")).rejects.toThrow(/permission denied|does not exist/);
    await expect(as(owner.id, "update public.team_credit_pools set balance_mcr = 999999999 where team_id = $1", [team])).rejects.toThrow(/permission denied/);
  });
});

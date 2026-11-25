/* eslint-disable @typescript-eslint/no-explicit-any -- rows from the scratch database are untyped */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminDb } from "@/lib/admin/__tests__/db-harness";
import { makeHelpers, type Person } from "@/lib/collab/__tests__/helpers";
import { PLAN_METHOD_TIER } from "@/lib/datastudio/entitlements";

// supabase/migrations/20261128090000_subscription_plans_final.sql against a scratch Postgres with every migration applied:
// plan configuration, personal credit periods, Team shared credits per paid seat, monthly expiry, checkout rules and refunds.
let db: AdminDb;
const h = makeHelpers(() => db);
const K = 1000; // milli-credits per credit
let freeFeature = ""; let freeModel = "";

beforeAll(async () => {
  db = await AdminDb.create();
  await db.pool.query("update public.ai_settings set value_num = 1000000000000 where key = 'platform_daily_budget_micro_usd'");
  await db.pool.query("update public.ai_settings set value_num = 1000 where key in ('max_ops_per_minute_per_user', 'max_concurrent_ops_per_user')");
  await db.pool.query("update public.billing_settings set value_num = 1000 where key = 'max_pending_payments_per_hour'");
  freeFeature = (await db.pool.query("select f.feature_key from public.ai_features f join public.plans p on p.plan_key = 'free' and f.feature_key = any (p.ai_features) where f.enabled order by 1 limit 1")).rows[0].feature_key;
  freeModel = (await db.pool.query("select model_chain[1] m from public.ai_features where feature_key = $1", [freeFeature])).rows[0].m;
}, 180_000);
afterAll(async () => { await db.close(); });

const ref = () => `toprot-${randomUUID()}`;
const headroom = (user: string) => db.rpc<any>("ai_get_headroom", { p_user: user });
const fulfil = (txRef: string, amount: number, status = "successful", txn = `pay_${randomUUID().slice(0, 12)}`) =>
  db.rpc<any>("billing_fulfill_payment", { p_tx_ref: txRef, p_provider_txn: txn, p_provider_status: status, p_amount: amount, p_currency: "USD", p_method: "card", p_event_key: null });
const create = (user: string, kind: "subscription" | "pack", product: string) =>
  db.rpc<any>("billing_create_payment", { p_user: user, p_kind: kind, p_product: product, p_currency: "USD", p_tx_ref: ref(), p_provider: "dodo" });
async function buy(user: string, kind: "subscription" | "pack", product: string) {
  const c = await create(user, kind, product);
  expect(c.ok, JSON.stringify(c)).toBe(true);
  expect((await fulfil(c.tx_ref, c.amount)).ok).toBe(true);
  return c;
}
async function withActive<T>(plans: string[], fn: () => Promise<T>): Promise<T> {
  await db.pool.query("update public.plans set active = true where plan_key = any ($1)", [plans]);
  await db.pool.query("update public.billing_settings set value_num = 1 where key = 'teams_billing_enabled'");
  try { return await fn(); } finally {
    await db.pool.query("update public.plans set active = false where plan_key in ('advanced', 'team')");
    await db.pool.query("update public.billing_settings set value_num = 0 where key = 'teams_billing_enabled'");
  }
}
async function spend(user: string, feature = freeFeature, model = freeModel) {
  const r = await db.rpc<any>("ai_reserve", { p_user: user, p_key: ref(), p_feature: feature, p_model: model, p_reserve_micro_usd: 20000 });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const c = await db.rpc<any>("ai_commit", { p_event: r.event_id, p_input: 1000, p_output: 200 });
  expect(c.ok, JSON.stringify(c)).toBe(true);
  return r.event_id as string;
}
const pool = async (team: string) => (await db.pool.query("select balance_mcr::bigint b, reserved_mcr::bigint r, period_grant_mcr::bigint g from public.team_credit_pools where team_id = $1", [team])).rows[0] as { b: string; r: string; g: string };
const n = (x: string | number) => Number(x);

describe("plan configuration", () => {
  it("configures the four plans, their prices, credit packs and seat rules exactly", async () => {
    const plans = Object.fromEntries((await db.pool.query("select plan_key, is_paid, monthly_credits, intro_credits, max_projects, active, audience, tier_rank from public.plans")).rows.map((r) => [r.plan_key, r]));
    expect(plans.free).toMatchObject({ is_paid: false, intro_credits: 150, monthly_credits: 0, max_projects: 3, audience: "individual", tier_rank: 0 });
    expect(plans.pro).toMatchObject({ is_paid: true, monthly_credits: 2000, max_projects: 25, active: true, audience: "individual", tier_rank: 1 });
    expect(plans.advanced).toMatchObject({ is_paid: true, monthly_credits: 5000, max_projects: 50, audience: "individual", tier_rank: 2 });
    expect(plans.team).toMatchObject({ is_paid: true, monthly_credits: 7500, max_projects: null, audience: "team", tier_rank: 3 });
    // Checkout for the new paid plans stays off until the provider products are mapped and verified.
    expect(plans.advanced.active).toBe(false);
    expect(plans.team.active).toBe(false);
    expect(n((await db.pool.query("select value_num from public.billing_settings where key = 'teams_billing_enabled'")).rows[0].value_num)).toBe(0);

    const prices = Object.fromEntries((await db.pool.query("select product_key, amount::text a from public.billing_prices where currency = 'USD' and active")).rows.map((r) => [r.product_key, r.a]));
    expect(prices).toMatchObject({ pro: "7.99", advanced: "15.99", team: "25.00", team_seat: "6.00", credits_2000: "4.99", credits_5000: "9.99", credits_10000: "16.99" });
    expect((await db.pool.query("select credits, expiry_days from public.credit_packs where active order by credits")).rows).toEqual([
      { credits: 2000, expiry_days: 365 }, { credits: 5000, expiry_days: 365 }, { credits: 10000, expiry_days: 365 }]);
    const settings = Object.fromEntries((await db.pool.query("select key, value_num from public.billing_settings where key in ('team_base_paid_seats', 'team_seat_monthly_credits')")).rows.map((r) => [r.key, n(r.value_num)]));
    expect(settings).toEqual({ team_base_paid_seats: 3, team_seat_monthly_credits: 2000 });
    expect(n(await db.rpc("team_monthly_allowance_mcr", { p_seats: 3 }))).toBe(7500 * K);
    expect(n(await db.rpc("team_monthly_allowance_mcr", { p_seats: 5 }))).toBe(11500 * K);
  });

  it("sets the Data Studio quotas and gives Advanced and Team every method", async () => {
    const ds = Object.fromEntries((await db.pool.query("select * from public.ds_plan_limits")).rows.map((r) => [r.plan_key, r]));
    expect(ds.advanced).toMatchObject({ max_datasets_per_project: 50, max_rows: 250000, max_columns: 1000, max_versions_per_dataset: 500, max_analyses_per_day: 1500, method_tier: "advanced" });
    expect(n(ds.advanced.max_upload_bytes)).toBe(50 * 1048576);
    expect(n(ds.advanced.max_project_storage_bytes)).toBe(1024 * 1048576);
    expect(ds.advanced.exports).toEqual(["csv", "svg", "png", "python"]);
    expect(ds.team.max_analyses_per_day).toBeGreaterThanOrEqual(3000);
    expect(ds.team).toMatchObject({ max_datasets_per_project: 100, method_tier: "advanced" });
    expect(n(ds.team.max_project_storage_bytes)).toBe(2048 * 1048576);
    expect(ds.free).toMatchObject({ max_datasets_per_project: 3, max_rows: 5000, method_tier: "basic" });
    expect(ds.pro).toMatchObject({ max_datasets_per_project: 25, max_rows: 100000, method_tier: "standard" });
    for (const [plan, tier] of Object.entries(PLAN_METHOD_TIER)) expect(ds[plan].method_tier).toBe(tier);
    expect(n((await db.pool.query("select file_size_limit from storage.buckets where id = 'ds-uploads'")).rows[0].file_size_limit)).toBe(50 * 1048576);
  });
});

describe("personal AI credits", () => {
  it("grants Free's 150 introductory credits once, never again after a subscription ends", async () => {
    const u = await h.person("IntroOnce");
    expect(n((await headroom(u.id)).allowance_mcr)).toBe(150 * K);
    await spend(u.id);
    const usedBefore = n((await headroom(u.id)).used_mcr);
    expect(usedBefore).toBeGreaterThan(0);
    await buy(u.id, "subscription", "pro");
    expect(n((await headroom(u.id)).allowance_mcr)).toBe(2000 * K);
    // The subscription ends: back on Free, with the same (partly used) introductory allowance, not a fresh one.
    await db.pool.query("update public.ai_subscriptions set current_period_start = now() - interval '40 days', current_period_end = now() - interval '1 second' where user_id = $1", [u.id]);
    const after = await headroom(u.id);
    expect(n(after.allowance_mcr)).toBe(150 * K);
    expect(n(after.used_mcr)).toBe(usedBefore);
    expect((await db.pool.query("select count(*)::int c from public.ai_credit_periods where user_id = $1 and kind = 'intro'", [u.id])).rows[0].c).toBe(1);
  });

  it("grants Pro 2,000 credits for each paid month, and unused credits do not carry over", async () => {
    const u = await h.person("ProMonthly");
    await buy(u.id, "subscription", "pro");
    expect(n((await headroom(u.id)).allowance_mcr)).toBe(2000 * K);
    await spend(u.id);
    // Renewal: allowed in the last days of the period; the new period starts with a fresh 2,000 and the old remainder is gone.
    await db.pool.query("update public.ai_subscriptions set current_period_end = now() + interval '1 day' where user_id = $1", [u.id]);
    await buy(u.id, "subscription", "pro");
    const hr = await headroom(u.id);
    expect(n(hr.allowance_mcr)).toBe(2000 * K);
    expect(n(hr.used_mcr)).toBe(0);
    const grants = (await db.pool.query("select amount_mcr::bigint a from public.ai_credit_transactions where user_id = $1 and kind = 'subscription_grant'", [u.id])).rows;
    expect(grants.map((g) => n(g.a))).toEqual([2000 * K, 2000 * K]);
  });

  it("grants Advanced 5,000 credits per paid month", async () => {
    await withActive(["advanced"], async () => {
      const u = await h.person("AdvMonthly");
      await buy(u.id, "subscription", "advanced");
      expect(await db.rpc("billing_user_plan", { p_user: u.id })).toBe("advanced");
      expect(n((await headroom(u.id)).allowance_mcr)).toBe(5000 * K);
    });
  });

  it("creates no credits from failed, duplicate or replayed payment events", async () => {
    const u = await h.person("NoExtra");
    const failed = await create(u.id, "subscription", "pro");
    expect((await fulfil(failed.tx_ref, failed.amount, "failed")).status).toBe("failed");
    expect(await db.rpc("billing_user_plan", { p_user: u.id })).toBe("free");
    const c = await create(u.id, "subscription", "pro");
    const txn = `pay_${randomUUID().slice(0, 12)}`;
    expect((await fulfil(c.tx_ref, c.amount, "successful", txn)).duplicate).toBe(false);
    expect((await fulfil(c.tx_ref, c.amount, "successful", txn)).duplicate).toBe(true);
    // The same provider transaction cannot pay for a second order.
    await db.pool.query("update public.ai_subscriptions set current_period_end = now() + interval '1 day' where user_id = $1", [u.id]);
    const again = await create(u.id, "subscription", "pro");
    expect((await fulfil(again.tx_ref, again.amount, "successful", txn)).code).toBe("transaction_already_used");
    // An underpayment is refused.
    expect((await fulfil(again.tx_ref, again.amount - 1)).code).toBe("mismatch");
    expect((await db.pool.query("select count(*)::int c from public.ai_credit_transactions where user_id = $1 and kind = 'subscription_grant'", [u.id])).rows[0].c).toBe(1);
  });

  it("upgrades without losing the paid period, and makes a downgrade wait for the period to end", async () => {
    await withActive(["advanced"], async () => {
      const u = await h.person("UpDown");
      await buy(u.id, "subscription", "pro");
      const proEnd = (await db.pool.query("select current_period_end e from public.ai_subscriptions where user_id = $1", [u.id])).rows[0].e as Date;
      await buy(u.id, "subscription", "advanced");
      const s = (await db.pool.query("select plan, current_period_end e from public.ai_subscriptions where user_id = $1", [u.id])).rows[0];
      expect(s.plan).toBe("advanced");
      expect(new Date(s.e).getTime()).toBeGreaterThan(proEnd.getTime()); // the new month starts after the Pro time already paid for
      expect(n((await headroom(u.id)).allowance_mcr)).toBe(5000 * K);
      const down = await create(u.id, "subscription", "pro");
      expect(down).toMatchObject({ ok: false, code: "downgrade_at_period_end" });
      // Once the Advanced period is over, Pro can be bought.
      await db.pool.query("update public.ai_subscriptions set current_period_start = now() - interval '40 days', current_period_end = now() - interval '1 second' where user_id = $1", [u.id]);
      expect((await create(u.id, "subscription", "pro")).ok).toBe(true);
    });
  });

  it("keeps purchased credits separate from plan credits, with their own 365-day expiry", async () => {
    const u = await h.person("Packs");
    expect((await create(u.id, "pack", "credits_2000")).code).toBe("subscription_required");
    await buy(u.id, "subscription", "pro");
    await buy(u.id, "pack", "credits_5000");
    const lot = (await db.pool.query("select credits_mcr::bigint c, round(extract(epoch from expires_at - now()) / 86400) d from public.ai_credit_lots where user_id = $1", [u.id])).rows[0];
    expect(n(lot.c)).toBe(5000 * K);
    expect(n(lot.d)).toBe(365);
    await db.pool.query("update public.ai_subscriptions set current_period_end = now() + interval '1 day' where user_id = $1", [u.id]);
    await buy(u.id, "subscription", "pro"); // a renewal leaves purchased credits untouched
    const hr = await headroom(u.id);
    expect(n(hr.purchased_available_mcr)).toBe(5000 * K);
    expect(n(hr.subscription_available_mcr)).toBe(2000 * K);
  });

  it("lets an Advanced owner invite the same collaborators as Pro", async () => {
    const roles = (plan: string) => db.pool.query("select role, max_per_project from public.collab_role_limits where plan_key = $1 order by role", [plan]).then((r) => r.rows);
    expect(await roles("advanced")).toEqual(await roles("pro"));
    await withActive(["advanced"], async () => {
      const o = await h.person("AdvCollab");
      await buy(o.id, "subscription", "advanced");
      const s = await h.project(o.id);
      const ed = await h.person("AdvEditor");
      await h.join(o.id, s, ed, "editor");
      expect(await h.as(ed.id, "select public.study_role($1) r", [s])).toEqual([{ r: "editor" }]);
    });
  });

  it("never sells the Team plan as a personal subscription", async () => {
    await withActive(["team"], async () => {
      const u = await h.person("NotPersonal");
      expect(await create(u.id, "subscription", "team")).toMatchObject({ ok: false, code: "unknown_product" });
    });
  });

  it("charges AI interpretation of Data Studio results to the subscriber's credits, and only on plans that include it", async () => {
    const model = (await db.pool.query("select model_chain[1] m from public.ai_features where feature_key = 'data_analyst'")).rows[0].m;
    const free = await h.person("AnalystFree");
    expect((await db.rpc<any>("ai_reserve", { p_user: free.id, p_key: ref(), p_feature: "data_analyst", p_model: model, p_reserve_micro_usd: 20000 })).code).toBe("plan_required");
    await withActive(["advanced"], async () => {
      const u = await h.person("AnalystAdv");
      await buy(u.id, "subscription", "advanced");
      await spend(u.id, "data_analyst", model);
      const hr = await headroom(u.id);
      expect(n(hr.used_mcr)).toBeGreaterThan(0);
      expect(n(hr.subscription_available_mcr)).toBe(5000 * K - n(hr.used_mcr));
    });
  });
});

describe("Team shared credits", () => {
  const newTeam = (o: Person, name = "Lab") => db.rpc<string>("team_create", { p_actor: o.id, p_name: name });
  async function teamPay(o: Person, team: string, seats: number) {
    const p = await db.rpc<any>("team_create_payment", { p_actor: o.id, p_team: team, p_seats: seats, p_currency: "USD", p_tx_ref: ref(), p_provider: "dodo" });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    return p;
  }
  async function teamBuy(o: Person, team: string, seats: number) { const p = await teamPay(o, team, seats); expect((await fulfil(p.tx_ref, p.amount)).ok).toBe(true); return p; }
  async function addSeats(o: Person, team: string, add: number) {
    const p = await db.rpc<any>("team_create_seats_payment", { p_actor: o.id, p_team: team, p_add: add, p_currency: "USD", p_tx_ref: ref(), p_provider: "dodo" });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    return p;
  }

  it("gives the base plan 7,500 shared credits and each extra paid seat 2,000 more, to the pool and never to members", async () => {
    await withActive(["team"], async () => {
      const o = await h.person("TeamBase");
      const t = await newTeam(o);
      const p = await teamBuy(o, t, 3);
      expect(n(p.amount)).toBe(25);
      expect(n((await pool(t)).b)).toBe(7500 * K);
      expect(n((await pool(t)).g)).toBe(7500 * K);
      // Personal credits are untouched: the owner is still on Free with 150 introductory credits.
      expect(await db.rpc("billing_user_plan", { p_user: o.id })).toBe("free");
      expect(n((await headroom(o.id)).allowance_mcr)).toBe(150 * K);

      const o2 = await h.person("TeamFive");
      const t2 = await newTeam(o2, "Bigger lab");
      const p2 = await teamBuy(o2, t2, 5);
      expect(n(p2.amount)).toBe(37);
      expect(n((await pool(t2)).b)).toBe(11500 * K);
      const ov = await db.rpc<any>("team_billing_overview", { p_actor: o2.id, p_team: t2 });
      expect(ov.allowance).toMatchObject({ paid_seats: 5, extra_seats: 2, monthly_allowance_mcr: 11500 * K, extra_seat_credits_mcr: 4000 * K });
    });
  });

  it("adds seat credits only once the seats are paid", async () => {
    await withActive(["team"], async () => {
      const o = await h.person("SeatsPaid");
      const t = await newTeam(o);
      await teamBuy(o, t, 3);
      const unpaid = await addSeats(o, t, 2);
      expect(n((await pool(t)).b)).toBe(7500 * K);
      expect((await fulfil(unpaid.tx_ref, unpaid.amount, "failed")).status).toBe("failed");
      expect(n((await pool(t)).b)).toBe(7500 * K);
      const paid = await addSeats(o, t, 2);
      expect(n(paid.amount)).toBe(12);
      expect((await fulfil(paid.tx_ref, paid.amount)).ok).toBe(true);
      expect((await fulfil(paid.tx_ref, paid.amount)).duplicate).toBe(true);
      expect(n((await pool(t)).b)).toBe(11500 * K);
      expect((await db.pool.query("select paid_seats from public.team_subscriptions where team_id = $1", [t])).rows[0].paid_seats).toBe(5);
      // A refund of the seats takes their credits back out of the pool.
      const payId = (await db.pool.query("select id from public.payments where tx_ref = $1", [paid.tx_ref])).rows[0].id;
      expect((await db.rpc<any>("billing_refund_payment", { p_payment: payId, p_reason: "test" })).ok).toBe(true);
      expect(n((await pool(t)).b)).toBe(7500 * K);
      expect((await db.pool.query("select paid_seats from public.team_subscriptions where team_id = $1", [t])).rows[0].paid_seats).toBe(3);
    });
  });

  it("expires unused shared credits at the end of the period but keeps purchased team credits", async () => {
    await withActive(["team"], async () => {
      const o = await h.person("TeamExpiry");
      const t = await newTeam(o);
      await teamBuy(o, t, 3);
      const pack = await db.rpc<any>("team_create_pack_payment", { p_actor: o.id, p_team: t, p_pack: "credits_2000", p_currency: "USD", p_tx_ref: ref(), p_provider: "dodo" });
      expect((await fulfil(pack.tx_ref, pack.amount)).ok).toBe(true);
      expect(n((await pool(t)).b)).toBe(9500 * K);
      // Usage spends the period's shared grant first.
      await db.pool.query("update public.team_credit_pools set balance_mcr = balance_mcr - 1000000 where team_id = $1", [t]);
      await db.pool.query("insert into public.team_credit_transactions (team_id, kind, amount_mcr, note) values ($1, 'usage', -1000000, 'test')", [t]);
      expect(n((await pool(t)).g)).toBe(6500 * K);
      // A renewal: the unused 6,500 expires and a fresh 7,500 arrives; the 2,000 purchased credits stay.
      await teamBuy(o, t, 3);
      expect(n((await pool(t)).b)).toBe(9500 * K);
      expect(n((await pool(t)).g)).toBe(7500 * K);
      expect((await db.pool.query("select amount_mcr::bigint a from public.team_credit_transactions where team_id = $1 and kind = 'expiry'", [t])).rows.map((r) => n(r.a))).toEqual([-6500 * K]);
      // No renewal: the daily sweep expires the grant once the period is over.
      await db.pool.query("update public.team_credit_pools set period_end = now() - interval '1 second' where team_id = $1", [t]);
      await db.rpc("team_billing_sweep");
      expect(n((await pool(t)).b)).toBe(2000 * K);
      expect(n((await pool(t)).g)).toBe(0);
    });
  });

  it("does not let non-members, guests or other teams claim the shared credits", async () => {
    await withActive(["team"], async () => {
      const o = await h.person("PoolOwner");
      const t = await newTeam(o);
      await teamBuy(o, t, 3);
      await db.rpc("team_ai_pool_set", { p_actor: o.id, p_team: t, p_enabled: true, p_team_limit: null, p_member_limit: null });
      const stranger = await h.person("PoolStranger");
      await db.rpcFails("team_ai_set_funding", { p_actor: stranger.id, p_team: t }, "not_team_member");
      const r = await db.rpc<any>("team_ai_reserve", { p_actor: stranger.id, p_team: t, p_study: null, p_key: ref(), p_feature: freeFeature, p_model: freeModel, p_reserve_micro_usd: 20000 });
      expect(r).toMatchObject({ ok: false, code: "team_not_member" });
      await db.rpcFails("team_ai_pool_set", { p_actor: stranger.id, p_team: t, p_enabled: false, p_team_limit: null, p_member_limit: null }, "not_team_admin");
      await db.rpcFails("team_billing_overview", { p_actor: stranger.id, p_team: t }, "forbidden");
      // Browser roles cannot call the pool functions at all.
      await expect(h.asWrite(o.id, "select public.team_pool_expire_period($1)", [t])).rejects.toThrow(/permission denied/);
      await expect(h.asWrite(o.id, "select public.team_monthly_allowance_mcr(3)")).rejects.toThrow(/permission denied/);
      expect(n((await pool(t)).b)).toBe(7500 * K);
    });
  });
});

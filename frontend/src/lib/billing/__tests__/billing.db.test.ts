import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { TestDb } from "@/lib/ai/__tests__/helpers";

// The new money paths on a scratch Postgres: purchased credits next to subscription credits, payment fulfilment,
// plan gating, expiry, concurrency and who may call what. Never touches Supabase or production.

let db: TestDb;
const MIG = path.resolve(__dirname, "../../../../../supabase/migrations/20261115090000_billing_plans_payments.sql");
const KEY = () => `k-${randomUUID()}`;
const ref = () => `tx-${randomUUID()}`;

beforeAll(async () => {
  db = await TestDb.create();
  await db.pool.query("create table public.studies (id uuid primary key default gen_random_uuid(), owner_id uuid not null, title text)");
  await db.pool.query("alter table auth.users add column if not exists created_at timestamptz not null default now()");
  await db.pool.query(readFileSync(MIG, "utf8"));
  await db.pool.query(`insert into public.ai_features (feature_key, description, model_chain, max_output_tokens, max_input_chars, max_iterations, max_tool_calls, max_op_cost_micro_usd) values
    ('pdf_qa', 'x', array['claude-sonnet-5-5'], 3000, 60000, 1, 0, 1000000),
    ('assistant_deep', 'x', array['claude-sonnet-5-5'], 3000, 60000, 1, 0, 1000000),
    ('assistant_standard', 'x', array['claude-sonnet-5-5'], 3000, 60000, 1, 0, 1000000000)`);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.resetState();
  await db.pool.query("truncate public.payments, public.payment_events, public.ai_credit_lots, public.ai_credit_transactions, public.ai_subscriptions, public.studies cascade");
  await db.setSetting("platform_daily_budget_micro_usd", 1_000_000_000_000);
  await db.setSetting("max_ops_per_minute_per_user", 1000);
  await db.setSetting("max_concurrent_ops_per_user", 50);
});

const reserve = (user: string, micro: number, feature = "assistant_standard") => db.rpc("ai_reserve", { p_user: user, p_key: KEY(), p_feature: feature, p_model: "claude-sonnet-5-5", p_reserve_micro_usd: micro });
// 2 micro-USD per input token and 10 per output token on this model: tokens needed for N credits (1 credit = 1000 micro).
const commit = (event: string, credits: number) => db.rpc("ai_commit", { p_event: event, p_input: 0, p_output: (credits * 1000) / 10 });

async function pay(user: string, kind: "subscription" | "pack", product: string, currency = "USD") {
  const tx = ref();
  const r = (await db.rpc("billing_create_payment", { p_user: user, p_kind: kind, p_product: product, p_currency: currency, p_tx_ref: tx })).data as Record<string, unknown>;
  return { tx, r };
}
async function paid(user: string, kind: "subscription" | "pack", product: string) {
  const { tx, r } = await pay(user, kind, product);
  const f = (await db.rpc("billing_fulfill_payment", { p_tx_ref: tx, p_provider_txn: `txn-${randomUUID()}`, p_provider_status: "successful", p_amount: r.amount, p_currency: "USD", p_method: "card" })).data as Record<string, unknown>;
  return { tx, r, f };
}

/** Invariants that must hold after any sequence of operations across both credit pools. */
async function assertConsistent() {
  const periods = await db.pool.query(`
    select p.id, p.used_mcr, p.reserved_mcr,
      coalesce((select sum(charged_mcr - charged_lot_mcr) from ai_usage_events e where e.period_id = p.id and e.status = 'committed'), 0) as ev_used,
      coalesce((select sum(reserved_mcr - reserved_lot_mcr) from ai_usage_events e where e.period_id = p.id and e.status = 'reserved'), 0) as ev_res
    from ai_credit_periods p`);
  for (const p of periods.rows) {
    expect(Number(p.used_mcr), `period ${p.id} used`).toBeGreaterThanOrEqual(Number(p.ev_used));
    expect(Number(p.reserved_mcr), `period ${p.id} reserved`).toBe(Number(p.ev_res));
  }
  const lots = await db.pool.query(`
    select l.id, l.credits_mcr, l.used_mcr, l.reserved_mcr,
      coalesce((select -sum(amount_mcr) from ai_credit_transactions t where t.lot_id = l.id and t.kind = 'usage'), 0) as tx_used,
      coalesce((select sum(reserved_mcr) from ai_credit_allocations a where a.lot_id = l.id), 0) as alloc
    from ai_credit_lots l`);
  for (const l of lots.rows) {
    expect(Number(l.used_mcr), `lot ${l.id} used`).toBe(Number(l.tx_used));
    expect(Number(l.reserved_mcr), `lot ${l.id} reserved`).toBe(Number(l.alloc));
    expect(Number(l.used_mcr)).toBeLessThanOrEqual(Number(l.credits_mcr));
  }
  const days = await db.pool.query(`select d.day, d.reserved_micro_usd, coalesce((select sum(reserved_micro_usd) from ai_usage_events e where e.platform_day = d.day and e.status = 'reserved'), 0) as ev from ai_platform_days d`);
  for (const d of days.rows) expect(Number(d.reserved_micro_usd), `day ${d.day} reserved`).toBe(Number(d.ev));
}

describe("plans, prices and packs are data", () => {
  it("seeds a free and a paid plan, three packs and proposed USD prices", async () => {
    const plans = (await db.pool.query("select plan_key, is_paid, monthly_credits, intro_credits, max_projects, ai_features from plans order by tier_rank")).rows;
    expect(plans.map((p) => p.plan_key)).toEqual(["free", "pro"]);
    expect(plans[0]).toMatchObject({ is_paid: false, intro_credits: 150, max_projects: 3 });
    expect(plans[1]).toMatchObject({ is_paid: true, monthly_credits: 2000, max_projects: 25 });
    expect(plans[1].ai_features).toEqual(expect.arrayContaining(["pdf_qa", "pdf_compare", "assistant_deep"]));
    expect(plans[0].ai_features).not.toContain("pdf_qa");
    const prices = (await db.pool.query("select kind, product_key, currency, amount::text as amount_text from billing_prices order by amount")).rows;
    expect(prices.map((p) => `${p.product_key}:${p.currency}:${p.amount_text}`)).toEqual(["credits_2000:USD:4.99", "pro:USD:7.99", "credits_5000:USD:9.99", "credits_10000:USD:16.99"]);
    expect((await db.pool.query("select credits, expiry_days from credit_packs order by credits")).rows).toEqual([{ credits: 2000, expiry_days: 365 }, { credits: 5000, expiry_days: 365 }, { credits: 10000, expiry_days: 365 }]);
  });
  it("allowances follow the plans table, so changing a quota needs no code change", async () => {
    const u = await db.newUser();
    expect(((await db.rpc("ai_get_headroom", { p_user: u })).data as { allowance_mcr: number }).allowance_mcr).toBe(150_000);
    await db.pool.query("update plans set intro_credits = 400 where plan_key = 'free'");
    expect(((await db.rpc("ai_get_headroom", { p_user: u })).data as { allowance_mcr: number }).allowance_mcr).toBe(400_000);
    await db.pool.query("update plans set intro_credits = 150 where plan_key = 'free'");
  });
});

describe("payments are only fulfilled after verification and exactly once", () => {
  it("creates a pending payment at the configured price and does nothing else", async () => {
    const u = await db.newUser();
    const { r } = await pay(u, "pack", "credits_5000");
    expect(r).toMatchObject({ ok: true, amount: 9.99, currency: "USD" });
    expect((await db.pool.query("select count(*)::int n from ai_credit_lots")).rows[0].n).toBe(0);
    expect((await db.pool.query("select status from payments")).rows[0].status).toBe("pending");
  });
  it("issues a purchased lot with its disclosed expiry, once, however often the confirmation arrives", async () => {
    const u = await db.newUser();
    const { tx, r } = await pay(u, "pack", "credits_2000");
    const args = { p_tx_ref: tx, p_provider_txn: "flw-1", p_provider_status: "successful", p_amount: r.amount, p_currency: "USD", p_method: "card", p_event_key: "evt-1" };
    const first = (await db.rpc("billing_fulfill_payment", args)).data as Record<string, unknown>;
    expect(first).toMatchObject({ ok: true, duplicate: false, status: "succeeded" });
    const again = (await db.rpc("billing_fulfill_payment", args)).data as Record<string, unknown>;
    expect(again).toMatchObject({ ok: true, duplicate: true });
    const lots = (await db.pool.query("select credits_mcr, (expires_at - granted_at) as span from ai_credit_lots")).rows;
    expect(lots).toHaveLength(1);
    expect(Number(lots[0].credits_mcr)).toBe(2_000_000);
    expect(lots[0].span.days).toBeGreaterThanOrEqual(364);
    expect((await db.pool.query("select count(*)::int n from ai_credit_transactions where kind = 'purchase'")).rows[0].n).toBe(1);
    expect((await db.pool.query("select count(*)::int n from payment_events")).rows[0].n).toBe(1);
  });
  it("hammered with the same confirmation in parallel still issues one lot", async () => {
    const u = await db.newUser();
    const { tx, r } = await pay(u, "pack", "credits_2000");
    await Promise.all(Array.from({ length: 8 }, () => db.rpc("billing_fulfill_payment", { p_tx_ref: tx, p_provider_txn: "flw-p", p_provider_status: "successful", p_amount: r.amount, p_currency: "USD" })));
    expect((await db.pool.query("select count(*)::int n from ai_credit_lots")).rows[0].n).toBe(1);
  });
  it("rejects an amount below the price, a different currency, and a failed provider status, issuing nothing", async () => {
    const u = await db.newUser();
    const bad = async (over: Record<string, unknown>) => {
      const { tx, r } = await pay(u, "pack", "credits_2000");
      return (await db.rpc("billing_fulfill_payment", { p_tx_ref: tx, p_provider_txn: `t-${randomUUID()}`, p_provider_status: "successful", p_amount: r.amount, p_currency: "USD", ...over })).data as Record<string, unknown>;
    };
    expect(await bad({ p_amount: 1 })).toMatchObject({ ok: false, code: "mismatch" });
    expect(await bad({ p_currency: "NGN" })).toMatchObject({ ok: false, code: "mismatch" });
    expect(await bad({ p_provider_status: "failed" })).toMatchObject({ ok: true, status: "failed" });
    expect(await bad({ p_provider_status: "pending" })).toMatchObject({ status: "failed" });
    expect((await db.pool.query("select count(*)::int n from ai_credit_lots")).rows[0].n).toBe(0);
    expect((await db.pool.query("select count(*)::int n from payments where status = 'failed'")).rows[0].n).toBe(4);
  });
  it("accepts an overpayment, since the buyer is not short-changed", async () => {
    const u = await db.newUser();
    const { tx, r } = await pay(u, "pack", "credits_2000");
    const f = (await db.rpc("billing_fulfill_payment", { p_tx_ref: tx, p_provider_txn: "flw-over", p_provider_status: "successful", p_amount: Number(r.amount) + 1, p_currency: "USD" })).data;
    expect(f).toMatchObject({ ok: true, status: "succeeded" });
  });
  it("never lets one provider transaction pay for two orders", async () => {
    const u = await db.newUser();
    const a = await pay(u, "pack", "credits_2000"), b = await pay(u, "pack", "credits_2000");
    const args = (t: string, amt: unknown) => ({ p_tx_ref: t, p_provider_txn: "flw-shared", p_provider_status: "successful", p_amount: amt, p_currency: "USD" });
    expect((await db.rpc("billing_fulfill_payment", args(a.tx, a.r.amount))).data).toMatchObject({ ok: true });
    expect((await db.rpc("billing_fulfill_payment", args(b.tx, b.r.amount))).data).toMatchObject({ ok: false, code: "transaction_already_used" });
    expect((await db.pool.query("select count(*)::int n from ai_credit_lots")).rows[0].n).toBe(1);
  });
  it("rejects unknown references and unknown products and unavailable currencies", async () => {
    const u = await db.newUser();
    expect((await db.rpc("billing_fulfill_payment", { p_tx_ref: ref(), p_provider_txn: "x", p_provider_status: "successful", p_amount: 5, p_currency: "USD" })).data).toMatchObject({ code: "unknown_reference" });
    expect((await pay(u, "pack", "credits_999")).r).toMatchObject({ ok: false, code: "unknown_product" });
    expect((await pay(u, "subscription", "free")).r).toMatchObject({ ok: false, code: "unknown_product" });
    expect((await pay(u, "pack", "credits_2000", "UGX")).r).toMatchObject({ ok: false, code: "currency_unavailable" });
    await db.pool.query("insert into billing_prices (kind, product_key, currency, amount) values ('pack', 'credits_2000', 'UGX', 18000)");
    expect((await pay(u, "pack", "credits_2000", "UGX")).r).toMatchObject({ ok: true, amount: 18000, currency: "UGX" });
  });
  it("limits how many checkouts a user can open per hour", async () => {
    const u = await db.newUser();
    const results = [];
    for (let i = 0; i < 12; i++) results.push((await pay(u, "pack", "credits_2000")).r.ok);
    expect(results.filter(Boolean)).toHaveLength(10);
  });
  it("closes checkouts that were never completed", async () => {
    const u = await db.newUser();
    await pay(u, "pack", "credits_2000");
    await db.pool.query("update payments set created_at = now() - interval '3 hours'");
    expect(((await db.rpc("billing_pending_to_check", { p_older_than_minutes: 10, p_limit: 10 })).data ?? null) === undefined).toBe(false);
    expect((await db.rpc("billing_close_stale_payments")).data).toBe(1);
    expect((await db.pool.query("select status, failure_reason from payments")).rows[0]).toEqual({ status: "failed", failure_reason: "checkout_not_completed" });
  });
});

describe("subscriptions", () => {
  it("activates Pro only on a verified payment, with a one month period and its credit grant", async () => {
    const u = await db.newUser();
    await pay(u, "subscription", "pro");
    expect((await db.pool.query("select 1 from ai_subscriptions")).rowCount).toBe(0);
    expect(await db.rpc("billing_user_plan", { p_user: u }).then((r) => r.data)).toBe("free");
    const { f } = await paid(u, "subscription", "pro");
    expect(f).toMatchObject({ ok: true, kind: "subscription" });
    expect(await db.rpc("billing_user_plan", { p_user: u }).then((r) => r.data)).toBe("pro");
    const s = (await db.pool.query("select status, current_period_end - current_period_start as span from ai_subscriptions")).rows[0];
    expect(s.status).toBe("active");
    expect(s.span.days).toBeGreaterThanOrEqual(28);
    expect(s.span.days).toBeLessThanOrEqual(31);
    const h = (await db.rpc("ai_get_headroom", { p_user: u })).data as { allowance_mcr: number; plan: string };
    expect(h).toMatchObject({ plan: "pro", allowance_mcr: 2_000_000 });
    expect(Number((await db.pool.query("select amount_mcr from ai_credit_transactions where kind = 'subscription_grant'")).rows[0].amount_mcr)).toBe(2_000_000);
  });
  it("will not take a second payment early, but allows renewal in the renewal window and extends the period", async () => {
    const u = await db.newUser();
    await paid(u, "subscription", "pro");
    expect((await pay(u, "subscription", "pro")).r).toMatchObject({ ok: false, code: "too_early" });
    await db.pool.query("update ai_subscriptions set current_period_end = now() + interval '2 days'");
    const before = (await db.pool.query("select current_period_end from ai_subscriptions")).rows[0].current_period_end as Date;
    const { f } = await paid(u, "subscription", "pro");
    expect(f).toMatchObject({ ok: true });
    const after = (await db.pool.query("select current_period_end from ai_subscriptions")).rows[0].current_period_end as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime() + 27 * 86400_000);
  });
  it("restarts a lapsed subscription from now", async () => {
    const u = await db.newUser();
    await paid(u, "subscription", "pro");
    await db.pool.query("update ai_subscriptions set current_period_start = now() - interval '40 days', current_period_end = now() - interval '9 days'");
    expect(await db.rpc("billing_user_plan", { p_user: u }).then((r) => r.data)).toBe("free");
    await paid(u, "subscription", "pro");
    expect(await db.rpc("billing_user_plan", { p_user: u }).then((r) => r.data)).toBe("pro");
  });
  it("gives each billing period a fresh allowance, and the old period's usage does not carry over", async () => {
    const u = await db.newUser();
    await paid(u, "subscription", "pro");
    const r1 = (await reserve(u, 100_000, "protocol_review")).data as { ok: boolean; event_id: string };
    await commit(r1.event_id, 100);
    await db.pool.query("update ai_subscriptions set current_period_start = now() - interval '40 days', current_period_end = now() - interval '9 days'");
    await paid(u, "subscription", "pro");
    const h = (await db.rpc("ai_get_headroom", { p_user: u })).data as { used_mcr: number; allowance_mcr: number };
    expect(h.used_mcr).toBe(0);
    expect(h.allowance_mcr).toBe(2_000_000);
  });
  it("a refund cancels the subscription and a canceled plan falls back to free", async () => {
    const u = await db.newUser();
    await paid(u, "subscription", "pro");
    const id = (await db.pool.query("select id from payments")).rows[0].id;
    expect((await db.rpc("billing_refund_payment", { p_payment: id, p_reason: "customer request" })).data).toMatchObject({ ok: true });
    expect(await db.rpc("billing_user_plan", { p_user: u }).then((r) => r.data)).toBe("free");
    expect((await db.rpc("billing_fulfill_payment", { p_tx_ref: (await db.pool.query("select tx_ref from payments")).rows[0].tx_ref, p_provider_txn: "z", p_provider_status: "successful", p_amount: 7.99, p_currency: "USD" })).data).toMatchObject({ code: "refunded" });
  });
});

describe("plan gating of AI features", () => {
  it("lets the free plan use basic features and blocks Pro features", async () => {
    const u = await db.newUser();
    expect((await reserve(u, 10_000, "protocol_review")).data).toMatchObject({ ok: true });
    expect((await reserve(u, 10_000, "pdf_qa")).data).toMatchObject({ ok: false, code: "plan_required" });
    expect((await reserve(u, 10_000, "assistant_deep")).data).toMatchObject({ ok: false, code: "plan_required" });
  });
  it("opens Pro features after a verified subscription, and closes them when it ends", async () => {
    const u = await db.newUser();
    await paid(u, "subscription", "pro");
    expect((await reserve(u, 10_000, "pdf_qa")).data).toMatchObject({ ok: true });
    await db.pool.query("update ai_subscriptions set current_period_end = now() - interval '1 second', current_period_start = now() - interval '31 days'");
    expect((await reserve(u, 10_000, "pdf_qa")).data).toMatchObject({ code: "plan_required" });
  });
  it("buying credits does not unlock Pro features", async () => {
    const u = await db.newUser();
    await paid(u, "pack", "credits_10000");
    expect((await reserve(u, 10_000, "pdf_qa")).data).toMatchObject({ code: "plan_required" });
    expect((await reserve(u, 10_000, "protocol_review")).data).toMatchObject({ ok: true });
  });
  it("changing a plan's feature list takes effect immediately", async () => {
    const u = await db.newUser();
    await db.pool.query("update plans set ai_features = array_append(ai_features, 'pdf_qa') where plan_key = 'free'");
    expect((await reserve(u, 10_000, "pdf_qa")).data).toMatchObject({ ok: true });
    await db.pool.query("update plans set ai_features = array_remove(ai_features, 'pdf_qa') where plan_key = 'free'");
  });
});

describe("two credit pools", () => {
  it("uses subscription credits first and only then purchased credits, across reservation and charge", async () => {
    const u = await db.newUser();
    await paid(u, "pack", "credits_2000");
    // 150 intro credits: spend 100, leaving 50 in the period.
    const a = (await reserve(u, 100_000)).data as { event_id: string };
    expect(await commit(a.event_id, 100).then((r) => (r.data as { charged_mcr: number }).charged_mcr)).toBe(100_000);
    // Reserve 80: 50 from the period, 30 held on the lot.
    const b = (await reserve(u, 80_000)).data as { ok: boolean; event_id: string };
    expect(b.ok).toBe(true);
    const ev = (await db.pool.query("select reserved_mcr, reserved_lot_mcr from ai_usage_events where id = $1", [b.event_id])).rows[0];
    expect([Number(ev.reserved_mcr), Number(ev.reserved_lot_mcr)]).toEqual([80_000, 30_000]);
    expect(Number((await db.pool.query("select reserved_mcr from ai_credit_lots")).rows[0].reserved_mcr)).toBe(30_000);
    await assertConsistent();
    expect((await commit(b.event_id, 80)).data).toMatchObject({ ok: true, charged_mcr: 80_000 });
    const lot = (await db.pool.query("select used_mcr, reserved_mcr from ai_credit_lots")).rows[0];
    expect([Number(lot.used_mcr), Number(lot.reserved_mcr)]).toEqual([30_000, 0]);
    const p = (await db.pool.query("select used_mcr, reserved_mcr from ai_credit_periods")).rows[0];
    expect([Number(p.used_mcr), Number(p.reserved_mcr)]).toEqual([150_000, 0]);
    const tx = (await db.pool.query("select pool, amount_mcr from ai_credit_transactions where kind = 'usage' order by id")).rows.map((r) => `${r.pool}:${r.amount_mcr}`);
    expect([...tx].sort()).toEqual(["purchased:-30000", "subscription:-100000", "subscription:-50000"]);
    expect((await db.pool.query("select charged_lot_mcr from ai_usage_events where id = $1", [b.event_id])).rows[0].charged_lot_mcr).toBe("30000");
    await assertConsistent();
  });
  it("reports the two balances separately and their sum as available", async () => {
    const u = await db.newUser();
    await paid(u, "pack", "credits_5000");
    const h = (await db.rpc("ai_get_headroom", { p_user: u })).data as Record<string, number | string>;
    expect(h).toMatchObject({ subscription_available_mcr: 150_000, purchased_available_mcr: 5_000_000, available_mcr: 5_150_000 });
    expect(h.purchased_next_expiry).toBeTruthy();
  });
  it("refuses when both pools together cannot cover the request, reporting the true total", async () => {
    const u = await db.newUser();
    const r = (await reserve(u, 200_000)).data as Record<string, unknown>;
    expect(r).toMatchObject({ ok: false, code: "insufficient_credits", available_mcr: 150_000 });
    await paid(u, "pack", "credits_2000");
    expect((await reserve(u, 200_000)).data).toMatchObject({ ok: true });
  });
  it("draws from the lot that expires first", async () => {
    const u = await db.newUser();
    await paid(u, "pack", "credits_2000");
    await paid(u, "pack", "credits_5000");
    const ids = (await db.pool.query("select l.id, c.credits from ai_credit_lots l join payments p on p.id = l.payment_id join credit_packs c on c.pack_key = p.product_key order by c.credits")).rows;
    await db.pool.query("update ai_credit_lots set expires_at = now() + interval '10 days' where id = $1", [ids[1].id]); // the 5000 pack expires sooner
    const a = (await reserve(u, 150_000)).data as { event_id: string };
    await commit(a.event_id, 150);
    const b = (await reserve(u, 100_000)).data as { event_id: string };
    await commit(b.event_id, 100);
    const used = (await db.pool.query("select credits_mcr, used_mcr from ai_credit_lots order by credits_mcr")).rows.map((r) => [Number(r.credits_mcr), Number(r.used_mcr)]);
    expect(used).toEqual([[2_000_000, 0], [5_000_000, 100_000]]);
    await assertConsistent();
  });
  it("records an overrun on the subscription period rather than losing usage when nothing can cover it", async () => {
    const u = await db.newUser();
    const a = (await reserve(u, 100_000)).data as { event_id: string };
    const c = (await commit(a.event_id, 400)).data as { charged_mcr: number; overrun_mcr: number };
    expect(c.charged_mcr).toBe(400_000);
    const p = (await db.pool.query("select used_mcr from ai_credit_periods")).rows[0];
    expect(Number(p.used_mcr)).toBe(400_000);
    expect(((await db.rpc("ai_get_headroom", { p_user: u })).data as { available_mcr: number }).available_mcr).toBe(0);
  });
  it("releases held lot credits when an operation fails or its lease expires", async () => {
    const u = await db.newUser();
    await paid(u, "pack", "credits_2000");
    const a = (await reserve(u, 100_000)).data as { event_id: string };
    await commit(a.event_id, 100);
    const b = (await reserve(u, 100_000)).data as { event_id: string };
    expect(Number((await db.pool.query("select reserved_mcr from ai_credit_lots")).rows[0].reserved_mcr)).toBe(50_000);
    await db.rpc("ai_release", { p_event: b.event_id, p_error_code: "provider_error" });
    expect(Number((await db.pool.query("select reserved_mcr from ai_credit_lots")).rows[0].reserved_mcr)).toBe(0);
    const c = (await reserve(u, 100_000)).data as { event_id: string };
    await db.pool.query("update ai_usage_events set expires_at = now() - interval '1 minute' where id = $1", [c.event_id]);
    await reserve(u, 10_000); // triggers the sweep
    expect(Number((await db.pool.query("select reserved_mcr from ai_credit_lots")).rows[0].reserved_mcr)).toBe(0);
    await assertConsistent();
  });
  it("ignores expired purchased credits, records their expiry, and never charges them", async () => {
    const u = await db.newUser();
    await paid(u, "pack", "credits_2000");
    await db.pool.query("update ai_credit_lots set expires_at = now() - interval '1 day'");
    expect(((await db.rpc("ai_get_headroom", { p_user: u })).data as { purchased_available_mcr: number }).purchased_available_mcr).toBe(0);
    expect((await reserve(u, 200_000)).data).toMatchObject({ code: "insufficient_credits" });
    const tx = (await db.pool.query("select kind, amount_mcr from ai_credit_transactions where kind = 'expiry'")).rows;
    expect(tx).toEqual([{ kind: "expiry", amount_mcr: "-2000000" }]);
    expect((await db.rpc("billing_sweep_expired_lots")).data).toBe(0);
  });
  it("the scheduled sweep expires lots of users who never come back", async () => {
    const u = await db.newUser();
    await paid(u, "pack", "credits_2000");
    await db.pool.query("update ai_credit_lots set expires_at = now() - interval '1 day'");
    expect((await db.rpc("billing_sweep_expired_lots")).data).toBe(1);
    expect((await db.pool.query("select count(*)::int n from ai_credit_transactions where kind = 'expiry'")).rows[0].n).toBe(1);
  });
  it("a refund removes the unused purchased credits", async () => {
    const u = await db.newUser();
    await paid(u, "pack", "credits_2000");
    const a = (await reserve(u, 150_000)).data as { event_id: string };
    await commit(a.event_id, 150);
    const b = (await reserve(u, 50_000)).data as { event_id: string };
    await commit(b.event_id, 50);
    const id = (await db.pool.query("select id from payments")).rows[0].id;
    await db.rpc("billing_refund_payment", { p_payment: id, p_reason: "test" });
    expect(((await db.rpc("ai_get_headroom", { p_user: u })).data as { purchased_available_mcr: number }).purchased_available_mcr).toBe(0);
    expect((await db.pool.query("select amount_mcr from ai_credit_transactions where kind = 'refund'")).rows[0].amount_mcr).toBe("-1950000");
  });
  it("stays consistent and within balances under heavy concurrency across both pools", async () => {
    const u = await db.newUser();
    await paid(u, "pack", "credits_2000");
    await db.pool.query("update ai_credit_lots set credits_mcr = 400000");
    const outs = await Promise.all(Array.from({ length: 24 }, async () => {
      const r = (await reserve(u, 60_000)).data as { ok: boolean; event_id?: string };
      if (r.ok && r.event_id) { await commit(r.event_id, 60); }
      return r.ok;
    }));
    const done = outs.filter(Boolean).length;
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThanOrEqual(9); // 550 credits in total, 60 each
    const lot = (await db.pool.query("select used_mcr, reserved_mcr from ai_credit_lots")).rows[0];
    const p = (await db.pool.query("select used_mcr, reserved_mcr from ai_credit_periods")).rows[0];
    expect(Number(lot.reserved_mcr)).toBe(0);
    expect(Number(p.reserved_mcr)).toBe(0);
    expect(Number(lot.used_mcr) + Number(p.used_mcr)).toBe(done * 60_000);
    await assertConsistent();
  });
});

describe("project limits are enforced by the database", () => {
  const study = (owner: string) => db.pool.query("insert into studies (owner_id, title) values ($1, 'S')", [owner]);
  it("stops a free user at three projects and lets Pro hold more", async () => {
    const u = await db.newUser();
    for (let i = 0; i < 3; i++) await study(u);
    await expect(study(u)).rejects.toThrow(/plan_project_limit/);
    await paid(u, "subscription", "pro");
    await study(u);
    expect((await db.pool.query("select count(*)::int n from studies where owner_id = $1", [u])).rows[0].n).toBe(4);
  });
  it("counts per owner and never removes projects someone already has", async () => {
    const a = await db.newUser(), b = await db.newUser();
    for (let i = 0; i < 3; i++) await study(a);
    await study(b);
    await db.pool.query("update plans set max_projects = 1 where plan_key = 'free'");
    await expect(study(a)).rejects.toThrow(/plan_project_limit/);
    expect((await db.pool.query("select count(*)::int n from studies where owner_id = $1", [a])).rows[0].n).toBe(3);
    await db.pool.query("update plans set max_projects = null where plan_key = 'free'");
    for (let i = 0; i < 30; i++) await study(b);
    await db.pool.query("update plans set max_projects = 3 where plan_key = 'free'");
  });
});

describe("administrator reporting", () => {
  it("reports revenue, subscribers, cost by model and feature, margin and failures, with masked emails", async () => {
    const u = await db.newUser(), v = await db.newUser();
    await paid(u, "subscription", "pro");
    await paid(v, "pack", "credits_2000");
    const a = (await reserve(u, 100_000, "protocol_review")).data as { event_id: string };
    await commit(a.event_id, 100);
    await pay(v, "pack", "credits_2000").then(({ tx }) => db.rpc("billing_fulfill_payment", { p_tx_ref: tx, p_provider_txn: "bad", p_provider_status: "failed", p_amount: 4.99, p_currency: "USD" }));
    const o = (await db.rpc("billing_admin_overview", { p_from: new Date(Date.now() - 86400_000).toISOString(), p_to: new Date(Date.now() + 86400_000).toISOString() })).data as Record<string, any>;
    expect(o.paying_subscribers).toBe(1);
    expect(o.revenue.find((r: any) => r.kind === "subscription")).toMatchObject({ currency: "USD", payments: 1 });
    expect(Number(o.revenue.find((r: any) => r.kind === "pack").amount)).toBeCloseTo(4.99);
    expect(o.cost_by_model[0]).toMatchObject({ model_id: "claude-sonnet-5-5", operations: 1 });
    expect(Number(o.ai_cost_usd)).toBeCloseTo(0.1, 3);
    expect(o.usage_by_feature[0]).toMatchObject({ feature_key: "protocol_review", completed: 1 });
    expect(Number(o.margin.usd_revenue)).toBeCloseTo(12.98, 2);
    expect(Number(o.margin.estimated_gross_margin_usd)).toBeCloseTo(12.98 - 12.98 * 0.038 - 0.1, 1);
    expect(o.payment_failures.count).toBe(1);
    expect(o.payment_failures.recent[0].user_masked).toMatch(/^.\*\*\*@test\.local$/);
    expect(JSON.stringify(o)).not.toContain(u);
  });
  it("flags unusual usage without exposing identities", async () => {
    const heavy = await db.newUser();
    for (let i = 0; i < 5; i++) { const light = await db.newUser(); const r = (await reserve(light, 20_000)).data as { event_id: string }; await commit(r.event_id, 10); }
    await db.pool.query("update plans set intro_credits = 100000 where plan_key = 'free'");
    for (let i = 0; i < 4; i++) { const r = (await reserve(heavy, 400_000)).data as { event_id: string }; await commit(r.event_id, 400); }
    await db.pool.query("update plans set intro_credits = 150 where plan_key = 'free'");
    const flagged = (await db.rpc("billing_admin_unusual_usage", {})).data as { user_masked: string; flags: string[] }[];
    expect(flagged).toHaveLength(1);
    expect(flagged[0].user_masked).toMatch(/\*\*\*@/);
    expect(flagged[0].flags.length).toBeGreaterThan(0);
  });
  it("only people in app_admins are administrators", async () => {
    const a = await db.newUser(), b = await db.newUser();
    await db.pool.query("insert into app_admins (user_id) values ($1)", [a]);
    expect((await db.rpc("is_app_admin", { p_user: a })).data).toBe(true);
    expect((await db.rpc("is_app_admin", { p_user: b })).data).toBe(false);
  });
});

async function as<T>(role: "anon" | "authenticated", userId: string | null, fn: (c: PoolClient) => Promise<T>) {
  const c = await db.pool.connect();
  try {
    await c.query(`set role ${role}`);
    await c.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
    return await fn(c);
  } finally {
    await c.query("reset role");
    c.release();
  }
}

describe("who can call and read what", () => {
  it("no browser role can call a billing, credit or admin function", async () => {
    const u = await db.newUser();
    const calls = [
      "select public.billing_fulfill_payment('x1234567890123456', 't', 'successful', 100, 'USD')",
      "select public.billing_create_payment(auth.uid(), 'pack', 'credits_2000', 'USD', 'abcdefghijklmnopqrstuv')",
      "select public.billing_admin_overview(now() - interval '1 day', now())",
      "select public.billing_admin_unusual_usage()",
      "select public.billing_refund_payment(gen_random_uuid(), 'x')",
      "select public.ai_plan_allows(auth.uid(), 'pdf_qa')",
      "select public.is_app_admin(auth.uid())",
      "select public.ai_get_headroom(auth.uid())",
    ];
    for (const role of ["authenticated", "anon"] as const) {
      for (const sql of calls) await expect(as(role, role === "anon" ? null : u, (c) => c.query(sql)), `${role}: ${sql}`).rejects.toThrow(/permission denied/);
    }
  });
  it("users see only their own payments, lots and transactions, and cannot write any of them", async () => {
    const a = await db.newUser(), b = await db.newUser();
    await paid(a, "pack", "credits_2000");
    await paid(b, "pack", "credits_5000");
    for (const t of ["payments", "ai_credit_lots", "ai_credit_transactions"]) {
      expect((await as("authenticated", a, (c) => c.query(`select id from ${t}`))).rowCount, t).toBe(1);
      expect((await as("anon", null, (c) => c.query(`select id from ${t}`).catch(() => ({ rowCount: 0 })))).rowCount, `anon ${t}`).toBe(0);
    }
    await expect(as("authenticated", a, (c) => c.query("update payments set status = 'succeeded'"))).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", a, (c) => c.query("insert into ai_credit_lots (user_id, source, credits_mcr, expires_at) values ($1, 'grant', 99999999, now() + interval '1 year')", [a]))).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", a, (c) => c.query("update ai_credit_lots set credits_mcr = 99999999"))).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", a, (c) => c.query("insert into ai_credit_transactions (user_id, kind, pool, amount_mcr) values ($1, 'adjustment', 'purchased', 1000000)", [a]))).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", a, (c) => c.query("select provider_transaction_id from payments"))).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", a, (c) => c.query("select * from app_admins"))).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", a, (c) => c.query("select * from billing_settings"))).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", a, (c) => c.query("update plans set monthly_credits = 999999"))).rejects.toThrow(/permission denied/);
  });
  it("plans, prices and packs are readable by anyone but not writable", async () => {
    expect((await as("anon", null, (c) => c.query("select plan_key from plans"))).rowCount).toBe(2);
    expect((await as("anon", null, (c) => c.query("select product_key from billing_prices"))).rowCount).toBeGreaterThan(3);
    expect((await as("anon", null, (c) => c.query("select pack_key from credit_packs"))).rowCount).toBe(3);
    await expect(as("anon", null, (c) => c.query("update billing_prices set amount = 0.01"))).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", await db.newUser(), (c) => c.query("insert into credit_packs (pack_key, name, credits, expiry_days) values ('free_credits', 'x', 999999, 365)"))).rejects.toThrow(/permission denied/);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool, types } from "pg";

// Supabase returns date columns as plain strings; match that instead of JS Date objects.
types.setTypeParser(1082, (v) => v);
import type { RpcClient } from "../types";

// Integration tests run against an isolated scratch Postgres (NOT Supabase, NOT production).
// Default matches the throwaway cluster used during development; override with TEST_PG_URL
// (a server URL without database name, e.g. postgres://postgres@localhost:5544).
const SERVER_URL = process.env.TEST_PG_URL ?? "postgres://postgres@localhost:5544";
const DB_NAME = "toprot_test";

const SET_RETURNING = new Set(["ai_claim_pending_alerts"]);

export class TestDb implements RpcClient {
  pool!: Pool;
  failRpc: ((fn: string) => boolean) | null = null;

  /** Drops and recreates the scratch database, then loads the Supabase shim and the real migration. */
  static async create(): Promise<TestDb> {
    const admin = new Pool({ connectionString: `${SERVER_URL}/postgres`, max: 1 });
    await admin.query(`drop database if exists ${DB_NAME} with (force)`);
    await admin.query(`create database ${DB_NAME}`);
    await admin.end();

    const db = new TestDb();
    db.pool = new Pool({ connectionString: `${SERVER_URL}/${DB_NAME}`, max: 30 });
    const shim = readFileSync(path.join(__dirname, "fixtures", "supabase-shim.sql"), "utf8");
    const migration = readFileSync(
      path.resolve(__dirname, "../../../../../supabase/migrations/20261109120000_ai_usage_credits.sql"),
      "utf8",
    );
    await db.pool.query(shim);
    await db.pool.query(migration);
    return db;
  }

  async close() {
    await this.pool.end();
  }

  async rpc(fn: string, args: Record<string, unknown> = {}) {
    if (this.failRpc?.(fn)) return { data: null, error: { message: `injected failure in ${fn}` } };
    const names = Object.keys(args);
    const values = names.map((k) => {
      const v = args[k];
      return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    });
    const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
    try {
      if (SET_RETURNING.has(fn)) {
        const r = await this.pool.query(`select * from ${call}`, values);
        return { data: r.rows, error: null };
      }
      const r = await this.pool.query(`select ${call} as r`, values);
      return { data: r.rows[0]?.r ?? null, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }

  async newUser(): Promise<string> {
    const id = randomUUID();
    await this.pool.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.local`]);
    return id;
  }

  async setSetting(key: string, value: number) {
    await this.pool.query("update public.ai_settings set value_num = $2 where key = $1", [key, value]);
  }

  async resetState() {
    await this.pool.query(
      "truncate public.ai_usage_events, public.ai_credit_periods, public.ai_platform_days, public.ai_budget_alerts, public.ai_subscription_events, public.ai_subscriptions cascade",
    );
    await this.pool.query(`
      update public.ai_settings set value_num = case key
        when 'credit_value_micro_usd' then 1000 when 'free_intro_credits' then 150
        when 'pro_period_credits' then 2000 when 'platform_daily_budget_micro_usd' then 5000000
        when 'max_concurrent_ops_per_user' then 2 when 'max_ops_per_minute_per_user' then 6
        when 'reservation_lease_seconds' then 300 else value_num end`);
  }

  async period(userId: string) {
    const r = await this.pool.query("select * from public.ai_credit_periods where user_id = $1 order by created_at desc limit 1", [userId]);
    return r.rows[0] as { id: string; used_mcr: string; reserved_mcr: string; allowance_mcr: string; kind: string };
  }

  async platformDay() {
    const r = await this.pool.query("select * from public.ai_platform_days where day = (now() at time zone 'utc')::date");
    return r.rows[0] as { spent_micro_usd: string; reserved_micro_usd: string; budget_micro_usd: string } | undefined;
  }

  /** Bookkeeping invariants that must hold after ANY sequence of operations. */
  async assertConsistent() {
    const periods = await this.pool.query(`
      select p.id, p.used_mcr, p.reserved_mcr, p.allowance_mcr,
             coalesce((select sum(charged_mcr) from public.ai_usage_events e where e.period_id = p.id and e.status = 'committed'), 0) as ev_used,
             coalesce((select sum(reserved_mcr) from public.ai_usage_events e where e.period_id = p.id and e.status = 'reserved'), 0) as ev_reserved
      from public.ai_credit_periods p`);
    for (const p of periods.rows) {
      if (Number(p.used_mcr) !== Number(p.ev_used)) throw new Error(`period ${p.id}: used ${p.used_mcr} != events ${p.ev_used}`);
      if (Number(p.reserved_mcr) !== Number(p.ev_reserved)) throw new Error(`period ${p.id}: reserved ${p.reserved_mcr} != events ${p.ev_reserved}`);
    }
    const days = await this.pool.query(`
      select d.day, d.spent_micro_usd, d.reserved_micro_usd,
             coalesce((select sum(cost_micro_usd + platform_exposure_micro_usd) from public.ai_usage_events e where e.platform_day = d.day and e.status in ('committed','released','failed')), 0) as ev_spent,
             coalesce((select sum(reserved_micro_usd) from public.ai_usage_events e where e.platform_day = d.day and e.status = 'reserved'), 0) as ev_reserved
      from public.ai_platform_days d`);
    for (const d of days.rows) {
      if (Number(d.spent_micro_usd) !== Number(d.ev_spent)) throw new Error(`day ${d.day}: spent ${d.spent_micro_usd} != events ${d.ev_spent}`);
      if (Number(d.reserved_micro_usd) !== Number(d.ev_reserved)) throw new Error(`day ${d.day}: reserved ${d.reserved_micro_usd} != events ${d.ev_reserved}`);
    }
  }
}

export const U = (input: number, output: number) => ({
  input, output, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, toolUsage: {}, iterations: 1,
});

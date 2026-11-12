import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "@/lib/ai/__tests__/helpers";

// The index migration touches many tables from many earlier migrations, so this test builds minimal stand-ins with just the
// columns it indexes. It proves the statements are valid, safe to repeat and add exactly what they say. The real column names
// are checked against the production schema when the migration is applied.

let db: TestDb;
const MIG = path.resolve(__dirname, "../../../../../supabase/migrations/20261118090000_foreign_key_indexes.sql");
const TABLES: Record<string, string> = {
  amendments: "study_id uuid", deviation_reports: "study_id uuid, protocol_version_id uuid", deviations: "protocol_version_id uuid", assistant_threads: "study_id uuid",
  ai_credit_transactions: "lot_id uuid, payment_id uuid, event_id uuid", ai_credit_allocations: "lot_id uuid", payment_events: "payment_id uuid", ai_subscription_events: "user_id uuid", pdf_annotations: "owner_id uuid",
};

beforeAll(async () => {
  db = await TestDb.create();
  for (const [t, cols] of Object.entries(TABLES)) await db.pool.query(`create table if not exists public.${t} (id uuid primary key default gen_random_uuid(), ${cols})`);
});
afterAll(async () => { await db.close(); });

const indexNames = async () => (await db.pool.query("select indexname from pg_indexes where schemaname = 'public' and indexname not like '%_pkey' order by 1")).rows.map((r) => r.indexname as string);

describe("foreign key index migration", () => {
  it("creates the intended indexes and does nothing else", async () => {
    const before = await indexNames();
    await db.pool.query(readFileSync(MIG, "utf8"));
    const added = (await indexNames()).filter((n) => !before.includes(n));
    expect(added.sort()).toEqual([
      "ai_credit_allocations_lot_idx", "ai_credit_transactions_event_idx", "ai_credit_transactions_lot_idx", "ai_credit_transactions_payment_idx",
      "ai_subscription_events_user_idx", "amendments_study_idx", "assistant_threads_study_idx", "deviation_reports_study_idx", "deviation_reports_version_idx",
      "deviations_version_idx", "payment_events_payment_idx", "pdf_annotations_owner_idx",
    ]);
  });

  it("is safe to run again", async () => {
    const once = await indexNames();
    await db.pool.query(readFileSync(MIG, "utf8"));
    expect(await indexNames()).toEqual(once);
  });

  it("only adds indexes: no drops, deletes or data changes", () => {
    const sql = readFileSync(MIG, "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(drop|delete|update|truncate|alter)\b/i);
    for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) expect(stmt).toMatch(/^create index if not exists /i);
  });
});

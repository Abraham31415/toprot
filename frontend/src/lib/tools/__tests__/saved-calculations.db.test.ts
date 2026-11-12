import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test for supabase/migrations/20261110090000_saved_calculations.sql against an
// isolated scratch Postgres (never Supabase). Own database so other suites cannot clash.
const SERVER_URL = process.env.TEST_PG_URL ?? "postgres://postgres@localhost:5544";
const DB_NAME = "toprot_saved_calc_test";
const MIGRATIONS = path.resolve(__dirname, "../../../../../supabase/migrations");
const SHIM = path.resolve(__dirname, "../../ai/__tests__/fixtures/supabase-shim.sql");
const SKIP = [/outputs_storage/, /ai_usage_credits/, /writing_and_pdf_library/, /research_pdfs_storage/, /manuscript_figures_storage/, /ai_research_assistant/, /billing_plans_payments/, /billing_provider_dodo/, /billing_pack_rules/];

let pool: Pool;

beforeAll(async () => {
  const admin = new Pool({ connectionString: `${SERVER_URL}/postgres`, max: 1 });
  await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();
  pool = new Pool({ connectionString: `${SERVER_URL}/${DB_NAME}`, max: 5 });
  await pool.query(readFileSync(SHIM, "utf8"));
  await pool.query("create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$");
  await pool.query("alter table auth.users add column if not exists raw_user_meta_data jsonb");
  for (const f of readdirSync(MIGRATIONS).sort()) {
    if (SKIP.some((r) => r.test(f))) continue;
    await pool.query(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
});
afterAll(async () => {
  await pool.end();
});

async function newUser(role: "student" | "supervisor" = "student") {
  const id = randomUUID();
  await pool.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${id}@t.local`, JSON.stringify({ role, full_name: "T" })]);
  return id;
}
async function newStudy() {
  const owner = await newUser();
  const study = (await pool.query("insert into studies (owner_id, title) values ($1, 'S') returning id", [owner])).rows[0].id as string;
  return { owner, study };
}
async function asUser<T>(userId: string, fn: (c: PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query("set role authenticated");
    await c.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    return await fn(c);
  } finally {
    await c.query("reset role");
    await c.query("select set_config('request.jwt.claim.sub', '', false)");
    c.release();
  }
}
const insert = (c: PoolClient, study: string, extra = {}) =>
  c.query("insert into saved_calculations (study_id, tool_slug, tool_name, inputs, result) values ($1, 'x', 'X', $2, $3) returning id, created_by", [study, JSON.stringify({ a: "1", ...extra }), JSON.stringify({ headline: { value: "1" } })]);

describe("saved_calculations", () => {
  it("lets the owner insert and read, and records created_by from the session", async () => {
    const s = await newStudy();
    const r = await asUser(s.owner, (c) => insert(c, s.study));
    expect(r.rows[0].created_by).toBe(s.owner);
    const rows = await asUser(s.owner, (c) => c.query("select id from saved_calculations where study_id = $1", [s.study]));
    expect(rows.rowCount).toBe(1);
  });
  it("blocks other users from reading or writing", async () => {
    const s = await newStudy();
    await asUser(s.owner, (c) => insert(c, s.study));
    const stranger = await newUser();
    expect((await asUser(stranger, (c) => c.query("select id from saved_calculations"))).rowCount).toBe(0);
    await expect(asUser(stranger, (c) => insert(c, s.study))).rejects.toThrow(/row-level security/);
  });
  it("lets an attached supervisor read but not write", async () => {
    const s = await newStudy();
    await asUser(s.owner, (c) => insert(c, s.study));
    const sup = await newUser("supervisor");
    const existing = await pool.query("select id from workspaces where supervisor_id = $1", [sup]);
    const ws = existing.rows[0]?.id ?? (await pool.query("insert into workspaces (supervisor_id, name) values ($1, 'W') returning id", [sup])).rows[0].id;
    await pool.query("insert into study_supervisors (study_id, supervisor_id, workspace_id) values ($1, $2, $3)", [s.study, sup, ws]);
    expect((await asUser(sup, (c) => c.query("select id from saved_calculations where study_id = $1", [s.study]))).rowCount).toBe(1);
    await expect(asUser(sup, (c) => insert(c, s.study))).rejects.toThrow(/row-level security/);
  });
  it("lets only the owner delete a saved calculation", async () => {
    const s = await newStudy();
    const row = await asUser(s.owner, (c) => insert(c, s.study));
    const stranger = await newUser();
    const denied = await asUser(stranger, (c) => c.query("delete from saved_calculations where id = $1", [row.rows[0].id]));
    expect(denied.rowCount).toBe(0);
    const done = await asUser(s.owner, (c) => c.query("delete from saved_calculations where id = $1", [row.rows[0].id]));
    expect(done.rowCount).toBe(1);
  });
  it("is not accessible to the anon role", async () => {
    const c = await pool.connect();
    try {
      await c.query("set role anon");
      const r = await c.query("select id from saved_calculations");
      expect(r.rowCount).toBe(0);
    } finally {
      await c.query("reset role");
      c.release();
    }
  });
  it("rejects oversize inputs and cascades on study delete", async () => {
    const s = await newStudy();
    await expect(asUser(s.owner, (c) => insert(c, s.study, { big: "x".repeat(30000) }))).rejects.toThrow(/inputs_size/);
    await asUser(s.owner, (c) => insert(c, s.study));
    await pool.query("delete from studies where id = $1", [s.study]);
    expect((await pool.query("select 1 from saved_calculations where study_id = $1", [s.study])).rowCount).toBe(0);
  });
});

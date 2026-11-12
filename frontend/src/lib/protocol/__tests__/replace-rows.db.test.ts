import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Integration test for supabase/migrations/20261109130000_atomic_protocol_replace.sql.
// Runs against an isolated scratch Postgres (never Supabase). Same server as the AI tests
// (override with TEST_PG_URL), but its own database so the two suites cannot clash.
const SERVER_URL = process.env.TEST_PG_URL ?? "postgres://postgres@localhost:5544";
const DB_NAME = "toprot_protocol_test";
const MIGRATIONS = path.resolve(__dirname, "../../../../../supabase/migrations");
const SHIM = path.resolve(__dirname, "../../ai/__tests__/fixtures/supabase-shim.sql");
// outputs_storage needs the Supabase storage schema and the AI migration is unrelated.
const SKIP = [/outputs_storage/, /ai_usage_credits/, /writing_and_pdf_library/, /research_pdfs_storage/, /manuscript_figures_storage/, /ai_research_assistant/, /billing_plans_payments/, /billing_provider_dodo/, /billing_pack_rules/, /foreign_key_indexes/, /admin_console/];

let pool: Pool;

beforeAll(async () => {
  const admin = new Pool({ connectionString: `${SERVER_URL}/postgres`, max: 1 });
  await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();
  pool = new Pool({ connectionString: `${SERVER_URL}/${DB_NAME}`, max: 5 });
  await pool.query(readFileSync(SHIM, "utf8"));
  // Some app migrations reference auth.jwt(), which the AI-test shim does not define.
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

type Ids = { owner: string; version: string; study: string };

async function newUser(role: "student" | "supervisor" = "student"): Promise<string> {
  const id = randomUUID();
  await pool.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    `${id}@test.local`,
    JSON.stringify({ role, full_name: "Test" }),
  ]).catch(async () => {
    // The shim's auth.users has no raw_user_meta_data column; add the profile by hand.
    await pool.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.local`]);
    await pool.query("insert into profiles (id, role, full_name) values ($1, $2, 'Test')", [id, role]);
  });
  return id;
}

async function newStudy(status: "draft" | "registered" = "draft"): Promise<Ids> {
  const owner = await newUser();
  const study = (await pool.query("insert into studies (owner_id, title) values ($1, 'S') returning id", [owner])).rows[0].id;
  const version = (
    await pool.query(
      "insert into protocol_versions (study_id, version_number, status) values ($1, 1, $2) returning id",
      [study, status],
    )
  ).rows[0].id;
  return { owner, study, version };
}

/** Run a call as an authenticated Supabase user (RLS applies), autocommit like a PostgREST rpc. */
async function asUser<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
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

const rpc = (userId: string, fn: string, versionId: string, rows: unknown) =>
  asUser(userId, (c) => c.query(`select public.${fn}($1, $2::jsonb)`, [versionId, JSON.stringify(rows)]));

const objectives = async (v: string) =>
  (await pool.query("select objective_type, description, display_order from protocol_objectives where protocol_version_id = $1 order by display_order", [v])).rows;
const variables = async (v: string) =>
  (await pool.query("select variable_name, variable_slug, variable_type, role, unit, value_labels, display_order from protocol_variables where protocol_version_id = $1 order by display_order", [v])).rows;

const V = (name: string, slug = name.toLowerCase(), over: Record<string, unknown> = {}) => ({
  variable_name: name,
  variable_slug: slug,
  variable_type: "continuous",
  role: "outcome",
  unit: null,
  value_labels: null,
  measurement_timepoint: null,
  description: null,
  ...over,
});

describe("replace_protocol_objectives", () => {
  let s: Ids;
  beforeEach(async () => {
    s = await newStudy();
  });

  it("replaces existing rows and assigns display_order from array position", async () => {
    await rpc(s.owner, "replace_protocol_objectives", s.version, [
      { objective_type: "primary", description: "old a" },
      { objective_type: "secondary", description: "old b" },
    ]);
    await rpc(s.owner, "replace_protocol_objectives", s.version, [
      { objective_type: "primary", description: "new a" },
      { objective_type: "secondary", description: "new b" },
      { objective_type: "secondary", description: "new c" },
    ]);
    expect(await objectives(s.version)).toEqual([
      { objective_type: "primary", description: "new a", display_order: 0 },
      { objective_type: "secondary", description: "new b", display_order: 1 },
      { objective_type: "secondary", description: "new c", display_order: 2 },
    ]);
  });

  it("an empty array clears the list", async () => {
    await rpc(s.owner, "replace_protocol_objectives", s.version, [{ objective_type: "primary", description: "x" }]);
    await rpc(s.owner, "replace_protocol_objectives", s.version, []);
    expect(await objectives(s.version)).toEqual([]);
  });

  it("only touches the targeted version", async () => {
    const other = await newStudy();
    await rpc(other.owner, "replace_protocol_objectives", other.version, [{ objective_type: "primary", description: "keep me" }]);
    await rpc(s.owner, "replace_protocol_objectives", s.version, [{ objective_type: "primary", description: "mine" }]);
    expect(await objectives(other.version)).toHaveLength(1);
  });

  it("a failing insert rolls back the delete: old rows stay intact", async () => {
    await rpc(s.owner, "replace_protocol_objectives", s.version, [
      { objective_type: "primary", description: "precious 1" },
      { objective_type: "secondary", description: "precious 2" },
    ]);
    const before = await objectives(s.version);
    // Second row has an invalid enum value, so the insert fails after the delete ran.
    await expect(
      rpc(s.owner, "replace_protocol_objectives", s.version, [
        { objective_type: "primary", description: "fine" },
        { objective_type: "bogus", description: "bad" },
      ]),
    ).rejects.toThrow(/objective_type/);
    expect(await objectives(s.version)).toEqual(before);
  });

  it("a null description (NOT NULL violation) also leaves old rows intact", async () => {
    await rpc(s.owner, "replace_protocol_objectives", s.version, [{ objective_type: "primary", description: "keep" }]);
    await expect(
      rpc(s.owner, "replace_protocol_objectives", s.version, [{ objective_type: "primary" }]),
    ).rejects.toThrow(/null value/);
    expect((await objectives(s.version)).map((r) => r.description)).toEqual(["keep"]);
  });

  it("rejects non-array input without changing anything", async () => {
    await rpc(s.owner, "replace_protocol_objectives", s.version, [{ objective_type: "primary", description: "keep" }]);
    await expect(rpc(s.owner, "replace_protocol_objectives", s.version, { a: 1 })).rejects.toThrow(/JSON array/);
    await expect(rpc(s.owner, "replace_protocol_objectives", s.version, null)).rejects.toThrow(/JSON array/);
    expect(await objectives(s.version)).toHaveLength(1);
  });

  it("rejects an unknown version id", async () => {
    await expect(rpc(s.owner, "replace_protocol_objectives", randomUUID(), [])).rejects.toThrow(/not found/);
  });
});

describe("replace_protocol_variables", () => {
  let s: Ids;
  beforeEach(async () => {
    s = await newStudy();
  });

  it("replaces existing rows, keeps all columns, defaults role, orders by position", async () => {
    await rpc(s.owner, "replace_protocol_variables", s.version, [V("Old")]);
    await rpc(s.owner, "replace_protocol_variables", s.version, [
      V("Age", "age", { unit: "years" }),
      { variable_name: "Sex", variable_slug: "sex", variable_type: "categorical", value_labels: { "1": "M", "2": "F" } },
    ]);
    expect(await variables(s.version)).toEqual([
      { variable_name: "Age", variable_slug: "age", variable_type: "continuous", role: "outcome", unit: "years", value_labels: null, display_order: 0 },
      { variable_name: "Sex", variable_slug: "sex", variable_type: "categorical", role: "other", unit: null, value_labels: { "1": "M", "2": "F" }, display_order: 1 },
    ]);
  });

  it("a duplicate slug fails the call and leaves the old variables intact", async () => {
    await rpc(s.owner, "replace_protocol_variables", s.version, [V("Keep1"), V("Keep2")]);
    const before = await variables(s.version);
    await expect(
      rpc(s.owner, "replace_protocol_variables", s.version, [V("A", "dup"), V("B", "dup")]),
    ).rejects.toThrow(/duplicate key|unique/);
    expect(await variables(s.version)).toEqual(before);
  });

  it("an invalid enum or missing required field leaves old variables intact", async () => {
    await rpc(s.owner, "replace_protocol_variables", s.version, [V("Keep")]);
    await expect(
      rpc(s.owner, "replace_protocol_variables", s.version, [V("A", "a", { variable_type: "bogus" })]),
    ).rejects.toThrow(/variable_type/);
    await expect(
      rpc(s.owner, "replace_protocol_variables", s.version, [{ variable_slug: "x", variable_type: "text" }]),
    ).rejects.toThrow(/null value/);
    expect((await variables(s.version)).map((r) => r.variable_name)).toEqual(["Keep"]);
  });

  it("the same slug is fine across different versions", async () => {
    const other = await newStudy();
    await rpc(other.owner, "replace_protocol_variables", other.version, [V("Age", "age")]);
    await rpc(s.owner, "replace_protocol_variables", s.version, [V("Age", "age")]);
    expect(await variables(other.version)).toHaveLength(1);
    expect(await variables(s.version)).toHaveLength(1);
  });

  it("rejects non-array input and clears on empty array", async () => {
    await rpc(s.owner, "replace_protocol_variables", s.version, [V("Keep")]);
    await expect(rpc(s.owner, "replace_protocol_variables", s.version, "nope")).rejects.toThrow(/JSON array/);
    expect(await variables(s.version)).toHaveLength(1);
    await rpc(s.owner, "replace_protocol_variables", s.version, []);
    expect(await variables(s.version)).toEqual([]);
  });
});

describe.each([
  ["replace_protocol_objectives", () => [{ objective_type: "primary", description: "x" }], objectives],
  ["replace_protocol_variables", () => [V("X")], variables],
] as const)("%s permissions", (fn, mkRows, read) => {
  it("another user cannot write; existing rows untouched", async () => {
    const s = await newStudy();
    await rpc(s.owner, fn, s.version, mkRows());
    const before = await read(s.version);
    const stranger = await newUser();
    await expect(rpc(stranger, fn, s.version, [])).rejects.toThrow(/not found|owner/);
    expect(await read(s.version)).toEqual(before);
  });

  it("an attached supervisor (read-only on content) cannot write", async () => {
    const s = await newStudy();
    await rpc(s.owner, fn, s.version, mkRows());
    const before = await read(s.version);
    const sup = await newUser("supervisor");
    const ws = (await pool.query("select id from workspaces where supervisor_id = $1", [sup])).rows[0]?.id
      ?? (await pool.query("insert into workspaces (supervisor_id, name) values ($1, 'W') returning id", [sup])).rows[0].id;
    await pool.query("insert into study_supervisors (study_id, supervisor_id, workspace_id) values ($1, $2, $3)", [s.study, sup, ws]);
    await expect(rpc(sup, fn, s.version, [])).rejects.toThrow(/not found|owner/);
    expect(await read(s.version)).toEqual(before);
  });

  it("is refused once the version is registered, rows untouched", async () => {
    const s = await newStudy();
    await rpc(s.owner, fn, s.version, mkRows());
    const before = await read(s.version);
    await pool.query("update protocol_versions set status = 'registered' where id = $1", [s.version]);
    await expect(rpc(s.owner, fn, s.version, [])).rejects.toThrow(/draft/);
    expect(await read(s.version)).toEqual(before);
  });

  it("is not callable by the anon role", async () => {
    const s = await newStudy();
    const c = await pool.connect();
    try {
      await c.query("set role anon");
      await expect(c.query(`select public.${fn}($1, '[]'::jsonb)`, [s.version])).rejects.toThrow(/permission denied/);
    } finally {
      await c.query("reset role");
      c.release();
    }
  });
});

describe("concurrency", () => {
  it("parallel replaces for one version serialise: the result is exactly one of the payloads", async () => {
    const s = await newStudy();
    const sets = Array.from({ length: 6 }, (_, i) => [V(`V${i}a`, `v${i}a`), V(`V${i}b`, `v${i}b`)]);
    await Promise.all(sets.map((rows) => rpc(s.owner, "replace_protocol_variables", s.version, rows)));
    const names = (await variables(s.version)).map((r) => r.variable_name);
    expect(sets.map((r) => r.map((v) => v.variable_name))).toContainEqual(names);
  });
});

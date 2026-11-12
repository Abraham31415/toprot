import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test for supabase/migrations/20261112090000_reference_manager_v2.sql on an isolated scratch Postgres.
const SERVER_URL = process.env.TEST_PG_URL ?? "postgres://postgres@localhost:5544";
const DB_NAME = "toprot_refs_v2_test";
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
  const files = readdirSync(MIGRATIONS).sort().filter((f) => !SKIP.some((r) => r.test(f)));
  // Apply everything before the v2 migration first, so the "existing rows keep working" test is realistic.
  for (const f of files.filter((x) => x < "20261112090000")) await pool.query(readFileSync(path.join(MIGRATIONS, f), "utf8"));
});
afterAll(async () => { await pool.end(); });

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

describe("migration applies cleanly over existing data", () => {
  let legacyStudy: string;
  it("keeps pre-existing references intact when the migration runs", async () => {
    const s = await newStudy();
    legacyStudy = s.study;
    // A row written exactly as the old code wrote it.
    await pool.query("insert into study_references (study_id, identifier_type, doi, authors, title, journal, year) values ($1, 'doi', '10.1000/a', array['Smith JA'], 'Old reference', 'J', 2019)", [s.study]);
    const file = readdirSync(MIGRATIONS).find((f) => f.startsWith("20261112090000"))!;
    await pool.query(readFileSync(path.join(MIGRATIONS, file), "utf8"));
    const r = (await pool.query("select title, tags, keywords, source, notes, collection_id, author_details from study_references where study_id = $1", [legacyStudy])).rows[0];
    expect(r).toMatchObject({ title: "Old reference", tags: [], keywords: [], source: null, notes: null, collection_id: null, author_details: null });
  });
  it("still accepts the old insert shape", async () => {
    await pool.query("insert into study_references (study_id, identifier_type, authors, title) values ($1, 'manual', '{}', 'Legacy insert')", [legacyStudy]);
  });
});

describe("new columns and constraints", () => {
  const ins = (study: string, extra: Record<string, unknown>) => {
    const cols = ["study_id", "identifier_type", "title", ...Object.keys(extra)];
    const vals = [study, "manual", "T", ...Object.values(extra)];
    return pool.query(`insert into study_references (${cols.join(",")}) values (${vals.map((_, i) => `$${i + 1}`).join(",")})`, vals);
  };
  it("accepts the documented sources and rejects others", async () => {
    const { study } = await newStudy();
    for (const source of ["manual", "crossref", "pubmed", "openalex", "import", "zotero"]) await ins(study, { source });
    await expect(ins(study, { source: "made-up" })).rejects.toThrow(/source_check/);
  });
  it("caps abstract, notes, tags and keywords", async () => {
    const { study } = await newStudy();
    await expect(ins(study, { abstract: "x".repeat(20001) })).rejects.toThrow(/abstract_size/);
    await expect(ins(study, { notes: "x".repeat(5001) })).rejects.toThrow(/notes_size/);
    await expect(ins(study, { tags: Array.from({ length: 31 }, (_, i) => `t${i}`) })).rejects.toThrow(/tags_size/);
    await expect(ins(study, { keywords: Array.from({ length: 51 }, (_, i) => `k${i}`) })).rejects.toThrow(/keywords_size/);
    await ins(study, { abstract: "x".repeat(20000), tags: Array.from({ length: 30 }, (_, i) => `t${i}`) });
  });
  it("stores structured authors and open-access data", async () => {
    const { study } = await newStudy();
    await ins(study, { author_details: JSON.stringify([{ family: "Smith", given: "John A." }]), is_open_access: true, open_access_url: "https://x.org", openalex_id: "W1" });
    const r = (await pool.query("select author_details, is_open_access from study_references where study_id = $1", [study])).rows[0];
    expect(r.author_details[0].family).toBe("Smith");
    expect(r.is_open_access).toBe(true);
  });
});

describe("collections", () => {
  it("lets the owner manage collections and file references into them", async () => {
    const { owner, study } = await newStudy();
    const col = (await asUser(owner, (c) => c.query("insert into reference_collections (study_id, name) values ($1, 'Chapter 1') returning id", [study]))).rows[0].id;
    await asUser(owner, (c) => c.query("insert into study_references (study_id, identifier_type, title, collection_id) values ($1, 'manual', 'In collection', $2)", [study, col]));
    expect((await asUser(owner, (c) => c.query("select id from study_references where collection_id = $1", [col]))).rowCount).toBe(1);
  });
  it("rejects duplicate names within a study but allows the same name in another study", async () => {
    const a = await newStudy(), b = await newStudy();
    await asUser(a.owner, (c) => c.query("insert into reference_collections (study_id, name) values ($1, 'Same')", [a.study]));
    await expect(asUser(a.owner, (c) => c.query("insert into reference_collections (study_id, name) values ($1, 'Same')", [a.study]))).rejects.toThrow(/unique|duplicate/);
    await asUser(b.owner, (c) => c.query("insert into reference_collections (study_id, name) values ($1, 'Same')", [b.study]));
  });
  it("rejects empty and over-long names", async () => {
    const { owner, study } = await newStudy();
    await expect(asUser(owner, (c) => c.query("insert into reference_collections (study_id, name) values ($1, '   ')", [study]))).rejects.toThrow(/check/);
    await expect(asUser(owner, (c) => c.query("insert into reference_collections (study_id, name) values ($1, $2)", [study, "x".repeat(81)]))).rejects.toThrow(/check/);
  });
  it("keeps references when their collection is deleted", async () => {
    const { owner, study } = await newStudy();
    const col = (await asUser(owner, (c) => c.query("insert into reference_collections (study_id, name) values ($1, 'Temp') returning id", [study]))).rows[0].id;
    await asUser(owner, (c) => c.query("insert into study_references (study_id, identifier_type, title, collection_id) values ($1, 'manual', 'Kept', $2)", [study, col]));
    await asUser(owner, (c) => c.query("delete from reference_collections where id = $1", [col]));
    const r = (await asUser(owner, (c) => c.query("select collection_id from study_references where study_id = $1", [study]))).rows[0];
    expect(r.collection_id).toBeNull();
  });
  it("blocks strangers entirely and lets an attached supervisor read but not write", async () => {
    const { owner, study } = await newStudy();
    await asUser(owner, (c) => c.query("insert into reference_collections (study_id, name) values ($1, 'Private')", [study]));
    const stranger = await newUser();
    expect((await asUser(stranger, (c) => c.query("select id from reference_collections"))).rowCount).toBe(0);
    await expect(asUser(stranger, (c) => c.query("insert into reference_collections (study_id, name) values ($1, 'X')", [study]))).rejects.toThrow(/row-level security/);
    const sup = await newUser("supervisor");
    const ws = (await pool.query("select id from workspaces where supervisor_id = $1", [sup])).rows[0]?.id ?? (await pool.query("insert into workspaces (supervisor_id, name) values ($1, 'W') returning id", [sup])).rows[0].id;
    await pool.query("insert into study_supervisors (study_id, supervisor_id, workspace_id) values ($1, $2, $3)", [study, sup, ws]);
    expect((await asUser(sup, (c) => c.query("select id from reference_collections where study_id = $1", [study]))).rowCount).toBe(1);
    await expect(asUser(sup, (c) => c.query("insert into reference_collections (study_id, name) values ($1, 'Y')", [study]))).rejects.toThrow(/row-level security/);
  });
  it("deletes collections with their study", async () => {
    const { owner, study } = await newStudy();
    await asUser(owner, (c) => c.query("insert into reference_collections (study_id, name) values ($1, 'Gone')", [study]));
    await pool.query("delete from studies where id = $1", [study]);
    expect((await pool.query("select 1 from reference_collections where study_id = $1", [study])).rowCount).toBe(0);
  });
  it("is closed to the anon role", async () => {
    const c = await pool.connect();
    try { await c.query("set role anon"); expect((await c.query("select id from reference_collections")).rowCount).toBe(0); } finally { await c.query("reset role"); c.release(); }
  });
});

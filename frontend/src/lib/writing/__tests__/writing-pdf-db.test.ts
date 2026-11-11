import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test for supabase/migrations/20261113090000_writing_and_pdf_library.sql and the storage migration,
// on an isolated scratch Postgres (never Supabase or production).
const SERVER_URL = process.env.TEST_PG_URL ?? "postgres://postgres@localhost:5544";
const DB_NAME = "toprot_writing_pdf_test";
const MIGRATIONS = path.resolve(__dirname, "../../../../../supabase/migrations");
const SHIM = path.resolve(__dirname, "../../ai/__tests__/fixtures/supabase-shim.sql");

const STORAGE_SHIM = `
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
`;

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
  await pool.query(STORAGE_SHIM);
  for (const f of readdirSync(MIGRATIONS).sort()) await pool.query(readFileSync(path.join(MIGRATIONS, f), "utf8"));
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
const doc = (text: string) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function newManuscript(owner: string, study: string, title = "Draft") {
  return (await asUser(owner, (c) => c.query("insert into manuscripts (study_id, title, template) values ($1, $2, 'original_article') returning id, revision", [study, title]))).rows[0] as { id: string; revision: number };
}
const save = (c: PoolClient, id: string, base: number, text: string, snapshot = false, label: string | null = null) =>
  c.query("select public.save_manuscript($1, $2, $3, $4::jsonb, $5, $6, $7) as rev", [id, base, "Draft", doc(text), text.split(/\s+/).length, snapshot, label]);

describe("manuscripts", () => {
  it("lets the study owner create, and strangers neither see nor create", async () => {
    const { owner, study } = await newStudy();
    const m = await newManuscript(owner, study);
    expect(m.revision).toBe(1);
    const stranger = await newUser();
    expect((await asUser(stranger, (c) => c.query("select id from manuscripts"))).rowCount).toBe(0);
    await expect(asUser(stranger, (c) => c.query("insert into manuscripts (study_id, title) values ($1, 'X')", [study]))).rejects.toThrow(/row-level security/);
  });

  it("rejects unknown templates, empty titles and bad style ids", async () => {
    const { owner, study } = await newStudy();
    await expect(asUser(owner, (c) => c.query("insert into manuscripts (study_id, title, template) values ($1, 'T', 'novel')", [study]))).rejects.toThrow(/check/);
    await expect(asUser(owner, (c) => c.query("insert into manuscripts (study_id, title) values ($1, '  ')", [study]))).rejects.toThrow(/check/);
    await expect(asUser(owner, (c) => c.query("insert into manuscripts (study_id, title, style_id) values ($1, 'T', '../etc')", [study]))).rejects.toThrow(/check/);
  });

  it("lets an attached supervisor read but never write", async () => {
    const { owner, study } = await newStudy();
    const m = await newManuscript(owner, study);
    const sup = await newUser("supervisor");
    const ws = (await pool.query("select id from workspaces where supervisor_id = $1", [sup])).rows[0]?.id ?? (await pool.query("insert into workspaces (supervisor_id, name) values ($1, 'W') returning id", [sup])).rows[0].id;
    await pool.query("insert into study_supervisors (study_id, supervisor_id, workspace_id) values ($1, $2, $3)", [study, sup, ws]);
    expect((await asUser(sup, (c) => c.query("select id from manuscripts where id = $1", [m.id]))).rowCount).toBe(1);
    await expect(asUser(sup, (c) => save(c, m.id, 1, "hacked"))).rejects.toThrow(/manuscript_forbidden/);
    expect((await pool.query("select revision from manuscripts where id = $1", [m.id])).rows[0].revision).toBe(1);
  });

  it("is deleted with its study", async () => {
    const { owner, study } = await newStudy();
    const m = await newManuscript(owner, study);
    await asUser(owner, (c) => save(c, m.id, 1, "one"));
    await pool.query("delete from studies where id = $1", [study]);
    expect((await pool.query("select 1 from manuscripts where id = $1", [m.id])).rowCount).toBe(0);
    expect((await pool.query("select 1 from manuscript_versions where manuscript_id = $1", [m.id])).rowCount).toBe(0);
  });
});

describe("save_manuscript", () => {
  it("increments the revision and stores the content", async () => {
    const { owner, study } = await newStudy();
    const m = await newManuscript(owner, study);
    const r = (await asUser(owner, (c) => save(c, m.id, 1, "hello world"))).rows[0].rev;
    expect(r).toBe(2);
    const row = (await pool.query("select content, word_count, revision from manuscripts where id = $1", [m.id])).rows[0];
    expect(row.content.content[0].content[0].text).toBe("hello world");
    expect(row).toMatchObject({ word_count: 2, revision: 2 });
  });

  it("refuses a stale revision, so two tabs cannot overwrite each other", async () => {
    const { owner, study } = await newStudy();
    const m = await newManuscript(owner, study);
    await asUser(owner, (c) => save(c, m.id, 1, "tab one"));
    await expect(asUser(owner, (c) => save(c, m.id, 1, "tab two"))).rejects.toThrow(/revision_conflict/);
    expect((await pool.query("select content from manuscripts where id = $1", [m.id])).rows[0].content.content[0].content[0].text).toBe("tab one");
  });

  it("serialises concurrent saves: exactly one wins", async () => {
    const { owner, study } = await newStudy();
    const m = await newManuscript(owner, study);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => asUser(owner, (c) => save(c, m.id, 1, `writer ${i}`))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await pool.query("select revision from manuscripts where id = $1", [m.id])).rows[0].revision).toBe(2);
  });

  it("reports a missing manuscript", async () => {
    const { owner } = await newStudy();
    await expect(asUser(owner, (c) => save(c, randomUUID(), 1, "x"))).rejects.toThrow(/manuscript_not_found/);
  });

  it("snapshots on the first save, then at most every 10 minutes", async () => {
    const { owner, study } = await newStudy();
    const m = await newManuscript(owner, study);
    await asUser(owner, async (c) => { await save(c, m.id, 1, "v1"); await save(c, m.id, 2, "v2"); await save(c, m.id, 3, "v3"); });
    expect((await pool.query("select count(*)::int n from manuscript_versions where manuscript_id = $1", [m.id])).rows[0].n).toBe(1);
    await pool.query("update manuscript_versions set created_at = now() - interval '11 minutes' where manuscript_id = $1", [m.id]);
    await asUser(owner, (c) => save(c, m.id, 4, "v4"));
    expect((await pool.query("select count(*)::int n from manuscript_versions where manuscript_id = $1", [m.id])).rows[0].n).toBe(2);
  });

  it("keeps manual versions with their label, and only the newest 40 automatic ones", async () => {
    const { owner, study } = await newStudy();
    const m = await newManuscript(owner, study);
    await asUser(owner, (c) => save(c, m.id, 1, "labelled", true, "Submitted to supervisor"));
    expect((await pool.query("select kind, label from manuscript_versions where manuscript_id = $1", [m.id])).rows).toEqual([{ kind: "manual", label: "Submitted to supervisor" }]);
    for (let i = 0; i < 45; i++) {
      await pool.query("insert into manuscript_versions (manuscript_id, revision, title, content, kind, created_at) values ($1, 1, 't', '{}'::jsonb, 'auto', now() - ($2 || ' minutes')::interval)", [m.id, String(100 + i)]);
    }
    await asUser(owner, (c) => save(c, m.id, 2, "trigger prune"));
    const counts = (await pool.query("select kind, count(*)::int n from manuscript_versions where manuscript_id = $1 group by kind order by kind", [m.id])).rows;
    expect(counts).toEqual([{ kind: "auto", n: 40 }, { kind: "manual", n: 1 }]);
  });

  it("does not let the owner delete manual versions directly", async () => {
    const { owner, study } = await newStudy();
    const m = await newManuscript(owner, study);
    await asUser(owner, (c) => save(c, m.id, 1, "keep me", true, "Milestone"));
    await asUser(owner, (c) => c.query("delete from manuscript_versions where manuscript_id = $1", [m.id]));
    expect((await pool.query("select 1 from manuscript_versions where manuscript_id = $1", [m.id])).rowCount).toBe(1);
  });

  it("rolls back everything when the content is too large", async () => {
    const { owner, study } = await newStudy();
    const m = await newManuscript(owner, study);
    const big = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: Array.from({ length: 400000 }, (_, i) => `w${i * 7919}`).join(" ") }] }] });
    await expect(asUser(owner, (c) => c.query("select public.save_manuscript($1, 1, 'T', $2::jsonb, 1)", [m.id, big]))).rejects.toThrow(/content_size/);
    expect((await pool.query("select revision from manuscripts where id = $1", [m.id])).rows[0].revision).toBe(1);
    expect((await pool.query("select 1 from manuscript_versions where manuscript_id = $1", [m.id])).rowCount).toBe(0);
  });
});

describe("restore_manuscript_version", () => {
  it("restores old text and keeps the current text as a restore point", async () => {
    const { owner, study } = await newStudy();
    const m = await newManuscript(owner, study);
    await asUser(owner, (c) => save(c, m.id, 1, "first draft", true, "First"));
    await asUser(owner, (c) => save(c, m.id, 2, "second draft"));
    const first = (await pool.query("select id from manuscript_versions where manuscript_id = $1 and label = 'First'", [m.id])).rows[0].id;
    const r = (await asUser(owner, (c) => c.query("select public.restore_manuscript_version($1, 3) as r", [first]))).rows[0].r;
    expect(r.revision).toBe(4);
    expect(r.content.content[0].content[0].text).toBe("first draft");
    expect((await pool.query("select content from manuscripts where id = $1", [m.id])).rows[0].content.content[0].content[0].text).toBe("first draft");
    const kept = (await pool.query("select content from manuscript_versions where manuscript_id = $1 and kind = 'restore'", [m.id])).rows;
    expect(kept).toHaveLength(1);
    expect(kept[0].content.content[0].content[0].text).toBe("second draft");
  });

  it("refuses a stale revision and a stranger", async () => {
    const { owner, study } = await newStudy();
    const m = await newManuscript(owner, study);
    await asUser(owner, (c) => save(c, m.id, 1, "a", true, "A"));
    const v = (await pool.query("select id from manuscript_versions where manuscript_id = $1", [m.id])).rows[0].id;
    await expect(asUser(owner, (c) => c.query("select public.restore_manuscript_version($1, 1)", [v]))).rejects.toThrow(/revision_conflict/);
    const stranger = await newUser();
    await expect(asUser(stranger, (c) => c.query("select public.restore_manuscript_version($1, 2)", [v]))).rejects.toThrow(/version_not_found/);
  });
});

const insertPdf = (c: PoolClient, over: Record<string, unknown> = {}) => {
  const id = (over.id as string) ?? randomUUID();
  return c.query(
    `insert into pdf_documents (id, title, original_filename, storage_path, file_size, sha256, page_count, status, study_id, reference_id)
     values ($1, $2, 'a.pdf', $3, $4, $5, 3, 'ready', $6, $7) returning id`,
    [id, over.title ?? "Paper", over.path ?? `${randomUUID()}/${id}.pdf`, over.size ?? 1000, over.sha ?? null, over.study ?? null, over.ref ?? null],
  );
};
const sha = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

describe("pdf_documents", () => {
  it("is private to its owner", async () => {
    const a = await newUser(), b = await newUser();
    await asUser(a, (c) => insertPdf(c));
    expect((await asUser(a, (c) => c.query("select id from pdf_documents"))).rowCount).toBe(1);
    expect((await asUser(b, (c) => c.query("select id from pdf_documents"))).rowCount).toBe(0);
    await expect(asUser(b, (c) => c.query("insert into pdf_documents (owner_id, title, original_filename, storage_path, file_size, status) values ($1, 'x', 'x.pdf', 'p', 10, 'ready')", [a]))).rejects.toThrow(/row-level security/);
  });

  it("rejects over-size files, bad hashes and bad status", async () => {
    const a = await newUser();
    await expect(asUser(a, (c) => insertPdf(c, { size: 20971521 }))).rejects.toThrow(/check/);
    await expect(asUser(a, (c) => insertPdf(c, { size: 0 }))).rejects.toThrow(/check/);
    await expect(asUser(a, (c) => insertPdf(c, { sha: "nothex" }))).rejects.toThrow(/check/);
    await expect(asUser(a, (c) => c.query("insert into pdf_documents (title, original_filename, storage_path, file_size, status) values ('x', 'x.pdf', 'p2', 10, 'weird')"))).rejects.toThrow(/check/);
  });

  it("blocks the same file twice for one user but not across users", async () => {
    const a = await newUser(), b = await newUser(), h = sha();
    await asUser(a, (c) => insertPdf(c, { sha: h }));
    await expect(asUser(a, (c) => insertPdf(c, { sha: h }))).rejects.toThrow(/owner_hash/);
    await asUser(b, (c) => insertPdf(c, { sha: h }));
  });

  it("enforces the 100 MB library quota", async () => {
    const a = await newUser();
    for (let i = 0; i < 5; i++) await asUser(a, (c) => insertPdf(c, { size: 20971520 }));
    await expect(asUser(a, (c) => insertPdf(c, { size: 1 }))).rejects.toThrow(/pdf_quota_exceeded/);
    const other = await newUser();
    await asUser(other, (c) => insertPdf(c, { size: 20971520 }));
  });

  it("enforces the 100 file cap", async () => {
    const a = await newUser();
    await asUser(a, async (c) => { for (let i = 0; i < 100; i++) await insertPdf(c, { size: 10 }); });
    await expect(asUser(a, (c) => insertPdf(c, { size: 10 }))).rejects.toThrow(/pdf_library_full/);
  });

  it("only links to the owner's own study and references", async () => {
    const a = await newStudy(), b = await newStudy();
    await asUser(a.owner, (c) => insertPdf(c, { study: a.study }));
    await expect(asUser(a.owner, (c) => insertPdf(c, { study: b.study }))).rejects.toThrow(/pdf_link_forbidden/);
    const ref = (await pool.query("insert into study_references (study_id, identifier_type, title, authors) values ($1, 'manual', 'R', '{}') returning id", [b.study])).rows[0].id;
    await expect(asUser(a.owner, (c) => insertPdf(c, { ref }))).rejects.toThrow(/pdf_link_forbidden/);
    const mine = (await pool.query("insert into study_references (study_id, identifier_type, title, authors) values ($1, 'manual', 'R', '{}') returning id", [a.study])).rows[0].id;
    await asUser(a.owner, (c) => insertPdf(c, { ref: mine }));
    // A re-link on update is checked too.
    const d = (await asUser(a.owner, (c) => insertPdf(c))).rows[0].id;
    await expect(asUser(a.owner, (c) => c.query("update pdf_documents set study_id = $2 where id = $1", [d, b.study]))).rejects.toThrow(/pdf_link_forbidden/);
  });

  it("keeps the PDF when its study or reference is deleted", async () => {
    const a = await newStudy();
    const ref = (await pool.query("insert into study_references (study_id, identifier_type, title, authors) values ($1, 'manual', 'R', '{}') returning id", [a.study])).rows[0].id;
    const id = (await asUser(a.owner, (c) => insertPdf(c, { study: a.study, ref }))).rows[0].id;
    await pool.query("delete from study_references where id = $1", [ref]);
    await pool.query("delete from studies where id = $1", [a.study]);
    const r = (await pool.query("select study_id, reference_id from pdf_documents where id = $1", [id])).rows[0];
    expect(r).toEqual({ study_id: null, reference_id: null });
  });
});

async function addChunks(owner: string, id: string, rows: { page: number; idx: number; text: string }[]) {
  await asUser(owner, async (c) => { for (const r of rows) await c.query("insert into pdf_chunks (document_id, page, idx, text) values ($1, $2, $3, $4)", [id, r.page, r.idx, r.text]); });
}

describe("pdf_chunks and search", () => {
  it("only the owner can write or read chunks", async () => {
    const a = await newUser(), b = await newUser();
    const id = (await asUser(a, (c) => insertPdf(c))).rows[0].id;
    await addChunks(a, id, [{ page: 1, idx: 0, text: "Malaria prevalence was 12 percent." }]);
    expect((await asUser(b, (c) => c.query("select id from pdf_chunks"))).rowCount).toBe(0);
    await expect(asUser(b, (c) => c.query("insert into pdf_chunks (document_id, page, idx, text) values ($1, 1, 5, 'x')", [id]))).rejects.toThrow(/row-level security/);
  });

  it("finds passages by natural-language question and reports the page", async () => {
    const a = await newUser();
    const id = (await asUser(a, (c) => insertPdf(c))).rows[0].id;
    await addChunks(a, id, [
      { page: 1, idx: 0, text: "Background. Retinopathy of prematurity is a leading cause of childhood blindness." },
      { page: 4, idx: 0, text: "Results. Among 300 infants the prevalence of retinopathy of prematurity was 18 percent." },
      { page: 5, idx: 0, text: "Methods for statistical analysis used logistic regression." },
    ]);
    const r = (await asUser(a, (c) => c.query("select * from search_pdf_chunks('What was the prevalence of retinopathy?', null, 5)"))).rows;
    expect(r.length).toBe(2);
    expect(r[0].page).toBe(4);
    expect(r[0].headline).toContain("[[");
  });

  it("never returns another user's passages, even when asked for their document id", async () => {
    const a = await newUser(), b = await newUser();
    const id = (await asUser(a, (c) => insertPdf(c))).rows[0].id;
    await addChunks(a, id, [{ page: 1, idx: 0, text: "Confidential trial results for the cohort." }]);
    const r = await asUser(b, (c) => c.query("select * from search_pdf_chunks('cohort results', $1::uuid[], 10)", [[id]]));
    expect(r.rowCount).toBe(0);
  });

  it("restricts to the chosen documents and handles empty or stop-word-only queries", async () => {
    const a = await newUser();
    const d1 = (await asUser(a, (c) => insertPdf(c))).rows[0].id;
    const d2 = (await asUser(a, (c) => insertPdf(c))).rows[0].id;
    await addChunks(a, d1, [{ page: 1, idx: 0, text: "Sepsis mortality fell after the intervention." }]);
    await addChunks(a, d2, [{ page: 2, idx: 0, text: "Sepsis incidence was unchanged." }]);
    expect((await asUser(a, (c) => c.query("select document_id from search_pdf_chunks('sepsis', $1::uuid[], 10)", [[d2]]))).rows).toEqual([{ document_id: d2 }]);
    expect((await asUser(a, (c) => c.query("select 1 from search_pdf_chunks('', null, 10)"))).rowCount).toBe(0);
    expect((await asUser(a, (c) => c.query("select 1 from search_pdf_chunks('the and of', null, 10)"))).rowCount).toBe(0);
  });

  it("is safe against query syntax in the question", async () => {
    const a = await newUser();
    const id = (await asUser(a, (c) => insertPdf(c))).rows[0].id;
    await addChunks(a, id, [{ page: 1, idx: 0, text: "Dose response was linear." }]);
    for (const q of ["dose'; drop table pdf_chunks; --", "dose & | ! ( ) :*", "\"dose response\" -linear", "<->"]) {
      await asUser(a, (c) => c.query("select * from search_pdf_chunks($1, null, 5)", [q]));
    }
    expect((await pool.query("select count(*)::int n from pdf_chunks")).rows[0].n).toBeGreaterThan(0);
  });

  it("rejects empty and oversize passages and deletes chunks with the document", async () => {
    const a = await newUser();
    const id = (await asUser(a, (c) => insertPdf(c))).rows[0].id;
    await expect(addChunks(a, id, [{ page: 1, idx: 0, text: "" }])).rejects.toThrow(/check/);
    await expect(addChunks(a, id, [{ page: 1, idx: 0, text: "x".repeat(6001) }])).rejects.toThrow(/check/);
    await expect(addChunks(a, id, [{ page: 0, idx: 0, text: "x" }])).rejects.toThrow(/check/);
    await addChunks(a, id, [{ page: 1, idx: 0, text: "kept" }]);
    await asUser(a, (c) => c.query("delete from pdf_documents where id = $1", [id]));
    expect((await pool.query("select 1 from pdf_chunks where document_id = $1", [id])).rowCount).toBe(0);
  });
});

describe("pdf_annotations", () => {
  it("lets the owner annotate, requires a quote or a note, and hides them from others", async () => {
    const a = await newUser(), b = await newUser();
    const id = (await asUser(a, (c) => insertPdf(c))).rows[0].id;
    await asUser(a, (c) => c.query("insert into pdf_annotations (document_id, page, quote, note) values ($1, 2, 'a passage', 'check this')", [id]));
    await expect(asUser(a, (c) => c.query("insert into pdf_annotations (document_id, page) values ($1, 2)", [id]))).rejects.toThrow(/check/);
    await expect(asUser(a, (c) => c.query("insert into pdf_annotations (document_id, page, note, color) values ($1, 2, 'n', 'red')", [id]))).rejects.toThrow(/check/);
    expect((await asUser(b, (c) => c.query("select id from pdf_annotations"))).rowCount).toBe(0);
    await expect(asUser(b, (c) => c.query("insert into pdf_annotations (document_id, page, note) values ($1, 1, 'x')", [id]))).rejects.toThrow(/row-level security/);
  });
});

describe("storage bucket and policies", () => {
  it("creates a private PDF-only bucket with a 20 MB limit", async () => {
    const b = (await pool.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'research-pdfs'")).rows[0];
    expect(b).toEqual({ public: false, file_size_limit: "20971520", allowed_mime_types: ["application/pdf"] });
  });

  it("limits each user to their own folder", async () => {
    const a = await newUser(), b = await newUser();
    const put = (u: string, folder: string) => asUser(u, (c) => c.query("insert into storage.objects (bucket_id, name, metadata) values ('research-pdfs', $1, '{\"size\": 1000}')", [`${folder}/${randomUUID()}.pdf`]));
    await put(a, a);
    await expect(put(a, b)).rejects.toThrow(/row-level security/);
    expect((await asUser(b, (c) => c.query("select name from storage.objects where bucket_id = 'research-pdfs'"))).rowCount).toBe(0);
    expect((await asUser(a, (c) => c.query("select name from storage.objects where bucket_id = 'research-pdfs'"))).rowCount).toBe(1);
    await asUser(a, (c) => c.query("delete from storage.objects where bucket_id = 'research-pdfs'"));
    expect((await pool.query("select 1 from storage.objects where bucket_id = 'research-pdfs'")).rowCount).toBe(0);
  });

  it("stops uploads once the user has used 100 MB", async () => {
    const a = await newUser();
    const put = (size: number) => asUser(a, (c) => c.query("insert into storage.objects (bucket_id, name, metadata) values ('research-pdfs', $1, $2::jsonb)", [`${a}/${randomUUID()}.pdf`, JSON.stringify({ size })]));
    await put(60_000_000);
    await put(44_857_600);
    await expect(put(10)).rejects.toThrow(/row-level security/);
  });
});

describe("ai features", () => {
  it("registers pdf_qa and pdf_compare", async () => {
    const r = (await pool.query("select feature_key, enabled from ai_features where feature_key in ('pdf_qa', 'pdf_compare') order by 1")).rows;
    expect(r).toEqual([{ feature_key: "pdf_compare", enabled: true }, { feature_key: "pdf_qa", enabled: true }]);
  });
});

describe("manuscript figure storage", () => {
  const put = (u: string, name: string, size = 1000) => asUser(u, (c) => c.query("insert into storage.objects (bucket_id, name, metadata) values ('manuscript-figures', $1, $2::jsonb)", [name, JSON.stringify({ size })]));
  it("creates a private image bucket with a 5 MB limit", async () => {
    const b = (await pool.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'manuscript-figures'")).rows[0];
    expect(b).toEqual({ public: false, file_size_limit: "5242880", allowed_mime_types: ["image/png", "image/jpeg", "image/gif"] });
  });
  it("lets only the manuscript owner upload under their own folder and that manuscript", async () => {
    const a = await newStudy(), other = await newStudy();
    const m = await newManuscript(a.owner, a.study);
    const otherM = await newManuscript(other.owner, other.study);
    const name = (u: string, ms: string) => `${u}/${ms}/${randomUUID()}.png`;
    await put(a.owner, name(a.owner, m.id));
    await expect(put(a.owner, name(a.owner, otherM.id))).rejects.toThrow(/row-level security/); // someone else's manuscript
    await expect(put(a.owner, name(other.owner, m.id))).rejects.toThrow(/row-level security/); // someone else's folder
    await expect(put(a.owner, `${a.owner}/not-a-uuid/${randomUUID()}.png`)).rejects.toThrow(/row-level security/);
    await expect(put(a.owner, `${a.owner}/${randomUUID()}/${randomUUID()}.png`)).rejects.toThrow(/row-level security/); // no such manuscript
  });
  it("shows figures to an attached supervisor and to nobody else", async () => {
    const a = await newStudy();
    const m = await newManuscript(a.owner, a.study);
    await put(a.owner, `${a.owner}/${m.id}/${randomUUID()}.png`);
    const sup = await newUser("supervisor");
    const stranger = await newUser();
    const ws = (await pool.query("select id from workspaces where supervisor_id = $1", [sup])).rows[0]?.id ?? (await pool.query("insert into workspaces (supervisor_id, name) values ($1, 'W') returning id", [sup])).rows[0].id;
    await pool.query("insert into study_supervisors (study_id, supervisor_id, workspace_id) values ($1, $2, $3)", [a.study, sup, ws]);
    const names = (u: string) => asUser(u, (c) => c.query("select name from storage.objects where bucket_id = 'manuscript-figures'"));
    expect((await names(sup)).rowCount).toBe(1);
    expect((await names(stranger)).rowCount).toBe(0);
    await expect(put(sup, `${sup}/${m.id}/${randomUUID()}.png`)).rejects.toThrow(/row-level security/);
  });
  it("stops uploads at 50 MB per user", async () => {
    const a = await newStudy();
    const m = await newManuscript(a.owner, a.study);
    const n = () => `${a.owner}/${m.id}/${randomUUID()}.png`;
    await put(a.owner, n(), 30_000_000);
    await put(a.owner, n(), 22_428_800);
    await expect(put(a.owner, n(), 10)).rejects.toThrow(/row-level security/);
  });
});

describe("assistant migration", () => {
  it("registers three tiers with escalating limits and model chains", async () => {
    const r = (await pool.query("select feature_key, model_chain, max_output_tokens, max_input_chars, max_iterations, max_tool_calls, max_op_cost_micro_usd from ai_features where feature_key like 'assistant_%' order by max_op_cost_micro_usd")).rows;
    expect(r.map((x) => x.feature_key)).toEqual(["assistant_light", "assistant_standard", "assistant_deep"]);
    expect(r[0].model_chain[0]).toBe("claude-haiku-5-5");
    expect(r[1].model_chain[0]).toBe("claude-sonnet-5-5");
    expect(r[2].model_chain[0]).toBe("claude-opus-5-5");
    for (let i = 1; i < 3; i++) for (const k of ["max_output_tokens", "max_input_chars", "max_iterations", "max_tool_calls", "max_op_cost_micro_usd"]) expect(Number(r[i][k])).toBeGreaterThan(Number(r[i - 1][k]));
    for (const x of r) expect(x.max_iterations).toBeLessThanOrEqual(8);
  });
  it("registers the request-limit settings", async () => {
    const r = (await pool.query("select key from ai_settings where key like 'assistant_%'")).rows.map((x) => x.key);
    expect(r).toEqual(expect.arrayContaining(["assistant_daily_requests_per_user", "assistant_max_message_chars", "assistant_max_document_chars", "assistant_max_tool_output_chars", "assistant_deep_requires_pro"]));
  });
  it("keeps conversations private and read-only for users; only the server can write messages", async () => {
    const a = await newUser(), b = await newUser();
    const t = (await pool.query("insert into assistant_threads (owner_id, title) values ($1, 'Q') returning id", [a])).rows[0].id;
    await pool.query("insert into assistant_messages (thread_id, owner_id, role, content) values ($1, $2, 'user', '{\"text\":\"hi\"}')", [t, a]);
    expect((await asUser(a, (c) => c.query("select id from assistant_messages"))).rowCount).toBe(1);
    expect((await asUser(b, (c) => c.query("select id from assistant_messages"))).rowCount).toBe(0);
    expect((await asUser(b, (c) => c.query("select id from assistant_threads"))).rowCount).toBe(0);
    await expect(asUser(a, (c) => c.query("insert into assistant_messages (thread_id, owner_id, role, content) values ($1, $2, 'assistant', '{}')", [t, a]))).rejects.toThrow(/row-level security/);
    await expect(asUser(a, (c) => c.query("insert into assistant_threads (owner_id, title) values ($1, 'x')", [a]))).rejects.toThrow(/row-level security/);
    await expect(asUser(a, (c) => c.query("update assistant_messages set content = '{}'::jsonb"))).resolves.toMatchObject({ rowCount: 0 });
    await asUser(b, (c) => c.query("delete from assistant_threads where id = $1", [t]));
    expect((await pool.query("select 1 from assistant_threads where id = $1", [t])).rowCount).toBe(1);
    await asUser(a, (c) => c.query("delete from assistant_threads where id = $1", [t]));
    expect((await pool.query("select 1 from assistant_messages where thread_id = $1", [t])).rowCount).toBe(0);
  });
  it("validates roles, tiers, titles and size", async () => {
    const a = await newUser();
    const t = (await pool.query("insert into assistant_threads (owner_id, title) values ($1, 'Q') returning id", [a])).rows[0].id;
    await expect(pool.query("insert into assistant_messages (thread_id, owner_id, role, content) values ($1, $2, 'system', '{}')", [t, a])).rejects.toThrow(/check/);
    await expect(pool.query("insert into assistant_messages (thread_id, owner_id, role, tier, content) values ($1, $2, 'assistant', 'huge', '{}')", [t, a])).rejects.toThrow(/check/);
    await expect(pool.query("insert into assistant_threads (owner_id, title) values ($1, '  ')", [a])).rejects.toThrow(/check/);
    await expect(pool.query("insert into assistant_threads (owner_id, title) values ($1, $2)", [a, "x".repeat(201)])).rejects.toThrow(/check/);
    const big = JSON.stringify({ text: Array.from({ length: 30000 }, (_, i) => `w${i * 7919}`).join(" ") });
    await expect(pool.query("insert into assistant_messages (thread_id, owner_id, role, content) values ($1, $2, 'user', $3::jsonb)", [t, a, big])).rejects.toThrow(/content_size/);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Op = { table: string; kind: "insert" | "update" | "delete"; payload?: unknown; filters: [string, string, unknown][] };
const S: { profile: { id: string; role: string | null } | null; tables: Record<string, Row[]>; ops: Op[]; error: string | null } = { profile: null, tables: {}, ops: [], error: null };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/profile", () => ({ getCurrentProfile: async () => S.profile }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain = (kind: Op["kind"] | "select", payload?: unknown) => {
        const op: Op = { table, kind: kind as Op["kind"], payload, filters: [] };
        const c: Record<string, unknown> = {};
        for (const m of ["eq", "in"]) c[m] = (col: string, v: unknown) => { op.filters.push([m, col, v]); return c; };
        c.select = () => c;
        c.order = () => c;
        let recorded = false;
        c.single = async () => { done(); return { data: { id: "new-id" }, error: S.error ? { message: S.error } : null }; };
        const done = () => { if (recorded) return { data: null, error: null, count: 0 }; recorded = true; return doneInner(); };
        const doneInner = () => { if (kind !== "select") S.ops.push(op); return { data: kind === "select" ? (S.tables[table] ?? []).filter((r) => op.filters.every(([m, col, v]) => (m === "eq" ? r[col] === v : (v as unknown[]).includes(r[col])))) : null, error: S.error ? { message: S.error } : null, count: Array.isArray(op.filters.find((f) => f[0] === "in")?.[2]) ? (op.filters.find((f) => f[0] === "in")![2] as unknown[]).length : 1 }; };
        c.then = (res: (v: unknown) => unknown) => res(done());
        return c;
      };
      return { select: () => chain("select"), insert: (p: unknown) => chain("insert", p), update: (p: unknown) => chain("update", p), delete: () => chain("delete") };
    },
  }),
}));

import { addTagsToReferences, assignCollection, createCollection, deleteCollection, deleteReferences, importReferences, mergeReferences, renameCollection, updateReference } from "../actions";

const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222", U3 = "33333333-3333-4333-8333-333333333333";
const row = (o: Row = {}): Row => ({ id: U1, study_id: "s1", title: "Existing", authors: ["Smith JA"], doi: null, pmid: null, journal: null, year: 2020, volume: null, issue: null, pages: null, tags: [], display_order: 3, source: "crossref", ...o });
const ref = (title: string, o: Row = {}) => ({ ref: { type: "article-journal" as const, title, authors: [{ family: "Smith", given: "J." }], year: 2021, ...o } });

beforeEach(() => { S.profile = { id: "u", role: "student" }; S.tables = { study_references: [row()] }; S.ops = []; S.error = null; });

describe("importReferences", () => {
  it("inserts new references in one batch, tagged as imported, appending after the existing order", async () => {
    const r = await importReferences("s1", [{ ...ref("Alpha paper about X"), tags: [" a ", "A", "b"] }, ref("Beta paper about Y", { year: 2019 })], "import", null);
    expect(r).toEqual({ saved: 2, skipped: 0, invalid: 0 });
    const op = S.ops[0];
    expect(op.kind).toBe("insert");
    const rows = op.payload as Row[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ study_id: "s1", source: "import", title: "Alpha paper about X", display_order: 4, tags: ["a", "b"], collection_id: null });
    expect(rows[1].display_order).toBe(5);
  });
  it("skips duplicates of existing references and repeats within the file, and counts untitled ones as invalid", async () => {
    S.tables.study_references = [row({ doi: "10.1000/dup" })];
    const r = await importReferences("s1", [ref("Different title", { doi: "10.1000/DUP" }), ref("Fresh one"), ref("Fresh one"), ref("   ")], "zotero");
    expect(r).toEqual({ saved: 1, skipped: 2, invalid: 1 });
    expect((S.ops[0].payload as Row[])[0].source).toBe("zotero");
  });
  it("does not write when everything is a duplicate", async () => {
    const r = await importReferences("s1", [ref("Existing", { year: 2020 })], "import");
    expect(r.saved).toBe(0);
    expect(S.ops).toHaveLength(0);
  });
  it("splits large imports into batches of 100", async () => {
    // Different first authors, as in a real import; near-identical titles by one author in one year would rightly be flagged.
    const items = Array.from({ length: 250 }, (_, i) => ref(`Study ${i} of topic ${i * 7}`, { authors: [{ family: `Author${i}` }], year: 1900 + (i % 100) }));
    const r = await importReferences("s1", items, "import");
    expect(r.saved).toBe(250);
    expect(S.ops.map((o) => (o.payload as Row[]).length)).toEqual([100, 100, 50]);
  });
  it("validates access, size and the collection", async () => {
    S.profile = null;
    expect((await importReferences("s1", [ref("A")], "import")).error).toMatch(/Sign in/);
    S.profile = { id: "u", role: "supervisor" };
    expect((await importReferences("s1", [ref("A")], "import")).error).toMatch(/Only the student/);
    S.profile = { id: "u", role: "student" };
    expect((await importReferences("s1", [], "import")).error).toMatch(/nothing to import/);
    expect((await importReferences("s1", Array.from({ length: 501 }, () => ref("A")), "import")).error).toMatch(/at most 500/);
    expect((await importReferences("s1", [ref("A")], "import", "not-a-uuid")).error).toMatch(/Unknown collection/);
    expect(S.ops).toHaveLength(0);
  });
  it("surfaces database errors", async () => {
    S.error = "row-level security";
    expect((await importReferences("s1", [ref("A")], "import")).error).toBe("row-level security");
  });
});

describe("updateReference", () => {
  it("validates, then updates only that reference within the study", async () => {
    expect((await updateReference("s1", U1, { title: "Edited" })).error).toBeUndefined();
    expect(S.ops[0]).toMatchObject({ kind: "update", table: "study_references" });
    expect(S.ops[0].filters).toEqual([["eq", "id", U1], ["eq", "study_id", "s1"]]);
    expect(S.ops[0].payload).toMatchObject({ title: "Edited" });
  });
  it("rejects invalid ids and edits without touching the database", async () => {
    expect((await updateReference("s1", "bad", { title: "x" })).error).toMatch(/Unknown reference/);
    expect((await updateReference("s1", U1, { doi: "nope" })).error).toMatch(/DOI/);
    expect(S.ops).toHaveLength(0);
  });
});

describe("deleteReferences", () => {
  it("deletes selected references within the study only", async () => {
    const r = await deleteReferences("s1", [U1, U2]);
    expect(r.deleted).toBe(2);
    expect(S.ops[0].filters).toContainEqual(["in", "id", [U1, U2]]);
    expect(S.ops[0].filters).toContainEqual(["eq", "study_id", "s1"]);
  });
  it("rejects empty, oversized and malformed selections", async () => {
    expect((await deleteReferences("s1", [])).error).toBeDefined();
    expect((await deleteReferences("s1", ["x"])).error).toBeDefined();
    expect((await deleteReferences("s1", Array.from({ length: 201 }, () => U1))).error).toBeDefined();
    expect(S.ops).toHaveLength(0);
  });
});

describe("collections and tags", () => {
  it("creates, renames and deletes collections, mapping duplicate names to a clear message", async () => {
    expect((await createCollection("s1", "  Chapter 2 ")).id).toBe("new-id");
    expect(S.ops[0].payload).toEqual({ study_id: "s1", name: "Chapter 2" });
    expect((await createCollection("s1", "")).error).toMatch(/1 to 80/);
    S.error = 'duplicate key value violates unique constraint "reference_collections_study_id_name_key"';
    expect((await createCollection("s1", "Dup")).error).toMatch(/already exists/);
    expect((await renameCollection("s1", U1, "Dup")).error).toMatch(/already exists/);
    S.error = null; S.ops = [];
    expect((await renameCollection("s1", U1, "New name")).error).toBeUndefined();
    expect((await deleteCollection("s1", U1)).error).toBeUndefined();
    expect((await deleteCollection("s1", "bad")).error).toMatch(/Unknown collection/);
    expect(S.ops.map((o) => o.kind)).toEqual(["update", "delete"]);
  });
  it("assigns references to a collection or to none", async () => {
    expect((await assignCollection("s1", [U1], U2)).error).toBeUndefined();
    expect(S.ops[0].payload).toMatchObject({ collection_id: U2 });
    expect((await assignCollection("s1", [U1], null)).error).toBeUndefined();
    expect(S.ops[1].payload).toMatchObject({ collection_id: null });
    expect((await assignCollection("s1", [U1], "bad")).error).toMatch(/Unknown collection/);
  });
  it("adds tags while keeping the existing ones", async () => {
    S.tables.study_references = [row({ id: U1, tags: ["old"] }), row({ id: U2, tags: [] })];
    expect((await addTagsToReferences("s1", [U1, U2], ["New", "old"])).error).toBeUndefined();
    const updates = S.ops.filter((o) => o.kind === "update");
    expect(updates[0].payload).toMatchObject({ tags: ["old", "New"] });
    expect(updates[1].payload).toMatchObject({ tags: ["New", "old"] });
    expect((await addTagsToReferences("s1", [U1], [" "])).error).toMatch(/at least one tag/);
  });
});

describe("mergeReferences", () => {
  beforeEach(() => {
    S.tables.study_references = [
      row({ id: U1, title: "Kept title", doi: null, volume: "1", tags: ["a"], source: "import" }),
      row({ id: U2, title: "Kept title variant", doi: "10.1000/x", volume: "99", pmid: "7", tags: ["b"] }),
    ];
  });
  it("fills blanks of the kept reference, combines tags, then removes the duplicates", async () => {
    expect((await mergeReferences("s1", U1, [U2])).error).toBeUndefined();
    const [upd, del] = S.ops;
    expect(upd.kind).toBe("update");
    expect(upd.payload).toMatchObject({ title: "Kept title", volume: "1", doi: "10.1000/x", pmid: "7", tags: ["a", "b"], source: "import" });
    expect(upd.filters).toContainEqual(["eq", "id", U1]);
    expect(del.kind).toBe("delete");
    expect(del.filters).toContainEqual(["in", "id", [U2]]);
  });
  it("rejects bad selections and references from other studies without changing anything", async () => {
    expect((await mergeReferences("s1", U1, [U1])).error).toMatch(/Choose one/);
    expect((await mergeReferences("s1", U1, [])).error).toMatch(/Choose one/);
    expect((await mergeReferences("s1", U1, [U3])).error).toMatch(/not found/);
    expect(S.ops).toHaveLength(0);
  });
});

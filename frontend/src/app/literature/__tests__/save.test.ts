import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Work } from "@/lib/literature/types";

type Row = Record<string, unknown>;
const state: { profile: { id: string; role: string | null } | null; existing: Row[]; inserted: Row[]; insertError: string | null; readError: string | null; verified: Record<string, Work | null | Error> } = {
  profile: null, existing: [], inserted: [], insertError: null, readError: null, verified: {},
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/profile", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => { const c: Record<string, unknown> = {}; c.eq = () => c; c.order = () => c; c.then = (r: (v: unknown) => unknown) => r({ data: state.existing, error: state.readError ? { message: state.readError } : null }); return c; },
      insert: async (row: Row) => { if (state.insertError) return { error: { message: state.insertError } }; state.inserted.push(row); return { error: null }; },
    }),
  }),
}));
vi.mock("@/lib/literature/search", () => ({
  fetchVerifiedWork: async (ref: { doi?: string; pmid?: string; openalexId?: string }) => {
    const key = ref.doi ?? ref.pmid ?? ref.openalexId ?? "";
    const v = state.verified[key];
    if (v instanceof Error) throw v;
    return v ?? null;
  },
}));

import { saveWorksToStudy } from "../actions";
import { LiteratureError } from "@/lib/literature/types";

const W = (over: Partial<Work> = {}): Work => ({ id: "crossref:10.1000/a", source: "crossref", type: "article-journal", title: "Vitamin A supplementation and child mortality", authors: [{ family: "Smith", given: "John A." }], journal: "The Lancet", year: 2020, doi: "10.1000/a", ...over });

beforeEach(() => {
  state.profile = { id: "u1", role: "student" };
  state.existing = []; state.inserted = []; state.insertError = null; state.readError = null;
  state.verified = { "10.1000/a": W(), "10.1000/b": W({ id: "crossref:10.1000/b", doi: "10.1000/b", title: "Malaria in pregnancy", year: 2018, authors: [{ family: "Jones", given: "B." }] }) };
});

describe("saveWorksToStudy", () => {
  it("saves records fetched from the source, not whatever the browser sent", async () => {
    const r = await saveWorksToStudy("s1", [{ doi: "10.1000/a", title: "A FAKE TITLE FROM THE BROWSER" }]);
    expect(r).toMatchObject({ saved: 1, skipped: [], failed: [] });
    const row = state.inserted[0];
    expect(row.title).toBe("Vitamin A supplementation and child mortality");
    expect(row).toMatchObject({ study_id: "s1", source: "crossref", doi: "10.1000/a", identifier_type: "doi", display_order: 0, work_type: "article-journal" });
    expect(row.authors).toEqual(["Smith JA"]);
    expect(row.author_details).toEqual([{ family: "Smith", given: "John A." }]);
  });
  it("stores open-access information only when the source reported it", async () => {
    state.verified["10.1000/a"] = W({ source: "openalex", id: "openalex:W1", openalexId: "W1", openAccess: { isOa: true, url: "https://example.org/free" } });
    await saveWorksToStudy("s1", [{ doi: "10.1000/a" }]);
    expect(state.inserted[0]).toMatchObject({ is_open_access: true, open_access_url: "https://example.org/free", openalex_id: "W1" });
    state.inserted = [];
    state.verified["10.1000/b"] = W({ doi: "10.1000/b", title: "Other work entirely", openAccess: { isOa: false } });
    await saveWorksToStudy("s1", [{ doi: "10.1000/b" }]);
    expect(state.inserted[0]).toMatchObject({ is_open_access: false, open_access_url: null });
    state.inserted = [];
    state.verified["10.1000/a"] = W({ openAccess: undefined });
    await saveWorksToStudy("s1", [{ doi: "10.1000/a" }]);
    expect(state.inserted[0].is_open_access).toBeNull();
  });
  it("skips records already in the study, matching by DOI or by title, and appends after existing order", async () => {
    state.existing = [{ title: "Already here", authors: ["Smith JA"], doi: "10.1000/A", pmid: null, journal: null, year: 2020, volume: null, issue: null, pages: null, display_order: 4 }];
    const r = await saveWorksToStudy("s1", [{ doi: "10.1000/a" }, { doi: "10.1000/b" }]);
    expect(r.saved).toBe(1);
    expect(r.skipped).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({ doi: "10.1000/b", display_order: 5 });
  });
  it("does not save the same record twice in one batch", async () => {
    const r = await saveWorksToStudy("s1", [{ doi: "10.1000/a" }, { doi: "10.1000/a" }]);
    expect(r.saved).toBe(1);
    expect(r.skipped).toHaveLength(1);
  });
  it("reports records no source can verify instead of saving a guess", async () => {
    const r = await saveWorksToStudy("s1", [{ doi: "10.1000/unknown", title: "Mystery paper" }]);
    expect(r.saved).toBe(0);
    expect(r.failed[0]).toMatchObject({ title: "Mystery paper", reason: expect.stringMatching(/No source returned this record/) });
    expect(state.inserted).toHaveLength(0);
  });
  it("stops the batch on a rate limit and reports what happened", async () => {
    state.verified["10.1000/b"] = new LiteratureError("Crossref is limiting requests right now.", 429, 60);
    const r = await saveWorksToStudy("s1", [{ doi: "10.1000/a" }, { doi: "10.1000/b" }, { doi: "10.1000/a2" }]);
    expect(r.saved).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].reason).toMatch(/limiting requests/);
  });
  it("keeps going after a non-rate-limit failure", async () => {
    state.verified["10.1000/a"] = new LiteratureError("Crossref returned an error (500).", 502);
    const r = await saveWorksToStudy("s1", [{ doi: "10.1000/a" }, { doi: "10.1000/b" }]);
    expect(r.saved).toBe(1);
    expect(r.failed).toHaveLength(1);
  });
  it("requires a signed-in student, a non-empty selection and a sensible batch size", async () => {
    state.profile = null;
    expect((await saveWorksToStudy("s1", [{ doi: "10.1000/a" }])).error).toMatch(/Sign in/);
    state.profile = { id: "u2", role: "supervisor" };
    expect((await saveWorksToStudy("s1", [{ doi: "10.1000/a" }])).error).toMatch(/Only students/);
    state.profile = { id: "u1", role: "student" };
    expect((await saveWorksToStudy("s1", [])).error).toMatch(/at least one/);
    expect((await saveWorksToStudy("s1", Array.from({ length: 26 }, () => ({ doi: "10.1000/a" })))).error).toMatch(/at most 25/);
    expect(state.inserted).toHaveLength(0);
  });
  it("surfaces database errors per record", async () => {
    state.insertError = "row-level security";
    const r = await saveWorksToStudy("s1", [{ doi: "10.1000/a" }]);
    expect(r.saved).toBe(0);
    expect(r.failed[0].reason).toBe("row-level security");
    state.readError = "boom";
    expect((await saveWorksToStudy("s1", [{ doi: "10.1000/a" }])).error).toBe("boom");
  });
});

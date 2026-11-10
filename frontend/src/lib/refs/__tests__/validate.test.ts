import { describe, expect, it } from "vitest";
import { cleanCollectionName, cleanPatch, cleanTags, isUuid } from "../validate";
import { mergeInto } from "../dedupe";

describe("tags and collection names", () => {
  it("trims, drops commas and control characters, de-duplicates ignoring case, and caps length and count", () => {
    expect(cleanTags(["  Vitamin A ", "vitamin a", "a,b", "x".repeat(60), "", 5, null])).toEqual(["Vitamin A", "a b", "x".repeat(40)]);
    expect(cleanTags(Array.from({ length: 50 }, (_, i) => `t${i}`))).toHaveLength(30);
    expect(cleanTags("nope")).toEqual([]);
  });
  it("accepts 1 to 80 character collection names only", () => {
    expect(cleanCollectionName("  Chapter 2  ")).toBe("Chapter 2");
    expect(cleanCollectionName("")).toBeNull();
    expect(cleanCollectionName("   ")).toBeNull();
    expect(cleanCollectionName("x".repeat(81))).toBeNull();
    expect(cleanCollectionName(5)).toBeNull();
  });
  it("recognises UUIDs", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("123")).toBe(false);
    expect(isUuid("../etc")).toBe(false);
  });
});

describe("edit validation", () => {
  it("accepts a valid edit, normalises DOI and pages, and keeps legacy authors in step", () => {
    const r = cleanPatch({ title: " New title ", doi: "https://doi.org/10.1000/ABC", pages: "45-67", year: "2020", authors: [{ family: "Smith", given: "John A." }, { literal: "WHO" }, { family: " " }], tags: ["a", "A"], collection_id: null });
    if (!r.ok) throw new Error(r.error);
    expect(r.fields).toMatchObject({ title: "New title", doi: "10.1000/abc", pages: "45–67", year: 2020, tags: ["a"], collection_id: null, authors: ["Smith JA", "WHO"], author_details: [{ family: "Smith", given: "John A." }, { literal: "WHO" }] });
    expect(typeof r.fields.updated_at).toBe("string");
  });
  it("blanks optional fields without allowing a blank title", () => {
    const r = cleanPatch({ journal: "", abstract: null, doi: "" });
    if (!r.ok) throw new Error(r.error);
    expect(r.fields).toMatchObject({ journal: null, abstract: null, doi: null });
    expect(cleanPatch({ title: "  " })).toEqual({ ok: false, error: "A reference needs a title." });
  });
  it("rejects bad identifiers, links, years, types, collections and oversize text", () => {
    expect(cleanPatch({ doi: "not a doi" })).toMatchObject({ ok: false, error: expect.stringMatching(/DOI/) });
    expect(cleanPatch({ pmid: "12ab" })).toMatchObject({ ok: false, error: expect.stringMatching(/digits/) });
    expect(cleanPatch({ url: "javascript:alert(1)" })).toMatchObject({ ok: false, error: expect.stringMatching(/http/) });
    expect(cleanPatch({ issn: "123" })).toMatchObject({ ok: false });
    expect(cleanPatch({ year: 99 })).toMatchObject({ ok: false });
    expect(cleanPatch({ year: "abc" })).toMatchObject({ ok: false });
    expect(cleanPatch({ work_type: "spaceship" })).toMatchObject({ ok: false });
    expect(cleanPatch({ collection_id: "nope" })).toMatchObject({ ok: false });
    expect(cleanPatch({ abstract: "x".repeat(20001) })).toMatchObject({ ok: false });
    expect(cleanPatch({ title: "x".repeat(501) })).toMatchObject({ ok: false });
    expect(cleanPatch({ authors: Array.from({ length: 101 }, () => ({ family: "A" })) })).toMatchObject({ ok: false });
    expect(cleanPatch({ keywords: "nope" })).toMatchObject({ ok: false });
  });
  it("ignores unknown fields so a request cannot touch other columns", () => {
    const r = cleanPatch({ title: "T", study_id: "other", id: "x", created_at: "2000-01-01", display_order: 9 });
    if (!r.ok) throw new Error(r.error);
    expect(Object.keys(r.fields).sort()).toEqual(["title", "updated_at"]);
    expect(cleanPatch({})).toEqual({ ok: false, error: "Nothing to save." });
    expect(cleanPatch(null)).toEqual({ ok: false, error: "Nothing to save." });
  });
});

describe("merging into a chosen record", () => {
  it("fills only blanks and never changes the kept values", () => {
    const keep = { type: "article-journal" as const, title: "Keep", authors: [], volume: "1", doi: undefined };
    const other = { type: "article-journal" as const, title: "Other", authors: [{ family: "Smith" }], volume: "99", doi: "10.1000/a", pmid: "5", keywords: ["k"] };
    const m = mergeInto(keep, [other]);
    expect(m).toMatchObject({ title: "Keep", volume: "1", doi: "10.1000/a", pmid: "5", keywords: ["k"] });
    expect(m.authors).toEqual([{ family: "Smith" }]);
  });
});

import { describe, expect, it } from "vitest";
import { ZoteroError, fetchZoteroItems, isZoteroKey, zoteroToRef, type ZoteroData } from "../zotero";

const article: ZoteroData = {
  itemType: "journalArticle", title: "Vitamin A supplementation and child mortality",
  creators: [{ creatorType: "author", firstName: "John A.", lastName: "Smith" }, { creatorType: "author", name: "World Health Organization" }, { creatorType: "editor", firstName: "Ed", lastName: "Itor" }],
  publicationTitle: "The Lancet", volume: "12", issue: "3", pages: "45-67", date: "2020-05-12", DOI: "https://doi.org/10.1000/XYZ", url: "https://example.org", abstractNote: "Abstract.",
  ISSN: "0140-6736", language: "en", extra: "PMID: 31234567\nCitation Key: smith2020", tags: [{ tag: "vitamin A" }, { tag: " " }, { tag: "mortality" }],
};

describe("Zotero item mapping", () => {
  it("maps a journal article with creators, identifiers, tags and a PMID from Extra", () => {
    const r = zoteroToRef(article)!;
    expect(r.ref).toMatchObject({ type: "article-journal", title: "Vitamin A supplementation and child mortality", journal: "The Lancet", year: 2020, month: 5, volume: "12", issue: "3", pages: "45–67", doi: "10.1000/xyz", pmid: "31234567", issn: "0140-6736", language: "en", abstract: "Abstract." });
    expect(r.ref.authors).toEqual([{ family: "Smith", given: "John A." }, { literal: "World Health Organization" }]);
    expect(r.ref.editors).toEqual([{ family: "Itor", given: "Ed" }]);
    expect(r.tags).toEqual(["vitamin A", "mortality"]);
  });
  it("handles chapters, conference papers and unusual dates", () => {
    expect(zoteroToRef({ itemType: "bookSection", title: "Ch", bookTitle: "The Book", date: "March 2019" })!.ref).toMatchObject({ type: "chapter", containerTitle: "The Book", year: 2019, month: 3 });
    expect(zoteroToRef({ itemType: "conferencePaper", title: "P", proceedingsTitle: "Proc", date: "2018" })!.ref).toMatchObject({ type: "paper-conference", containerTitle: "Proc", year: 2018 });
    expect(zoteroToRef({ itemType: "journalArticle", title: "No date" })!.ref.year).toBeUndefined();
  });
  it("skips attachments, notes and untitled items instead of inventing titles", () => {
    expect(zoteroToRef({ itemType: "attachment", title: "file.pdf" })).toBeNull();
    expect(zoteroToRef({ itemType: "note", title: "n" })).toBeNull();
    expect(zoteroToRef({ itemType: "journalArticle", title: "  " })).toBeNull();
  });
});

const page = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ data: { itemType: "journalArticle", title: `Item ${from + i}`, creators: [{ creatorType: "author", firstName: "A", lastName: "B" }], date: "2020" } }));
const KEY = "abcdEFGH1234ijkl5678";
const reply = (calls: string[], pages: unknown[][], total: number, extra: Record<string, string> = {}) => {
  let i = 0;
  return (async (url: string, init: RequestInit) => {
    calls.push(url);
    expect((init.headers as Record<string, string>)["Zotero-API-Key"]).toBe(KEY);
    expect((init.headers as Record<string, string>)["Zotero-API-Version"]).toBe("3");
    const body = pages[Math.min(i++, pages.length - 1)];
    return new Response(JSON.stringify(body), { headers: { "Total-Results": String(total), ...extra } });
  }) as unknown as typeof fetch;
};
const noWait = async () => {};

describe("Zotero fetching", () => {
  it("pages through a library, sending the key only to api.zotero.org", async () => {
    const calls: string[] = [];
    const r = await fetchZoteroItems({ kind: "user", id: "12345", apiKey: KEY }, { f: reply(calls, [page(100), page(30, 100)], 130), wait: noWait });
    expect(r.items).toHaveLength(130);
    expect(calls).toHaveLength(2);
    expect(calls.every((u) => u.startsWith("https://api.zotero.org/users/12345/items?"))).toBe(true);
    expect(calls[1]).toContain("start=100");
  });
  it("reads a group collection and counts skipped non-reference items", async () => {
    const calls: string[] = [];
    const mixed = [...page(2), { data: { itemType: "attachment", title: "x.pdf" } }];
    const r = await fetchZoteroItems({ kind: "group", id: "9", apiKey: KEY, collectionKey: "ABCD1234" }, { f: reply(calls, [mixed], 3), wait: noWait });
    expect(calls[0]).toContain("/groups/9/collections/ABCD1234/items");
    expect(r.items).toHaveLength(2);
    expect(r.skipped).toBe(1);
  });
  it("honours the Backoff header and the item cap", async () => {
    const waits: number[] = [];
    const calls: string[] = [];
    const r = await fetchZoteroItems({ kind: "user", id: "1", apiKey: KEY }, { f: reply(calls, [page(100), page(100, 100)], 400, { Backoff: "3" }), max: 150, wait: async (ms) => { waits.push(ms); } });
    expect(waits[0]).toBe(3000);
    expect(r.items).toHaveLength(150);
    expect(calls).toHaveLength(2);
  });
  it("explains bad keys, missing libraries and rate limits", async () => {
    const status = (code: number, headers: Record<string, string> = {}) => ({ f: (async () => new Response("", { status: code, headers })) as unknown as typeof fetch, wait: noWait });
    await expect(fetchZoteroItems({ kind: "user", id: "1", apiKey: KEY }, status(403))).rejects.toThrow(/refused the key/);
    await expect(fetchZoteroItems({ kind: "user", id: "1", apiKey: KEY }, status(404))).rejects.toThrow(/could not find/);
    await expect(fetchZoteroItems({ kind: "user", id: "1", apiKey: KEY }, status(429, { "Retry-After": "30" }))).rejects.toThrow(/in 30 seconds/);
    await expect(fetchZoteroItems({ kind: "user", id: "1", apiKey: KEY }, status(500))).rejects.toThrow(/error \(500\)/);
  });
  it("validates inputs before any request and reports network failures", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response("[]"); }) as unknown as typeof fetch;
    await expect(fetchZoteroItems({ kind: "user", id: "abc", apiKey: KEY }, { f })).rejects.toBeInstanceOf(ZoteroError);
    await expect(fetchZoteroItems({ kind: "user", id: "1", apiKey: "short" }, { f })).rejects.toThrow(/API key/);
    await expect(fetchZoteroItems({ kind: "user", id: "1", apiKey: KEY, collectionKey: "bad key" }, { f })).rejects.toThrow(/collection key/);
    expect(calls).toBe(0);
    const down = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    await expect(fetchZoteroItems({ kind: "user", id: "1", apiKey: KEY }, { f: down })).rejects.toThrow(/Could not reach Zotero/);
    expect(isZoteroKey(KEY)).toBe(true);
  });
  it("returns an empty library cleanly", async () => {
    const r = await fetchZoteroItems({ kind: "user", id: "1", apiKey: KEY }, { f: reply([], [[]], 0), wait: noWait });
    expect(r).toEqual({ items: [], total: 0, skipped: 0 });
  });
});

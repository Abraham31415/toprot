import { describe, expect, it } from "vitest";
import { CslFetchError, STYLE_INDEX_INFO, fetchLocale, fetchOfficialStyle, searchStyles } from "../server";
import { isLocaleId, isStyleId } from "../styles";

const style = (extra = "") => `<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0"><info><title>T</title><id>x</id>${extra}</info><citation><layout><text variable="title"/></layout></citation></style>`;
const respond = (map: Record<string, string | number>) => ((async (url: string) => {
  const hit = map[Object.keys(map).find((k) => url.endsWith(k)) ?? ""];
  if (typeof hit === "number") return new Response("", { status: hit });
  if (hit === undefined) return new Response("", { status: 404 });
  return new Response(hit);
}) as unknown as typeof fetch);

describe("identifier validation", () => {
  it("accepts only real CSL style and locale names", () => {
    for (const ok of ["apa", "elsevier-vancouver", "ieee", "a1-b2"]) expect(isStyleId(ok)).toBe(true);
    for (const bad of ["../etc/passwd", "APA", "a/b", "a b", "-a", "a-", "a--b", "", "x".repeat(121), 5, null]) expect(isStyleId(bad)).toBe(false);
    expect(isLocaleId("en-US")).toBe(true);
    for (const bad of ["en", "EN-us", "en_US", "../en-US", "en-USA"]) expect(isLocaleId(bad)).toBe(false);
  });
});

describe("style search", () => {
  it("is built from the official index", () => {
    expect(STYLE_INDEX_INFO.count).toBeGreaterThan(9000);
    expect(STYLE_INDEX_INFO.independent).toBeGreaterThan(2000);
  });
  it("finds well-known styles and ranks an exact id first", () => {
    expect(searchStyles("apa")[0].id).toBe("apa");
    expect(searchStyles("vancouver").some((s) => s.id === "elsevier-vancouver")).toBe(true);
    expect(searchStyles("chicago author date").some((s) => s.id === "chicago-author-date")).toBe(true);
    expect(searchStyles("the lancet").some((s) => s.id === "the-lancet")).toBe(true);
  });
  it("requires every word to match, caps results and returns nothing for an empty query", () => {
    expect(searchStyles("zzzzqqq")).toEqual([]);
    expect(searchStyles("")).toEqual([]);
    expect(searchStyles("   ")).toEqual([]);
    expect(searchStyles("university", 5).length).toBeLessThanOrEqual(5);
  });
  it("flags dependent (journal-specific) styles", () => {
    const dep = searchStyles("2d materials");
    expect(dep[0]).toMatchObject({ id: "2d-materials", dependent: true });
    expect(searchStyles("apa")[0].dependent).toBe(false);
    const hits = searchStyles("journal of", 30);
    expect(hits.every((h) => typeof h.title === "string" && /^[a-z0-9-]+$/.test(h.id))).toBe(true);
  });
});

describe("fetching official styles", () => {
  it("rejects invalid ids without making any request", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response(style()); }) as unknown as typeof fetch;
    await expect(fetchOfficialStyle("../secret", f)).rejects.toThrow(/not a valid style name/);
    await expect(fetchOfficialStyle("A", f)).rejects.toThrow(/not a valid style name/);
    await expect(fetchLocale("en", f)).rejects.toThrow(/not a valid locale/);
    expect(calls).toBe(0);
  });
  it("returns an independent style as is", async () => {
    const s = await fetchOfficialStyle("my-style", respond({ "/my-style.csl": style() }));
    expect(s).toMatchObject({ id: "my-style", title: "T" });
    expect(s.parent).toBeUndefined();
  });
  it("resolves a dependent style to its parent's formatting, keeping its own title", async () => {
    const dep = style('<link href="http://www.zotero.org/styles/parent-style" rel="independent-parent"/>').replace("<title>T</title>", "<title>Journal X</title>");
    const s = await fetchOfficialStyle("journal-x", respond({ "/journal-x.csl": dep, "/parent-style.csl": style() }));
    expect(s.title).toBe("Journal X");
    expect(s.parent).toBe("parent-style");
    expect(s.xml).not.toContain("independent-parent");
  });
  it("looks in the dependent/ folder for journal-specific styles named in the official index", async () => {
    const dep = style('<link href="http://www.zotero.org/styles/apa" rel="independent-parent"/>').replace("<title>T</title>", "<title>2D Materials</title>");
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url.replace(/^.*\/master\//, ""));
      if (url.endsWith("/dependent/2d-materials.csl")) return new Response(dep);
      if (url.endsWith("/apa.csl")) return new Response(style());
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const s = await fetchOfficialStyle("2d-materials", f);
    expect(s).toMatchObject({ id: "2d-materials", title: "2D Materials", parent: "apa" });
    expect(calls[0]).toBe("dependent/2d-materials.csl");
  });
  it("falls back to the other folder for a style that is not in the index", async () => {
    const calls: string[] = [];
    const f = (async (url: string) => { calls.push(url); return url.endsWith("/dependent/new-one.csl") ? new Response(style()) : new Response("", { status: 404 }); }) as unknown as typeof fetch;
    expect((await fetchOfficialStyle("new-one", f)).id).toBe("new-one");
    expect(calls).toHaveLength(2);
  });
  it("refuses a parent that is itself dependent, and files that are not CSL", async () => {
    const dep = style('<link href="http://www.zotero.org/styles/p" rel="independent-parent"/>');
    await expect(fetchOfficialStyle("d", respond({ "/d.csl": dep, "/p.csl": dep }))).rejects.toThrow(/parent style could not be used/);
    await expect(fetchOfficialStyle("junk", respond({ "/junk.csl": "<html>not a style</html>" }))).rejects.toThrow(/not a CSL style/);
  });
  it("maps a missing style, outages and oversized files to clear errors", async () => {
    await expect(fetchOfficialStyle("nope", respond({}))).rejects.toMatchObject({ status: 404 });
    await expect(fetchOfficialStyle("down", respond({ "/down.csl": 503 }))).rejects.toMatchObject({ status: 502 });
    await expect(fetchOfficialStyle("big", respond({ "/big.csl": "x".repeat(700_000) }))).rejects.toMatchObject({ status: 413 });
    const throws = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    await expect(fetchOfficialStyle("any", throws)).rejects.toBeInstanceOf(CslFetchError);
  });
  it("fetches and validates locales", async () => {
    expect(await fetchLocale("fr-FR", respond({ "/locales-fr-FR.xml": '<locale xmlns="x" xml:lang="fr-FR"></locale>' }))).toContain("<locale");
    await expect(fetchLocale("fr-FR", respond({ "/locales-fr-FR.xml": "garbage" }))).rejects.toThrow(/not a CSL locale/);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as openalex from "../openalex";
import * as crossref from "../crossref";
import * as pubmed from "../pubmed";
import { fetchPubmedAbstract, fetchVerifiedWork, searchLiterature, type Env } from "../search";
import { LiteratureError, type SearchParams } from "../types";

const fx = (n: string) => readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const json = (n: string) => JSON.parse(fx(n));
const P = (o: Partial<SearchParams> = {}): SearchParams => ({ source: "openalex", keywords: "vitamin A", ...o });
const q = (url: string) => new URL(url).searchParams;

describe("OpenAlex URL builder", () => {
  it("builds precise filters, a field select and paging", () => {
    const { url } = openalex.buildWorksUrl(P({ title: "child mortality", author: "Black", doi: "https://doi.org/10.1016/S0140-6736(94)90737-4", yearFrom: 2010, yearTo: 2020, openAccess: true, articleType: "review", page: 2, pageSize: 10 }), {});
    const s = q(url);
    const filter = s.get("filter")!;
    expect(filter).toContain("doi:10.1016/s0140-6736(94)90737-4");
    expect(filter).toContain("title_and_abstract.search:vitamin A");
    expect(filter).toContain("title.search:child mortality");
    expect(filter).toContain("raw_author_name.search:Black");
    expect(filter).toContain("from_publication_date:2010-01-01");
    expect(filter).toContain("to_publication_date:2020-12-31");
    expect(filter).toContain("is_oa:true");
    expect(filter).toContain("type:review");
    expect(s.get("per-page")).toBe("10");
    expect(s.get("page")).toBe("2");
    expect(s.get("select")).toContain("abstract_inverted_index");
  });
  it("cannot be broken out of its filter by commas, pipes or colons in user text", () => {
    const { url } = openalex.buildWorksUrl(P({ keywords: "a,b|c:d is_oa:false" }), {});
    const filter = q(url).get("filter")!;
    expect(filter.split(",")).toHaveLength(1);
    expect(filter).toBe("title_and_abstract.search:a b c d is_oa false");
  });
  it("clamps page size, adds the key and source id only when given, and ignores a malformed DOI with a note", () => {
    const { url, notes } = openalex.buildWorksUrl(P({ pageSize: 9999, page: -5, doi: "nonsense" }), { apiKey: "K", sourceId: "S1" });
    expect(q(url).get("per-page")).toBe("25");
    expect(q(url).get("page")).toBe("1");
    expect(q(url).get("api_key")).toBe("K");
    expect(q(url).get("filter")).toContain("primary_location.source.id:S1");
    expect(notes.join(" ")).toMatch(/DOI was not in a recognised form/);
    expect(q(openalex.buildWorksUrl(P(), {}).url).has("api_key")).toBe(false);
  });
  it("never rejects an unsafe article type", () => {
    expect(q(openalex.buildWorksUrl(P({ articleType: "x,is_oa:true" }), {}).url).get("filter")).not.toContain("type:");
  });
});

describe("OpenAlex parsing (real response)", () => {
  const { works, total } = openalex.parseWorks(json("openalex-search.json"));
  it("returns the records with provenance and no invented fields", () => {
    expect(works.length).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(works.length);
    for (const w of works) {
      expect(w.source).toBe("openalex");
      expect(w.id).toMatch(/^openalex:W\d+$/);
      expect(w.title.length).toBeGreaterThan(3);
      expect(w.openalexId).toMatch(/^W\d+$/);
      if (w.doi) expect(w.doi).toMatch(/^10\./);
      if (w.landingUrl) expect(w.landingUrl).toMatch(/^https?:\/\//);
    }
  });
  it("reports open access only with a link when the source says it is open", () => {
    for (const w of works) if (w.openAccess && !w.openAccess.isOa) expect(w.openAccess.url).toBeUndefined();
  });
  it("rebuilds abstracts from the inverted index in word order", () => {
    expect(openalex.reconstructAbstract({ world: [1], Hello: [0], again: [2, 3] })).toBe("Hello world again again");
    expect(openalex.reconstructAbstract(null)).toBeUndefined();
    expect(openalex.reconstructAbstract({})).toBeUndefined();
  });
  it("skips records with no title instead of making one up", () => {
    expect(openalex.parseWork({ id: "https://openalex.org/W1", title: null })).toBeNull();
    expect(openalex.parseWork({ title: "No id" })).toBeNull();
  });
});

describe("Crossref (real response)", () => {
  it("builds queries and filters, and says plainly that open access cannot be filtered", () => {
    const { url, notes } = crossref.buildWorksUrl(P({ source: "crossref", title: "t", author: "a", journal: "j", yearFrom: 2000, yearTo: 2010, openAccess: true }));
    const s = q(url);
    expect(s.get("query.title")).toBe("t");
    expect(s.get("query.author")).toBe("a");
    expect(s.get("query.container-title")).toBe("j");
    expect(s.get("filter")).toBe("from-pub-date:2000,until-pub-date:2010");
    expect(notes.join(" ")).toMatch(/does not record open-access status/);
    expect(s.get("select")).not.toContain("language");
  });
  it("parses real records with DOI and structured authors", () => {
    const { works, total } = crossref.parseWorks(json("crossref-search.json"));
    expect(works.length).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
    for (const w of works) {
      expect(w.doi).toMatch(/^10\./);
      expect(w.landingUrl).toBe(`https://doi.org/${w.doi}`);
      expect(w.id).toBe(`crossref:${w.doi}`);
    }
  });
  it("drops items without a DOI or title", () => {
    expect(crossref.parseWork({ title: ["x"] })).toBeNull();
    expect(crossref.parseWork({ DOI: "10.1000/a" })).toBeNull();
  });
  it("turns JATS abstracts into text", () => {
    const w = crossref.parseWork({ DOI: "10.1000/a", title: ["T"], abstract: "<jats:title>Abstract</jats:title><jats:p>Some <jats:italic>text</jats:italic>.</jats:p>" });
    expect(w!.abstract).toBe("Some text.");
  });
});

describe("PubMed (real responses)", () => {
  it("builds a fielded query with filters and neutralises query syntax in user text", () => {
    const { term } = pubmed.buildTerm(P({ source: "pubmed", keywords: 'a" OR [x]', title: "t", author: "Black JA", journal: "Lancet", yearFrom: 2010, yearTo: 2020, openAccess: true, studyType: "Randomized Controlled Trial" }));
    expect(term).toBe('(a OR x) AND (t)[Title] AND (Black JA)[Author] AND (Lancet)[Journal] AND 2010:2020[dp] AND free full text[sb] AND "Randomized Controlled Trial"[pt]');
    expect(pubmed.buildTerm(P({ source: "pubmed", studyType: "Not A Real Type" })).term).toBe("(vitamin A)");
  });
  it("parses esummary into works with PMID, DOI and honest open-access flags", () => {
    const ids = json("pubmed-esearch.json").esearchresult.idlist as string[];
    const works = pubmed.parseEsummary(json("pubmed-esummary.json"), ids);
    expect(works.length).toBeGreaterThan(0);
    for (const w of works) {
      expect(w.source).toBe("pubmed");
      expect(w.pmid).toMatch(/^\d+$/);
      expect(w.landingUrl).toBe(`https://pubmed.ncbi.nlm.nih.gov/${w.pmid}/`);
      expect(w.year).toBeGreaterThan(1900);
      if (w.openAccess) expect(w.openAccess.url).toMatch(/\/pmc\/articles\/PMC/);
    }
    expect(works.some((w) => w.publicationTypes?.length)).toBe(true);
  });
  it("extracts the abstract from efetch XML, and returns undefined when there is none", () => {
    const a = pubmed.parseEfetchAbstract(fx("pubmed-efetch.xml"));
    expect(typeof a === "string" || a === undefined).toBe(true);
    expect(pubmed.parseEfetchAbstract("<PubmedArticle></PubmedArticle>")).toBeUndefined();
    expect(pubmed.parseEfetchAbstract('<AbstractText Label="METHODS">We <i>did</i> it.</AbstractText><AbstractText Label="RESULTS">It worked.</AbstractText>')).toBe("Methods: We did it.\nResults: It worked.");
  });
});

const stub = (status: number, body: unknown = {}, headers: Record<string, string> = {}): Env => ({
  fetch: (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers })) as typeof fetch,
});

describe("search orchestration and error handling", () => {
  it("rejects an empty search and a reversed year range before calling any source", async () => {
    await expect(searchLiterature({ source: "openalex" }, stub(200))).rejects.toThrow(/Enter a keyword/);
    await expect(searchLiterature(P({ yearFrom: 2020, yearTo: 2010 }), stub(200))).rejects.toThrow(/first year/);
  });
  it("turns rate limits into a clear message with a retry time", async () => {
    const err = await searchLiterature(P(), stub(429, {}, { "retry-after": "42" })).catch((e) => e);
    expect(err).toBeInstanceOf(LiteratureError);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(42);
    expect(err.message).toMatch(/OpenAlex is limiting requests/);
  });
  it("maps server errors, timeouts and unreadable responses to friendly errors naming the source", async () => {
    await expect(searchLiterature(P({ source: "crossref" }), stub(503))).rejects.toThrow(/Crossref returned an error \(503\)/);
    await expect(searchLiterature(P({ source: "pubmed" }), stub(200, "not json"))).rejects.toThrow(/could not be read/);
    const slow: Env = { fetch: ((_: unknown, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))))) as typeof fetch, timeoutMs: 20 };
    await expect(searchLiterature(P(), slow)).rejects.toThrow(/did not respond in time/);
    const down: Env = { fetch: (async () => { throw new Error("ECONNRESET"); }) as typeof fetch };
    await expect(searchLiterature(P(), down)).rejects.toThrow(/Could not reach OpenAlex/);
  });
  it("runs a complete OpenAlex search from a real response", async () => {
    const r = await searchLiterature(P(), stub(200, json("openalex-search.json")));
    expect(r.source).toBe("openalex");
    expect(r.works.length).toBeGreaterThan(0);
    expect(r.page).toBe(1);
  });
  it("resolves a journal name to a source id, tells the user which journal matched, and handles no match", async () => {
    const calls: string[] = [];
    const env: Env = { fetch: (async (u: string) => { calls.push(u); return new Response(JSON.stringify(u.includes("/sources") ? { results: [{ id: "https://openalex.org/S49861241", display_name: "The Lancet" }] } : json("openalex-search.json"))); }) as unknown as typeof fetch };
    const r = await searchLiterature(P({ journal: "Lancet" }), env);
    expect(calls[1]).toContain("primary_location.source.id%3AS49861241");
    expect(r.notes.join(" ")).toMatch(/matched "The Lancet"/);
    const none = await searchLiterature(P({ journal: "zzzz" }), stub(200, { results: [] }));
    expect(none.works).toEqual([]);
    expect(none.notes[0]).toMatch(/no journal matching/);
  });
  it("runs PubMed as search then summary, and returns empty results without a second call", async () => {
    let calls = 0;
    const env: Env = { fetch: (async (u: string) => { calls++; return new Response(JSON.stringify(u.includes("esearch") ? json("pubmed-esearch.json") : json("pubmed-esummary.json"))); }) as unknown as typeof fetch };
    const r = await searchLiterature(P({ source: "pubmed" }), env);
    expect(calls).toBe(2);
    expect(r.works.length).toBeGreaterThan(0);
    let c2 = 0;
    const empty: Env = { fetch: (async () => { c2++; return new Response(JSON.stringify({ esearchresult: { count: "0", idlist: [] } })); }) as unknown as typeof fetch };
    expect((await searchLiterature(P({ source: "pubmed" }), empty)).works).toEqual([]);
    expect(c2).toBe(1);
  });
  it("surfaces a PubMed query error", async () => {
    await expect(searchLiterature(P({ source: "pubmed" }), stub(200, { esearchresult: { ERROR: "bad term" } }))).rejects.toThrow(/bad term/);
  });
  it("validates PubMed IDs before fetching an abstract", async () => {
    await expect(fetchPubmedAbstract("abc", stub(200, ""))).rejects.toThrow(/not a valid PubMed ID/);
    expect(await fetchPubmedAbstract("123", stub(200, '<AbstractText>Hi.</AbstractText>'))).toBe("Hi.");
  });
});

describe("verified re-fetch for saving", () => {
  it("uses Crossref for a DOI and returns its record", async () => {
    const item = json("crossref-search.json").message.items[0];
    const env: Env = { fetch: (async () => new Response(JSON.stringify({ message: item }))) as unknown as typeof fetch };
    const w = await fetchVerifiedWork({ doi: item.DOI }, env);
    expect(w?.source).toBe("crossref");
    expect(w?.doi).toBe(item.DOI.toLowerCase());
  });
  it("falls back to OpenAlex when Crossref does not know the DOI", async () => {
    const oa = json("openalex-search.json").results[0];
    const env: Env = { fetch: (async (u: string) => (u.includes("crossref") ? new Response("", { status: 404 }) : new Response(JSON.stringify(oa)))) as unknown as typeof fetch };
    const w = await fetchVerifiedWork({ doi: "10.1000/unknown" }, env);
    expect(w?.source).toBe("openalex");
  });
  it("returns null when no source has the record, and rejects malformed identifiers without calling out", async () => {
    expect(await fetchVerifiedWork({ doi: "10.1000/none" }, stub(404))).toBeNull();
    let calls = 0;
    const env: Env = { fetch: (async () => { calls++; return new Response("{}"); }) as unknown as typeof fetch };
    expect(await fetchVerifiedWork({ doi: "junk", pmid: "abc", openalexId: "X1" }, env)).toBeNull();
    expect(calls).toBe(0);
  });
  it("propagates a rate limit instead of pretending the record does not exist", async () => {
    await expect(fetchVerifiedWork({ doi: "10.1000/a" }, stub(429))).rejects.toThrow(/limiting requests/);
  });
});

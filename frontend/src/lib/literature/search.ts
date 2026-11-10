import { normalizeDoi } from "../refs/model";
import * as crossref from "./crossref";
import * as openalex from "./openalex";
import * as pubmed from "./pubmed";
import { LiteratureError, SOURCE_INFO, clampPage, type SearchParams, type SearchResult, type Work } from "./types";

export type Env = {
  fetch?: typeof fetch;
  openAlexKey?: string;
  ncbiKey?: string;
  /** A contact address for Crossref's polite pool. Only sent when the site owner has configured one. */
  mailto?: string;
  timeoutMs?: number;
};

export const envFromProcess = (): Env => ({
  openAlexKey: process.env.OPENALEX_API_KEY || undefined,
  ncbiKey: process.env.NCBI_API_KEY || undefined,
  mailto: process.env.LITERATURE_MAILTO || undefined,
});

const UA = "ToProt/1.0 (https://toprot.vercel.app; research reference tool)";

async function get(url: string, source: keyof typeof SOURCE_INFO, env: Env, as: "json" | "text" = "json"): Promise<unknown> {
  const f = env.fetch ?? fetch;
  const name = SOURCE_INFO[source].name;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), env.timeoutMs ?? 12000);
  let res: Response;
  try {
    res = await f(url, { headers: { "User-Agent": UA, Accept: as === "json" ? "application/json" : "text/xml" }, signal: ctl.signal, cache: "no-store" });
  } catch (e) {
    throw new LiteratureError((e as Error).name === "AbortError" ? `${name} did not respond in time. Try again, or use another source.` : `Could not reach ${name}. Try again, or use another source.`, 504);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    const retry = parseInt(res.headers.get("retry-after") ?? "", 10);
    throw new LiteratureError(`${name} is limiting requests right now. Wait a minute and try again, or use another source.`, 429, Number.isFinite(retry) ? retry : 60);
  }
  if (res.status === 404) throw new LiteratureError(`${name} has no record for that request.`, 404);
  if (!res.ok) throw new LiteratureError(`${name} returned an error (${res.status}). Try again later, or use another source.`, 502);
  try {
    return as === "json" ? await res.json() : await res.text();
  } catch {
    throw new LiteratureError(`${name} returned a response that could not be read.`, 502);
  }
}

const hasQuery = (p: SearchParams) => [p.keywords, p.title, p.author, p.journal, p.doi].some((v) => v && v.trim());

export async function searchLiterature(params: SearchParams, env: Env = envFromProcess()): Promise<SearchResult> {
  if (!hasQuery(params)) throw new LiteratureError("Enter a keyword, title, author, journal or DOI to search.", 400);
  const p: SearchParams = { ...params, page: clampPage(params.page, 1, 400, 1), pageSize: clampPage(params.pageSize, 1, 25, 20) };
  if (p.yearFrom && p.yearTo && p.yearFrom > p.yearTo) throw new LiteratureError("The first year must not be after the last year.", 400);

  if (p.source === "openalex") {
    let sourceId: string | undefined;
    const notes: string[] = [];
    if (p.journal?.trim()) {
      const lookup = (await get(openalex.buildSourceLookupUrl(p.journal, env.openAlexKey), "openalex", env)) as { results?: { id?: string; display_name?: string }[] };
      const hit = lookup.results?.[0];
      if (!hit?.id) return { source: "openalex", total: 0, page: p.page!, pageSize: p.pageSize!, works: [], notes: [`OpenAlex has no journal matching "${p.journal.trim()}".`] };
      sourceId = hit.id.replace("https://openalex.org/", "");
      notes.push(`Journal filter matched "${hit.display_name}". If that is not the journal you meant, give its full title.`);
    }
    const { url, notes: n } = openalex.buildWorksUrl(p, { apiKey: env.openAlexKey, sourceId });
    const json = (await get(url, "openalex", env)) as Parameters<typeof openalex.parseWorks>[0];
    const { total, works } = openalex.parseWorks(json);
    return { source: "openalex", total, page: p.page!, pageSize: p.pageSize!, works, notes: [...notes, ...n] };
  }

  if (p.source === "crossref") {
    const { url, notes } = crossref.buildWorksUrl(p, env.mailto);
    const json = (await get(url, "crossref", env)) as Parameters<typeof crossref.parseWorks>[0];
    const { total, works } = crossref.parseWorks(json);
    return { source: "crossref", total, page: p.page!, pageSize: p.pageSize!, works, notes };
  }

  const built = pubmed.buildEsearchUrl(p, env.ncbiKey);
  if (!built) throw new LiteratureError("Enter a keyword, title, author, journal or DOI to search.", 400);
  const es = pubmed.parseEsearch((await get(built.url, "pubmed", env)) as Parameters<typeof pubmed.parseEsearch>[0]);
  if (es.error) throw new LiteratureError(`PubMed could not run that search: ${es.error}`, 400);
  if (!es.ids.length) return { source: "pubmed", total: es.total, page: p.page!, pageSize: p.pageSize!, works: [], notes: built.notes };
  const sum = (await get(pubmed.buildEsummaryUrl(es.ids, env.ncbiKey), "pubmed", env)) as Parameters<typeof pubmed.parseEsummary>[0];
  return { source: "pubmed", total: es.total, page: p.page!, pageSize: p.pageSize!, works: pubmed.parseEsummary(sum, es.ids), notes: built.notes };
}

/** The abstract for one PubMed record, fetched on demand. Returns undefined when PubMed has none. */
export async function fetchPubmedAbstract(pmid: string, env: Env = envFromProcess()): Promise<string | undefined> {
  if (!/^\d{1,9}$/.test(pmid)) throw new LiteratureError("That is not a valid PubMed ID.", 400);
  const xml = (await get(pubmed.buildEfetchUrl(pmid, env.ncbiKey), "pubmed", env, "text")) as string;
  return pubmed.parseEfetchAbstract(xml);
}

export type WorkRef = { doi?: string; pmid?: string; openalexId?: string };

/**
 * Re-fetch one record from its authoritative source so what is saved to a project comes from a
 * bibliographic source, not from whatever the browser sent. DOI goes to Crossref first, then OpenAlex;
 * a PubMed ID goes to PubMed; an OpenAlex ID goes to OpenAlex.
 */
export async function fetchVerifiedWork(ref: WorkRef, env: Env = envFromProcess()): Promise<Work | null> {
  const doi = normalizeDoi(ref.doi);
  const attempts: (() => Promise<Work | null>)[] = [];
  if (doi) {
    attempts.push(async () => crossref.parseWork(((await get(crossref.buildWorkUrl(doi, env.mailto), "crossref", env)) as { message?: Parameters<typeof crossref.parseWork>[0] }).message ?? {}));
    attempts.push(async () => openalex.parseWork((await get(openalex.buildWorkByIdUrl(`doi:${doi}`, env.openAlexKey), "openalex", env)) as Parameters<typeof openalex.parseWork>[0]));
  }
  if (ref.pmid && /^\d{1,9}$/.test(ref.pmid)) {
    attempts.push(async () => pubmed.parseEsummary((await get(pubmed.buildEsummaryUrl([ref.pmid!], env.ncbiKey), "pubmed", env)) as Parameters<typeof pubmed.parseEsummary>[0], [ref.pmid!])[0] ?? null);
  }
  if (ref.openalexId && /^W\d+$/.test(ref.openalexId)) {
    attempts.push(async () => openalex.parseWork((await get(openalex.buildWorkByIdUrl(ref.openalexId!, env.openAlexKey), "openalex", env)) as Parameters<typeof openalex.parseWork>[0]));
  }
  let lastError: unknown;
  for (const a of attempts) {
    try { const w = await a(); if (w) return w; } catch (e) { lastError = e; if (e instanceof LiteratureError && e.status === 429) throw e; }
  }
  if (lastError instanceof LiteratureError && lastError.status !== 404) throw lastError;
  return null;
}

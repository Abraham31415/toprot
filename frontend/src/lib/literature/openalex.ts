import { normalizeDoi, parsePersonName, stripMarkup, type RefType } from "../refs/model";
import { clampPage, type SearchParams, type SortKey, type Work } from "./types";

export const OPENALEX_BASE = "https://api.openalex.org";

const SELECT = [
  "id", "doi", "title", "publication_year", "publication_date", "type", "language", "cited_by_count", "authorships", "primary_location",
  "open_access", "biblio", "ids", "abstract_inverted_index", "keywords",
].join(",");

const SORT: Record<SortKey, string> = { relevance: "relevance_score:desc", cited: "cited_by_count:desc", newest: "publication_date:desc" };

const TYPE_MAP: Record<string, RefType> = { article: "article-journal", review: "article-journal", preprint: "article", "book-chapter": "chapter", book: "book", dissertation: "thesis", report: "report" };

/** OpenAlex filter values are comma-separated, so commas and pipes inside user text are removed. */
const clean = (s: string) => s.replace(/[,|:]/g, " ").replace(/\s+/g, " ").trim();

export function buildWorksUrl(p: SearchParams, opts: { apiKey?: string; sourceId?: string } = {}): { url: string; notes: string[] } {
  const filters: string[] = [];
  const notes: string[] = [];
  const doi = normalizeDoi(p.doi);
  if (p.doi?.trim() && !doi) notes.push("The DOI was not in a recognised form (10.xxxx/...), so it was ignored.");
  if (doi) filters.push(`doi:${doi}`);
  if (p.keywords?.trim()) filters.push(`title_and_abstract.search:${clean(p.keywords)}`);
  if (p.title?.trim()) filters.push(`title.search:${clean(p.title)}`);
  if (p.author?.trim()) { filters.push(`raw_author_name.search:${clean(p.author)}`); notes.push("Author search matches author names as printed on the papers, so spellings and initials can miss or add records."); }
  if (opts.sourceId) filters.push(`primary_location.source.id:${opts.sourceId}`);
  if (p.yearFrom) filters.push(`from_publication_date:${p.yearFrom}-01-01`);
  if (p.yearTo) filters.push(`to_publication_date:${p.yearTo}-12-31`);
  if (p.openAccess) filters.push("is_oa:true");
  if (p.articleType && /^[a-z-]+$/.test(p.articleType)) filters.push(`type:${p.articleType}`);
  const q = new URLSearchParams();
  if (filters.length) q.set("filter", filters.join(","));
  q.set("select", SELECT);
  q.set("per-page", String(clampPage(p.pageSize, 1, 25, 20)));
  q.set("page", String(clampPage(p.page, 1, 400, 1)));
  const sort = p.sort ?? "relevance";
  // Relevance only has meaning when there is a text query.
  if (sort !== "relevance" || p.keywords?.trim() || p.title?.trim()) q.set("sort", SORT[sort]);
  if (opts.apiKey) q.set("api_key", opts.apiKey);
  return { url: `${OPENALEX_BASE}/works?${q.toString()}`, notes };
}

export const buildSourceLookupUrl = (name: string, apiKey?: string) => {
  const q = new URLSearchParams({ search: name.trim(), "per-page": "1", select: "id,display_name" });
  if (apiKey) q.set("api_key", apiKey);
  return `${OPENALEX_BASE}/sources?${q.toString()}`;
};

export const buildWorkByIdUrl = (id: string, apiKey?: string) => {
  const q = new URLSearchParams({ select: SELECT });
  if (apiKey) q.set("api_key", apiKey);
  return `${OPENALEX_BASE}/works/${encodeURIComponent(id)}?${q.toString()}`;
};

/** OpenAlex ships abstracts as an inverted index (word -> positions). Rebuild the text in order. */
export function reconstructAbstract(index: Record<string, number[]> | null | undefined): string | undefined {
  if (!index) return undefined;
  const words: [number, string][] = [];
  for (const [w, positions] of Object.entries(index)) for (const pos of positions) words.push([pos, w]);
  if (!words.length) return undefined;
  words.sort((a, b) => a[0] - b[0]);
  return words.map(([, w]) => w).join(" ").trim() || undefined;
}

type OAWork = {
  id?: string; doi?: string | null; title?: string | null; publication_year?: number | null; publication_date?: string | null; type?: string | null; language?: string | null;
  cited_by_count?: number | null;
  authorships?: { raw_author_name?: string | null; author?: { display_name?: string | null } | null }[] | null;
  primary_location?: { landing_page_url?: string | null; source?: { display_name?: string | null; issn_l?: string | null; host_organization_name?: string | null } | null } | null;
  open_access?: { is_oa?: boolean | null; oa_status?: string | null; oa_url?: string | null } | null;
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null } | null;
  ids?: { pmid?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  keywords?: { display_name?: string | null }[] | null;
};

export function parseWork(w: OAWork): Work | null {
  const title = stripMarkup(w.title ?? "");
  if (!w.id || !title) return null;
  const short = w.id.replace("https://openalex.org/", "");
  const doi = normalizeDoi(w.doi);
  const pmidMatch = /(\d+)\/?$/.exec(w.ids?.pmid ?? "");
  const b = w.biblio ?? {};
  const first = b.first_page?.trim(), last = b.last_page?.trim();
  const authors = (w.authorships ?? []).map((a) => a.author?.display_name ?? a.raw_author_name ?? "").filter(Boolean).map((n) => parsePersonName(n));
  const dateMatch = /^\d{4}-(\d{2})/.exec(w.publication_date ?? "");
  const src = w.primary_location?.source;
  const oa = w.open_access;
  return {
    id: `openalex:${short}`, source: "openalex", type: TYPE_MAP[w.type ?? ""] ?? "other", sourceType: w.type ?? undefined,
    title, authors,
    journal: src?.display_name ?? undefined, year: w.publication_year ?? undefined, month: dateMatch ? parseInt(dateMatch[1], 10) : undefined,
    volume: b.volume ?? undefined, issue: b.issue ?? undefined, pages: first ? (last && last !== first ? `${first}-${last}` : first) : undefined,
    publisher: src?.host_organization_name ?? undefined, doi, pmid: pmidMatch ? pmidMatch[1] : undefined, openalexId: short, issn: src?.issn_l ?? undefined,
    language: w.language ?? undefined, abstract: reconstructAbstract(w.abstract_inverted_index), keywords: (w.keywords ?? []).map((k) => k.display_name ?? "").filter(Boolean),
    citedBy: w.cited_by_count ?? undefined,
    landingUrl: doi ? `https://doi.org/${doi}` : w.primary_location?.landing_page_url ?? undefined,
    openAccess: oa ? { isOa: !!oa.is_oa, status: oa.oa_status ?? undefined, url: oa.is_oa ? oa.oa_url ?? undefined : undefined } : undefined,
  };
}

export function parseWorks(json: { meta?: { count?: number }; results?: OAWork[] }): { total: number; works: Work[] } {
  const works = (json.results ?? []).map(parseWork).filter((x): x is Work => x !== null);
  return { total: json.meta?.count ?? works.length, works };
}

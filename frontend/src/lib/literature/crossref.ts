import { normalizeDoi, parsePersonName, stripMarkup, type RefType } from "../refs/model";
import { clampPage, type SearchParams, type Work } from "./types";

export const CROSSREF_BASE = "https://api.crossref.org";

const SELECT = ["DOI", "title", "author", "issued", "container-title", "type", "volume", "issue", "page", "publisher", "is-referenced-by-count", "ISSN", "abstract", "subject", "URL", "license"].join(",");

const TYPE_MAP: Record<string, RefType> = {
  "journal-article": "article-journal", "posted-content": "article", "book-chapter": "chapter", book: "book", "proceedings-article": "paper-conference", dissertation: "thesis", report: "report",
};

const SORT = { relevance: ["relevance", "desc"], cited: ["is-referenced-by-count", "desc"], newest: ["published", "desc"] } as const;

export function buildWorksUrl(p: SearchParams, mailto?: string): { url: string; notes: string[] } {
  const q = new URLSearchParams();
  const notes: string[] = [];
  const filters: string[] = [];
  if (p.keywords?.trim()) q.set("query.bibliographic", p.keywords.trim());
  if (p.title?.trim()) q.set("query.title", p.title.trim());
  if (p.author?.trim()) q.set("query.author", p.author.trim());
  if (p.journal?.trim()) q.set("query.container-title", p.journal.trim());
  const doi = normalizeDoi(p.doi);
  if (p.doi?.trim() && !doi) notes.push("The DOI was not in a recognised form (10.xxxx/...), so it was ignored.");
  if (doi) filters.push(`doi:${doi}`);
  if (p.yearFrom) filters.push(`from-pub-date:${p.yearFrom}`);
  if (p.yearTo) filters.push(`until-pub-date:${p.yearTo}`);
  if (p.articleType && /^[a-z-]+$/.test(p.articleType)) filters.push(`type:${p.articleType}`);
  if (p.openAccess) notes.push("Crossref does not record open-access status in a reliable way, so the open-access filter was not applied. Use OpenAlex or PubMed for that.");
  if (filters.length) q.set("filter", filters.join(","));
  q.set("select", SELECT);
  const size = clampPage(p.pageSize, 1, 25, 20);
  q.set("rows", String(size));
  q.set("offset", String((clampPage(p.page, 1, 400, 1) - 1) * size));
  const hasQuery = [...q.keys()].some((k) => k.startsWith("query."));
  const sort = p.sort ?? "relevance";
  if (sort !== "relevance" || hasQuery) { q.set("sort", SORT[sort][0]); q.set("order", SORT[sort][1]); }
  if (mailto) q.set("mailto", mailto);
  return { url: `${CROSSREF_BASE}/works?${q.toString()}`, notes };
}

export const buildWorkUrl = (doi: string, mailto?: string) => `${CROSSREF_BASE}/works/${encodeURIComponent(doi)}${mailto ? `?mailto=${encodeURIComponent(mailto)}` : ""}`;

type CRWork = {
  DOI?: string; title?: string[]; author?: { given?: string; family?: string; name?: string }[]; issued?: { "date-parts"?: (number | null)[][] };
  "container-title"?: string[]; type?: string; volume?: string; issue?: string; page?: string; publisher?: string; "is-referenced-by-count"?: number;
  ISSN?: string[]; language?: string; abstract?: string; subject?: string[]; URL?: string;
};

export function parseWork(w: CRWork): Work | null {
  const title = stripMarkup(w.title?.[0] ?? "");
  const doi = normalizeDoi(w.DOI);
  if (!title || !doi) return null;
  const dp = w.issued?.["date-parts"]?.[0];
  const authors = (w.author ?? []).map((a) => (a.family ? { family: a.family, ...(a.given ? { given: a.given } : {}) } : a.name ? { literal: a.name } : parsePersonName(a.given ?? ""))).filter((p) => p.family || p.literal);
  return {
    id: `crossref:${doi}`, source: "crossref", type: TYPE_MAP[w.type ?? ""] ?? "other", sourceType: w.type, title, authors,
    journal: w["container-title"]?.[0] ? stripMarkup(w["container-title"][0]) : undefined,
    year: dp?.[0] ?? undefined, month: dp?.[1] ?? undefined, volume: w.volume, issue: w.issue, pages: w.page, publisher: w.publisher, doi, issn: w.ISSN?.[0], language: w.language,
    // Crossref abstracts arrive as JATS XML; keep the text only.
    abstract: w.abstract ? stripMarkup(w.abstract.replace(/<jats:title>.*?<\/jats:title>/g, "")) : undefined,
    keywords: w.subject, citedBy: w["is-referenced-by-count"], landingUrl: `https://doi.org/${doi}`,
  };
}

export function parseWorks(json: { message?: { "total-results"?: number; items?: CRWork[] } }): { total: number; works: Work[] } {
  const items = json.message?.items ?? [];
  const works = items.map(parseWork).filter((x): x is Work => x !== null);
  return { total: json.message?.["total-results"] ?? works.length, works };
}

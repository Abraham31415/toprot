import { normalizeDoi, normalizePages, parsePersonName, personToLegacy, sanitizeRef, type Person, type Ref, type RefType } from "./model";

/** The database row shape (study_references), including the v2 columns. */
export type RefRow = {
  id?: string;
  identifier_type?: "doi" | "pmid" | "manual";
  doi: string | null;
  pmid: string | null;
  authors: string[];
  title: string;
  journal: string | null;
  year: number | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  work_type?: string | null;
  abstract?: string | null;
  url?: string | null;
  publisher?: string | null;
  issn?: string | null;
  language?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  keywords?: string[] | null;
  source?: string | null;
  openalex_id?: string | null;
  is_open_access?: boolean | null;
  open_access_url?: string | null;
  author_details?: Person[] | null;
  collection_id?: string | null;
};

const REF_TYPES: RefType[] = ["article-journal", "book", "chapter", "report", "thesis", "paper-conference", "webpage", "article", "other"];

export function rowToRef(row: RefRow): Ref {
  const details = Array.isArray(row.author_details) && row.author_details.length ? row.author_details : null;
  const authors = details ?? (row.authors ?? []).map(parsePersonName);
  return sanitizeRef({
    type: (REF_TYPES as string[]).includes(row.work_type ?? "") ? (row.work_type as RefType) : "article-journal",
    title: row.title, authors,
    journal: row.journal ?? undefined, year: row.year ?? undefined, volume: row.volume ?? undefined, issue: row.issue ?? undefined, pages: row.pages ?? undefined,
    doi: row.doi ?? undefined, pmid: row.pmid ?? undefined, url: row.url ?? undefined, abstract: row.abstract ?? undefined,
    publisher: row.publisher ?? undefined, issn: row.issn ?? undefined, language: row.language ?? undefined, notes: row.notes ?? undefined,
    keywords: row.keywords ?? undefined,
  });
}

/** Fields to insert or update. The legacy authors column stays populated so older screens keep working. */
export function refToRowFields(ref: Ref, source: string): Omit<RefRow, "id" | "tags" | "collection_id" | "is_open_access" | "open_access_url" | "openalex_id"> & { identifier_type: "doi" | "pmid" | "manual" } {
  const r = sanitizeRef(ref);
  return {
    identifier_type: r.doi ? "doi" : r.pmid ? "pmid" : "manual",
    doi: r.doi ?? null, pmid: r.pmid ?? null,
    authors: r.authors.map(personToLegacy).filter(Boolean),
    title: r.title, journal: r.journal ?? null, year: r.year ?? null, volume: r.volume ?? null, issue: r.issue ?? null, pages: r.pages ?? null,
    work_type: r.type, abstract: r.abstract ?? null, url: r.url ?? null, publisher: r.publisher ?? null, issn: r.issn ?? null,
    language: r.language ?? null, notes: r.notes ?? null, keywords: r.keywords ?? [], source,
    author_details: r.authors.length ? r.authors : null,
  };
}

export type CslItem = Record<string, unknown>;

/** CSL-JSON for citeproc. Only fields we actually hold are sent; nothing is guessed. */
export function toCslItem(r: Ref, id: string): CslItem {
  const person = (p: Person) => (p.literal ? { literal: p.literal } : { family: p.family ?? "", ...(p.given ? { given: p.given } : {}) });
  const item: CslItem = { id, type: r.type, title: r.title };
  if (r.authors.length) item.author = r.authors.map(person);
  if (r.editors?.length) item.editor = r.editors.map(person);
  if (r.type === "article-journal" || r.type === "article") { if (r.journal) item["container-title"] = r.journal; }
  else if (r.containerTitle) item["container-title"] = r.containerTitle;
  if (r.year) item.issued = { "date-parts": [r.month ? [r.year, r.month] : [r.year]] };
  if (r.volume) item.volume = r.volume;
  if (r.issue) item.issue = r.issue;
  if (r.pages) item.page = normalizePages(r.pages);
  const doi = normalizeDoi(r.doi);
  if (doi) item.DOI = doi;
  if (r.pmid) item.PMID = r.pmid;
  if (r.url) item.URL = r.url;
  if (r.abstract) item.abstract = r.abstract;
  if (r.publisher) item.publisher = r.publisher;
  if (r.issn) item.ISSN = r.issn;
  if (r.language) item.language = r.language;
  return item;
}

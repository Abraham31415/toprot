import type { Person, RefType } from "../refs/model";

export type LitSource = "openalex" | "pubmed" | "crossref";

export const SOURCE_INFO: Record<LitSource, { name: string; blurb: string; url: string; filters: { openAccess: boolean; articleType: boolean; studyType: boolean; journal: boolean; sort: boolean } }> = {
  openalex: { name: "OpenAlex", blurb: "Open index of scholarly works across all fields.", url: "https://openalex.org", filters: { openAccess: true, articleType: true, studyType: false, journal: true, sort: true } },
  pubmed: { name: "PubMed", blurb: "Biomedical literature from the US National Library of Medicine.", url: "https://pubmed.ncbi.nlm.nih.gov", filters: { openAccess: true, articleType: false, studyType: true, journal: true, sort: true } },
  crossref: { name: "Crossref", blurb: "DOI registration agency with publisher-deposited metadata. It ranks by bibliographic similarity, so it is best for finding a known paper and weaker for topic searches.", url: "https://www.crossref.org", filters: { openAccess: false, articleType: true, studyType: false, journal: true, sort: true } },
};

/** One bibliographic record from a source. Fields are present only when the source supplied them. */
export type Work = {
  /** Stable id within a source, for example "openalex:W123" or "pubmed:31234567". */
  id: string;
  source: LitSource;
  type: RefType;
  /** The source's own type label, for example "review" or "journal-article". */
  sourceType?: string;
  title: string;
  authors: Person[];
  /** Total author count when the source truncated the list. */
  authorCount?: number;
  journal?: string;
  year?: number;
  month?: number;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  doi?: string;
  pmid?: string;
  openalexId?: string;
  issn?: string;
  language?: string;
  /** Abstract text only when the source returned one. Never generated. */
  abstract?: string;
  keywords?: string[];
  citedBy?: number;
  /** Where to read the original: the publisher or DOI landing page. */
  landingUrl?: string;
  /** Publication types as labelled by PubMed (for example "Randomized Controlled Trial"). */
  publicationTypes?: string[];
  openAccess?: { isOa: boolean; status?: string; url?: string };
};

export type SortKey = "relevance" | "cited" | "newest";

export type SearchParams = {
  source: LitSource;
  keywords?: string;
  title?: string;
  author?: string;
  journal?: string;
  doi?: string;
  yearFrom?: number;
  yearTo?: number;
  openAccess?: boolean;
  /** OpenAlex and Crossref work type. */
  articleType?: string;
  /** PubMed publication type filter. */
  studyType?: string;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
};

export type SearchResult = {
  source: LitSource;
  total: number;
  page: number;
  pageSize: number;
  works: Work[];
  /** Plain-language notes about how the query was interpreted, shown to the user. */
  notes: string[];
};

export class LiteratureError extends Error {
  constructor(message: string, public status: number = 502, public retryAfter?: number) {
    super(message);
  }
}

export const ARTICLE_TYPES = {
  openalex: [["article", "Journal article"], ["review", "Review article"], ["preprint", "Preprint"], ["book-chapter", "Book chapter"], ["book", "Book"], ["dissertation", "Thesis"]],
  crossref: [["journal-article", "Journal article"], ["posted-content", "Preprint"], ["book-chapter", "Book chapter"], ["book", "Book"], ["proceedings-article", "Conference paper"], ["dissertation", "Thesis"]],
} as const;

/** PubMed publication types that PubMed assigns itself, so they are reliable as study-type filters. */
export const PUBMED_STUDY_TYPES = [
  ["Randomized Controlled Trial", "Randomized controlled trial"],
  ["Clinical Trial", "Clinical trial"],
  ["Systematic Review", "Systematic review"],
  ["Meta-Analysis", "Meta-analysis"],
  ["Review", "Review"],
  ["Observational Study", "Observational study"],
  ["Case Reports", "Case report"],
  ["Practice Guideline", "Guideline"],
] as const;

export const clampPage = (n: unknown, min: number, max: number, dflt: number) => {
  const v = typeof n === "number" ? n : parseInt(String(n ?? ""), 10);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : dflt;
};

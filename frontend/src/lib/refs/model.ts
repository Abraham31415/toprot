// A source-neutral bibliographic record. Everything that reads or writes references (RIS, BibTeX,
// EndNote XML, CSL, the literature sources and the database) goes through this shape so fields are
// never lost or invented in translation.

export type Person = { family?: string; given?: string; literal?: string };

export type RefType = "article-journal" | "book" | "chapter" | "report" | "thesis" | "paper-conference" | "webpage" | "article" | "other";

export type Ref = {
  type: RefType;
  title: string;
  authors: Person[];
  editors?: Person[];
  journal?: string;
  /** Book title for a chapter, or proceedings title. */
  containerTitle?: string;
  year?: number;
  month?: number;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  doi?: string;
  pmid?: string;
  url?: string;
  abstract?: string;
  keywords?: string[];
  issn?: string;
  language?: string;
  notes?: string;
};

const initialsOf = (g: string) => g.split(/[\s.\-]+/).filter(Boolean).map((p) => p[0].toUpperCase());

/** "Smith, John A." / "Smith JA" / "John A. Smith" -> Person. Never invents a given name. */
/** Words that mark a name as an organisation, so it is kept whole instead of split into given and family names. */
const CORPORATE = /\b(organi[sz]ation|association|institute|university|college|committee|ministry|council|society|group|collaborat(?:ion|ive|ors)|network|agency|foundation|department|authority|consortium|commission|federation|hospital|centre|center|board|team|study)\b/i;

export function parsePersonName(raw: string): Person {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return {};
  if (!s.includes(",") && CORPORATE.test(s) && s.split(" ").length >= 2) return { literal: s };
  if (s.includes(",")) {
    const [family, ...rest] = s.split(",");
    const given = rest.join(",").trim();
    return given ? { family: family.trim(), given } : { family: family.trim() };
  }
  const parts = s.split(" ");
  if (parts.length === 1) return { literal: s };
  const last = parts[parts.length - 1];
  // "Smith JA": trailing run of capital letters is initials (PubMed style).
  if (/^[A-Z]{1,4}$/.test(last) && parts.length >= 2) return { family: parts.slice(0, -1).join(" "), given: initialsOf(last.split("").join(" ")).join(" ") };
  // "John A. Smith": last word is the family name.
  return { family: last, given: parts.slice(0, -1).join(" ") };
}

export const personToString = (p: Person): string => p.literal ?? [p.family, p.given].filter(Boolean).join(", ");

/** PubMed-style "Smith JA" for storage in the legacy authors column. */
export function personToLegacy(p: Person): string {
  if (p.literal) return p.literal;
  const initials = p.given ? initialsOf(p.given).join("") : "";
  return [p.family, initials].filter(Boolean).join(" ");
}

export const normalizeDoi = (d: string | undefined | null): string | undefined => {
  if (!d) return undefined;
  const c = d.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").replace(/[\s.,;]+$/, "");
  return /^10\.\d{4,9}\/\S+$/.test(c) ? c.toLowerCase() : undefined;
};

export const stripMarkup = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

/** "45-67", "45--67" and "45–67" are one range; keep an e-locator like "e1234" unchanged. */
export const normalizePages = (p: string | undefined) => (p ? p.trim().replace(/\s*(--|—|–|-)\s*/g, "–") : undefined);

export function sanitizeRef(r: Ref): Ref {
  const out: Ref = { ...r, title: stripMarkup(r.title ?? ""), authors: (r.authors ?? []).filter((a) => a.family || a.literal) };
  if (out.journal) out.journal = stripMarkup(out.journal);
  out.doi = normalizeDoi(out.doi);
  if (out.pmid && !/^\d{1,9}$/.test(out.pmid)) out.pmid = undefined;
  out.pages = normalizePages(out.pages);
  if (out.year != null && (!Number.isInteger(out.year) || out.year < 1000 || out.year > 2200)) out.year = undefined;
  if (out.month != null && (!Number.isInteger(out.month) || out.month < 1 || out.month > 12)) out.month = undefined;
  return out;
}

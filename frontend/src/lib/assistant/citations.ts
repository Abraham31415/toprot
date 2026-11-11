// The assistant must never fabricate scientific references. Anything citation-shaped in its prose (a DOI, a PMID, or an
// author-year reference) is checked against the references the user has actually saved; whatever is not there is removed
// from the text and reported. Real references reach the user only through the structured `sources` list, which is
// resolved from the database, never from the model's wording.

export type KnownRef = { id: string; doi?: string | null; pmid?: string | null; families: string[]; year?: number | null };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const normDoi = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/[.,;:)\]}>"']+$/, "");

export const REDACTED_DOI = "[DOI not in your library]";
export const REDACTED_CITATION = "[citation not in your library]";

// Words that look like a surname followed by a year but are not citations.
const NOT_NAMES = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "phase", "table", "figure", "fig", "version", "section", "appendix",
  "wave", "round", "year", "day", "week", "stage", "since", "until", "before", "after", "during", "between", "from", "in", "by", "of", "to", "uganda", "kenya",
  "tanzania", "africa", "europe", "asia", "america", "who", "cdc", "fy", "q1", "q2", "q3", "q4", "version", "release", "edition", "cohort", "census", "survey",
]);

const DOI_RE = /\b10\.\d{4,9}\/[^\s"<>\]\[{}|\\^`]+/gi;
const PMID_RE = /\bPMID:?\s*(\d{5,9})\b/gi;
const NAME = "[A-Z][\\p{L}'’-]{1,30}";
// "Smith et al., 2020", "Smith and Jones (2020)", "(Smith, 2020a)", "Smith 2020" inside parentheses.
const ITEM_RE = new RegExp(`(${NAME})((?: et al\\.?)|(?: (?:and|&) ${NAME}))?,?\\s+(?:\\(((?:19|20)\\d{2})[a-z]?\\)|((?:19|20)\\d{2})[a-z]?)`, "gu");

export function redactUnverifiedCitations(text: string, known: KnownRef[]): { text: string; removed: string[] } {
  const removed: string[] = [];
  const dois = new Set(known.map((k) => (k.doi ? normDoi(k.doi) : "")).filter(Boolean));
  const pmids = new Set(known.map((k) => (k.pmid ?? "").trim()).filter(Boolean));

  let out = text.replace(DOI_RE, (m) => {
    const d = normDoi(m);
    if (dois.has(d)) return m;
    removed.push(d);
    return REDACTED_DOI;
  });
  out = out.replace(PMID_RE, (m, id: string) => {
    if (pmids.has(id)) return m;
    removed.push(`PMID ${id}`);
    return REDACTED_CITATION;
  });

  out = out.replace(ITEM_RE, (match: string, name: string, extra: string | undefined, yearParen: string | undefined, yearBare: string | undefined, offset: number, whole: string) => {
    const year = (yearParen ?? yearBare) as string;
    const first = fold(name);
    if (!first || NOT_NAMES.has(first)) return match;
    const before = whole[offset - 1] ?? "";
    const hasCitationShape = !!extra || match.includes("(") || match.includes(",") || before === "(" || before === ";";
    if (!hasCitationShape) return match;
    const second = extra && /(?:and|&)/.test(extra) ? fold(extra.replace(/^\s*(?:and|&)\s+/, "")) : "";
    const y = Number(year);
    const ok = known.some((k) => k.year === y && k.families.some((f) => fold(f) === first || (second && fold(f) === second)));
    if (ok) return match;
    removed.push(match.trim().replace(/^[(;\s]+|[)\s]+$/g, ""));
    return REDACTED_CITATION;
  });

  return { text: out, removed: [...new Set(removed)] };
}

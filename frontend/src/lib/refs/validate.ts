import { personToLegacy, normalizeDoi, normalizePages, type Person, type RefType } from "./model";

const REF_TYPES: RefType[] = ["article-journal", "book", "chapter", "report", "thesis", "paper-conference", "webpage", "article", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Tags are short labels: trimmed, 1 to 40 characters, no commas, no repeats (ignoring case), at most 30. */
export function cleanTags(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    if (typeof t !== "string") continue;
    const v = t.replace(/[,\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
    if (out.length >= 30) break;
  }
  return out;
}

export function cleanCollectionName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const n = v.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return n.length >= 1 && n.length <= 80 ? n : null;
}

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw new Error("A field has the wrong type.");
  if (v.length > max) throw new Error(`A field is longer than ${max} characters.`);
  return v.trim() || null;
};

export type RefPatch = Partial<{
  title: string; authors: Person[]; journal: string; year: number; volume: string; issue: string; pages: string; publisher: string; doi: string; pmid: string; url: string;
  abstract: string; keywords: string[]; notes: string; work_type: string; language: string; issn: string; tags: string[]; collection_id: string | null;
}>;

/** Validate an edit before it reaches the database. Returns the columns to update, or an error to show the user. */
export function cleanPatch(p: unknown): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  if (!p || typeof p !== "object") return { ok: false, error: "Nothing to save." };
  const x = p as Record<string, unknown>;
  const f: Record<string, unknown> = {};
  try {
    if ("title" in x) { const t = text(x.title, 500); if (!t) return { ok: false, error: "A reference needs a title." }; f.title = t; }
    for (const k of ["journal", "volume", "issue", "publisher", "language"] as const) if (k in x) f[k] = text(x[k], k === "journal" || k === "publisher" ? 300 : 60);
    if ("pages" in x) { const v = text(x.pages, 60); f.pages = v ? normalizePages(v) : null; }
    if ("year" in x) {
      if (x.year === null || x.year === "") f.year = null;
      else { const y = Number(x.year); if (!Number.isInteger(y) || y < 1000 || y > 2200) return { ok: false, error: "The year must be a four-digit year." }; f.year = y; }
    }
    if ("doi" in x) { const v = text(x.doi, 200); if (v) { const d = normalizeDoi(v); if (!d) return { ok: false, error: "That DOI is not in a recognised form (10.xxxx/...)." }; f.doi = d; } else f.doi = null; }
    if ("pmid" in x) { const v = text(x.pmid, 20); if (v && !/^\d{1,9}$/.test(v)) return { ok: false, error: "A PubMed ID is digits only." }; f.pmid = v ?? null; }
    if ("url" in x) { const v = text(x.url, 500); if (v && !/^https?:\/\/[^\s]+$/i.test(v)) return { ok: false, error: "A link must start with http:// or https://." }; f.url = v ?? null; }
    if ("issn" in x) { const v = text(x.issn, 20); if (v && !/^\d{4}-\d{3}[\dXx]$/.test(v)) return { ok: false, error: "An ISSN looks like 1234-567X." }; f.issn = v ?? null; }
    if ("abstract" in x) f.abstract = text(x.abstract, 20000);
    if ("notes" in x) f.notes = text(x.notes, 5000);
    if ("work_type" in x) { if (!REF_TYPES.includes(x.work_type as RefType)) return { ok: false, error: "Unknown reference type." }; f.work_type = x.work_type; }
    if ("keywords" in x) { if (!Array.isArray(x.keywords)) return { ok: false, error: "Keywords must be a list." }; f.keywords = x.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim().slice(0, 60)).filter(Boolean).slice(0, 50); }
    if ("tags" in x) f.tags = cleanTags(x.tags);
    if ("collection_id" in x) { if (x.collection_id !== null && !isUuid(x.collection_id)) return { ok: false, error: "Unknown collection." }; f.collection_id = x.collection_id; }
    if ("authors" in x) {
      if (!Array.isArray(x.authors) || x.authors.length > 100) return { ok: false, error: "Too many authors." };
      const people: Person[] = [];
      for (const a of x.authors as Person[]) {
        const family = typeof a?.family === "string" ? a.family.trim().slice(0, 100) : "", given = typeof a?.given === "string" ? a.given.trim().slice(0, 100) : "", literal = typeof a?.literal === "string" ? a.literal.trim().slice(0, 200) : "";
        if (literal) people.push({ literal }); else if (family) people.push(given ? { family, given } : { family });
      }
      f.author_details = people.length ? people : null;
      f.authors = people.map(personToLegacy);
    }
  } catch (e) { return { ok: false, error: (e as Error).message }; }
  if (!Object.keys(f).length) return { ok: false, error: "Nothing to save." };
  f.updated_at = new Date().toISOString();
  return { ok: true, fields: f };
}

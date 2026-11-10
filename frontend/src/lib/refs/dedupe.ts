import { normalizeDoi, type Ref } from "./model";

export type DupGroup = { indexes: number[]; reason: "doi" | "pmid" | "title"; confidence: "exact" | "likely" };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export const normTitle = (t: string) => fold(t).replace(/^(the|a|an) /, "");

const bigrams = (s: string): Map<string, number> => {
  const m = new Map<string, number>();
  const t = s.replace(/ /g, "");
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
};

/** Sorensen-Dice similarity of two normalised titles, from 0 to 1. */
export function titleSimilarity(a: string, b: string): number {
  const x = normTitle(a), y = normTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x), B = bigrams(y);
  let inter = 0, total = 0;
  for (const [g, n] of A) { inter += Math.min(n, B.get(g) ?? 0); total += n; }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

const firstFamily = (r: Ref) => fold(r.authors[0]?.family ?? r.authors[0]?.literal ?? "");

/**
 * Find references that are probably the same work. An identical DOI or PMID is exact. Otherwise a very
 * similar title (0.92 or more) with the same year (within one year, since online and print years differ)
 * and the same first author is flagged as likely. Likely groups are suggestions for the user to confirm.
 */
export function findDuplicates(refs: Ref[]): DupGroup[] {
  const parent = refs.map((_, i) => i);
  const reasonOf = new Map<number, DupGroup["reason"]>();
  const confOf = new Map<number, DupGroup["confidence"]>();
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number, reason: DupGroup["reason"], conf: DupGroup["confidence"]) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    parent[rb] = ra;
    const strongest = conf === "exact" || confOf.get(ra) === "exact" || confOf.get(rb) === "exact" ? "exact" : "likely";
    confOf.set(ra, strongest);
    if (!reasonOf.has(ra) || conf === "exact") reasonOf.set(ra, reason);
  };
  const byDoi = new Map<string, number>(), byPmid = new Map<string, number>();
  refs.forEach((r, i) => {
    const d = normalizeDoi(r.doi);
    if (d) { if (byDoi.has(d)) union(byDoi.get(d)!, i, "doi", "exact"); else byDoi.set(d, i); }
    if (r.pmid) { if (byPmid.has(r.pmid)) union(byPmid.get(r.pmid)!, i, "pmid", "exact"); else byPmid.set(r.pmid, i); }
  });
  // Title comparison, bucketed by the first 12 letters of the normalised title to avoid comparing every pair.
  const buckets = new Map<string, number[]>();
  refs.forEach((r, i) => { const k = normTitle(r.title).replace(/ /g, "").slice(0, 8); if (k) (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(i); });
  for (const idxs of buckets.values()) {
    for (let a = 0; a < idxs.length; a++) for (let b = a + 1; b < idxs.length; b++) {
      const x = refs[idxs[a]], y = refs[idxs[b]];
      if (find(idxs[a]) === find(idxs[b])) continue;
      const dx = normalizeDoi(x.doi), dy = normalizeDoi(y.doi);
      if (dx && dy && dx !== dy) continue; // different DOIs: different works (for example a paper and its correction)
      if (titleSimilarity(x.title, y.title) < 0.92) continue;
      if (x.year != null && y.year != null && Math.abs(x.year - y.year) > 1) continue;
      if (firstFamily(x) && firstFamily(y) && firstFamily(x) !== firstFamily(y)) continue;
      union(idxs[a], idxs[b], "title", "likely");
    }
  }
  const groups = new Map<number, number[]>();
  refs.forEach((_, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(i); });
  return [...groups.entries()].filter(([, v]) => v.length > 1).map(([root, indexes]) => ({ indexes: indexes.sort((a, b) => a - b), reason: reasonOf.get(root) ?? "title", confidence: confOf.get(root) ?? "likely" }));
}

const richness = (r: Ref) => [r.doi, r.pmid, r.abstract, r.journal, r.volume, r.issue, r.pages, r.year, r.url, r.publisher, r.issn].filter((v) => v != null && v !== "").length + (r.authors.length ? 1 : 0) + (r.keywords?.length ? 1 : 0);

/** Merge duplicates into the richest record, filling its blanks from the others. Never overwrites a value. */
export function mergeRefs(refs: Ref[]): Ref {
  const sorted = [...refs].sort((a, b) => richness(b) - richness(a));
  const out: Ref = { ...sorted[0], authors: [...sorted[0].authors] };
  for (const r of sorted.slice(1)) {
    for (const k of ["journal", "containerTitle", "year", "month", "volume", "issue", "pages", "publisher", "doi", "pmid", "url", "abstract", "issn", "language", "notes"] as const) {
      if (out[k] == null || out[k] === "") (out as Record<string, unknown>)[k] = r[k];
    }
    if (!out.authors.length && r.authors.length) out.authors = r.authors;
    const kw = new Set([...(out.keywords ?? []), ...(r.keywords ?? [])]);
    if (kw.size) out.keywords = [...kw];
  }
  return out;
}

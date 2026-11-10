import { normalizeDoi, parsePersonName, stripMarkup } from "../refs/model";
import { PUBMED_STUDY_TYPES, clampPage, type SearchParams, type Work } from "./types";

export const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/** Remove characters that PubMed treats as query syntax so user text is searched as plain words. */
const plain = (s: string) => s.replace(/["\[\]()*:]/g, " ").replace(/\s+/g, " ").trim();

const SORT = { relevance: "relevance", cited: "relevance", newest: "pub_date" } as const;

export function buildTerm(p: SearchParams): { term: string; notes: string[] } {
  const parts: string[] = [];
  const notes: string[] = [];
  const doi = normalizeDoi(p.doi);
  if (p.doi?.trim() && !doi) notes.push("The DOI was not in a recognised form (10.xxxx/...), so it was ignored.");
  if (doi) parts.push(`"${doi}"[AID]`);
  if (p.keywords?.trim()) parts.push(`(${plain(p.keywords)})`);
  if (p.title?.trim()) parts.push(`(${plain(p.title)})[Title]`);
  if (p.author?.trim()) { parts.push(`(${plain(p.author)})[Author]`); notes.push("PubMed author search works best as 'Surname Initials', for example 'Black JA'."); }
  if (p.journal?.trim()) parts.push(`(${plain(p.journal)})[Journal]`);
  if (p.yearFrom || p.yearTo) parts.push(`${p.yearFrom ?? 1000}:${p.yearTo ?? 3000}[dp]`);
  if (p.openAccess) parts.push("free full text[sb]");
  if (p.studyType) {
    const known = PUBMED_STUDY_TYPES.find(([v]) => v === p.studyType);
    if (known) parts.push(`"${known[0]}"[pt]`);
  }
  if (p.sort === "cited") notes.push("PubMed cannot sort by citation count, so results are shown by relevance.");
  return { term: parts.join(" AND "), notes };
}

export function buildEsearchUrl(p: SearchParams, apiKey?: string): { url: string; notes: string[] } | null {
  const { term, notes } = buildTerm(p);
  if (!term) return null;
  const size = clampPage(p.pageSize, 1, 25, 20);
  const q = new URLSearchParams({
    db: "pubmed", retmode: "json", term, retmax: String(size), retstart: String((clampPage(p.page, 1, 400, 1) - 1) * size),
    sort: SORT[p.sort ?? "relevance"], tool: "toprot",
  });
  if (apiKey) q.set("api_key", apiKey);
  return { url: `${EUTILS}/esearch.fcgi?${q.toString()}`, notes };
}

export const buildEsummaryUrl = (ids: string[], apiKey?: string) => {
  const q = new URLSearchParams({ db: "pubmed", retmode: "json", id: ids.join(","), tool: "toprot" });
  if (apiKey) q.set("api_key", apiKey);
  return `${EUTILS}/esummary.fcgi?${q.toString()}`;
};

export const buildEfetchUrl = (id: string, apiKey?: string) => {
  const q = new URLSearchParams({ db: "pubmed", retmode: "xml", rettype: "abstract", id, tool: "toprot" });
  if (apiKey) q.set("api_key", apiKey);
  return `${EUTILS}/efetch.fcgi?${q.toString()}`;
};

export const parseEsearch = (json: { esearchresult?: { count?: string; idlist?: string[]; ERROR?: string; errorlist?: unknown } }) => ({
  total: parseInt(json.esearchresult?.count ?? "0", 10) || 0,
  ids: json.esearchresult?.idlist ?? [],
  error: json.esearchresult?.ERROR,
});

type PMDoc = {
  uid?: string; error?: string; title?: string; fulljournalname?: string; source?: string; pubdate?: string; epubdate?: string; volume?: string; issue?: string; pages?: string;
  authors?: { name?: string; authtype?: string }[]; articleids?: { idtype?: string; value?: string }[]; pubtype?: string[]; lang?: string[]; elocationid?: string; issn?: string; essn?: string;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseDoc(d: PMDoc): Work | null {
  const title = stripMarkup(d.title ?? "");
  if (!d.uid || d.error || !title) return null;
  const ids = d.articleids ?? [];
  const doi = normalizeDoi(ids.find((i) => i.idtype === "doi")?.value) ?? normalizeDoi(/^doi:\s*(\S+)/i.exec(d.elocationid ?? "")?.[1]);
  const pmc = ids.find((i) => i.idtype === "pmc")?.value;
  const dm = /^(\d{4})(?:\s+([A-Za-z]{3}))?/.exec(d.pubdate ?? d.epubdate ?? "");
  const month = dm?.[2] ? MONTHS.indexOf(dm[2].toLowerCase()) + 1 || undefined : undefined;
  return {
    id: `pubmed:${d.uid}`, source: "pubmed", type: "article-journal", sourceType: d.pubtype?.[0], title: title.replace(/\.$/, ""),
    authors: (d.authors ?? []).filter((a) => !a.authtype || a.authtype === "Author").map((a) => parsePersonName(a.name ?? "")).filter((p) => p.family || p.literal),
    journal: d.fulljournalname ?? d.source, year: dm ? parseInt(dm[1], 10) : undefined, month, volume: d.volume || undefined, issue: d.issue || undefined, pages: d.pages || undefined,
    doi, pmid: d.uid, issn: d.issn || d.essn || undefined, language: d.lang?.[0],
    publicationTypes: d.pubtype, landingUrl: `https://pubmed.ncbi.nlm.nih.gov/${d.uid}/`,
    // PubMed marks a free full text copy with a PMC id. That link is an actual full-text location.
    openAccess: pmc ? { isOa: true, status: "pmc", url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmc}/` } : undefined,
  };
}

export function parseEsummary(json: { result?: Record<string, unknown> & { uids?: string[] } }, orderedIds: string[]): Work[] {
  const r = json.result ?? {};
  return orderedIds.map((id) => parseDoc(r[id] as PMDoc)).filter((x): x is Work => x !== null);
}

/** Pull the abstract text from an efetch XML record, keeping section labels. Returns undefined when there is none. */
export function parseEfetchAbstract(xml: string): string | undefined {
  const blocks = [...xml.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)];
  if (!blocks.length) return undefined;
  const text = blocks.map(([, attrs, body]) => {
    const label = /Label="([^"]*)"/.exec(attrs)?.[1];
    const t = stripMarkup(body);
    return label ? `${label.charAt(0) + label.slice(1).toLowerCase()}: ${t}` : t;
  }).join("\n");
  return text.trim() || undefined;
}

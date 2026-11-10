import { normalizePages, parsePersonName, personToString, sanitizeRef, type Person, type Ref, type RefType } from "./model";

const TYPE_IN: Record<string, RefType> = {
  JOUR: "article-journal", JFULL: "article-journal", EJOUR: "article-journal", MGZN: "article-journal", NEWS: "article",
  BOOK: "book", EBOOK: "book", CHAP: "chapter", ECHAP: "chapter", RPRT: "report", THES: "thesis",
  CONF: "paper-conference", CPAPER: "paper-conference", ELEC: "webpage", WEB: "webpage", GEN: "other",
};
const TYPE_OUT: Record<RefType, string> = {
  "article-journal": "JOUR", book: "BOOK", chapter: "CHAP", report: "RPRT", thesis: "THES", "paper-conference": "CPAPER", webpage: "ELEC", article: "NEWS", other: "GEN",
};

/** Parse RIS text (PubMed, Scopus, EndNote, Zotero and Mendeley exports). Entries without a title are skipped with a warning. */
export function parseRis(text: string): { refs: Ref[]; warnings: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const refs: Ref[] = [];
  const warnings: string[] = [];
  let cur: { tags: [string, string][] } | null = null;
  const flush = () => {
    if (!cur) return;
    const r = fromTags(cur.tags);
    if (r) refs.push(r);
    else warnings.push(`Skipped record ${refs.length + warnings.length + 1}: it has no title.`);
    cur = null;
  };
  for (const raw of lines) {
    const m = /^([A-Z][A-Z0-9])  - ?(.*)$/.exec(raw);
    if (m) {
      const [, tag, value] = m;
      if (tag === "TY") { flush(); cur = { tags: [["TY", value.trim()]] }; continue; }
      if (tag === "ER") { flush(); continue; }
      if (!cur) cur = { tags: [] };
      cur.tags.push([tag, value.trim()]);
    } else if (cur && raw.trim() && cur.tags.length) {
      // Continuation of the previous value (long abstracts and titles are wrapped by some exporters).
      const last = cur.tags[cur.tags.length - 1];
      last[1] = `${last[1]} ${raw.trim()}`.trim();
    }
  }
  flush();
  return { refs, warnings };
}

function fromTags(tags: [string, string][]): Ref | null {
  const first = (...names: string[]) => { for (const n of names) { const t = tags.find(([k, v]) => k === n && v); if (t) return t[1]; } return undefined; };
  const all = (...names: string[]) => tags.filter(([k, v]) => names.includes(k) && v).map(([, v]) => v);
  const type = TYPE_IN[(first("TY") ?? "").toUpperCase()] ?? "other";
  const title = first("TI", "T1", "CT") ?? (type === "chapter" ? undefined : undefined);
  if (!title) return null;
  const dateRaw = first("PY", "Y1", "DA") ?? "";
  const dm = /^(\d{4})(?:[/-](\d{1,2}))?/.exec(dateRaw.trim()) ?? /(\d{4})/.exec(dateRaw);
  // PY often carries only the year while DA carries the full date; take the month from DA when the years agree.
  const da = /^(\d{4})[/-](\d{1,2})/.exec((first("DA") ?? "").trim());
  const month = dm?.[2] ? parseInt(dm[2], 10) : da && dm && da[1] === dm[1] ? parseInt(da[2], 10) : undefined;
  const sp = first("SP"), ep = first("EP");
  const sn = first("SN");
  const db = (first("DB") ?? "").toLowerCase();
  const an = first("AN");
  const ref: Ref = {
    type,
    title,
    authors: all("AU", "A1").map(parsePersonName),
    editors: all("A2", "ED").map(parsePersonName),
    journal: type === "chapter" || type === "book" ? undefined : first("JO", "JF", "T2", "JA"),
    containerTitle: type === "chapter" || type === "paper-conference" ? first("T2", "BT") : undefined,
    year: dm ? parseInt(dm[1], 10) : undefined,
    month,
    volume: first("VL"), issue: first("IS"),
    pages: sp ? (ep ? `${sp}-${ep}` : sp) : undefined,
    doi: first("DO"),
    pmid: /medline|pubmed/.test(db) && an && /^\d+$/.test(an.trim()) ? an.trim() : undefined,
    url: first("UR", "L1", "L2"),
    abstract: first("AB", "N2"),
    keywords: all("KW"),
    issn: sn && /^\d{4}-\d{3}[\dXx]$/.test(sn.trim()) ? sn.trim() : undefined,
    language: first("LA"),
    publisher: first("PB"),
    notes: first("N1"),
  };
  if (!ref.editors?.length) delete ref.editors;
  return sanitizeRef(ref);
}

export function writeRis(refs: Ref[]): string {
  const out: string[] = [];
  const line = (tag: string, v: string | number | undefined) => { if (v !== undefined && v !== "") out.push(`${tag}  - ${String(v).replace(/\r?\n/g, " ")}`); };
  const name = (p: Person) => p.literal ?? personToString(p);
  for (const r of refs) {
    line("TY", TYPE_OUT[r.type]);
    r.authors.forEach((a) => line("AU", name(a)));
    r.editors?.forEach((a) => line("A2", name(a)));
    line("TI", r.title);
    if (r.type === "article-journal" || r.type === "article") line("JO", r.journal);
    else if (r.containerTitle) line("T2", r.containerTitle);
    line("PY", r.year);
    if (r.year && r.month) line("DA", `${r.year}/${String(r.month).padStart(2, "0")}`);
    line("VL", r.volume); line("IS", r.issue);
    if (r.pages) { const [s, e] = normalizePages(r.pages)!.split("–"); line("SP", s); line("EP", e); }
    line("DO", r.doi); line("UR", r.url); line("AB", r.abstract);
    r.keywords?.forEach((k) => line("KW", k));
    line("PB", r.publisher); line("SN", r.issn); line("LA", r.language); line("N1", r.notes);
    if (r.pmid) { line("AN", r.pmid); line("DB", "PubMed"); }
    out.push("ER  - ", "");
  }
  return out.join("\r\n");
}

import { toCsv } from "../builders/instruments";
import { personToString, type Person, type Ref } from "../refs/model";
import type { Work } from "./types";

/** A Work from a literature source as a plain reference record. Only fields the source supplied are carried over. */
export function workToRef(w: Work): Ref {
  return {
    type: w.type, title: w.title, authors: w.authors, journal: w.journal, year: w.year, month: w.month, volume: w.volume, issue: w.issue, pages: w.pages,
    publisher: w.publisher, doi: w.doi, pmid: w.pmid, url: w.landingUrl, abstract: w.abstract, keywords: w.keywords, issn: w.issn, language: w.language,
  };
}

const name = (p: Person) => p.literal ?? p.family ?? "";

/** "Smith 2020", "Smith and Jones 2020" or "Smith et al. 2020" for table row labels. */
export function shortCitation(authors: Person[], year?: number): string {
  const f = authors.map(name).filter(Boolean);
  const who = f.length === 0 ? "Anonymous" : f.length === 1 ? f[0] : f.length === 2 ? `${f[0]} and ${f[1]}` : `${f[0]} et al.`;
  return year ? `${who} ${year}` : who;
}

export function worksToCsv(works: Work[]): string {
  return toCsv(
    ["title", "authors", "journal", "year", "volume", "issue", "pages", "doi", "pmid", "type", "source", "open_access", "link"],
    works.map((w) => [w.title, w.authors.map(personToString).join("; "), w.journal ?? "", String(w.year ?? ""), w.volume ?? "", w.issue ?? "", w.pages ?? "", w.doi ?? "", w.pmid ?? "", w.sourceType ?? "", w.source, w.openAccess ? (w.openAccess.isOa ? "yes" : "no") : "unknown", w.landingUrl ?? ""]),
  );
}

export const EVIDENCE_COLUMNS = [
  { id: "design", label: "Study design" },
  { id: "population", label: "Population and setting" },
  { id: "exposure", label: "Intervention or exposure" },
  { id: "outcome", label: "Outcomes measured" },
  { id: "findings", label: "Main findings" },
  { id: "limitations", label: "Limitations" },
  { id: "notes", label: "Notes" },
] as const;

export type EvidenceRow = { workId: string; study: string; title: string; journal: string; year: string; link: string } & Record<(typeof EVIDENCE_COLUMNS)[number]["id"], string>;

/**
 * Start an evidence-table row from a record. Only bibliographic facts are filled in. PubMed's own
 * publication type is offered as a design hint; everything else is left for the researcher to complete.
 */
export function evidenceRowFor(w: Work): EvidenceRow {
  const design = w.publicationTypes?.filter((t) => !/^(Journal Article|Research Support|English Abstract)/i.test(t)).join("; ") ?? "";
  return { workId: w.id, study: shortCitation(w.authors, w.year), title: w.title, journal: w.journal ?? "", year: String(w.year ?? ""), link: w.landingUrl ?? "", design, population: "", exposure: "", outcome: "", findings: "", limitations: "", notes: "" };
}

export function evidenceCsv(rows: EvidenceRow[]): string {
  return toCsv(["Study", "Title", "Journal", "Year", "Link", ...EVIDENCE_COLUMNS.map((c) => c.label)], rows.map((r) => [r.study, r.title, r.journal, r.year, r.link, ...EVIDENCE_COLUMNS.map((c) => r[c.id])]));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A landscape HTML table that Word opens as a document when saved with a .doc extension. */
export function evidenceDoc(rows: EvidenceRow[], title: string): string {
  const head = ["Study", "Journal", "Year", ...EVIDENCE_COLUMNS.map((c) => c.label)];
  const body = rows.map((r) => `<tr>${[r.study, r.journal, r.year, ...EVIDENCE_COLUMNS.map((c) => r[c.id])].map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
  return `<html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:landscape}body{font-family:Calibri,Arial,sans-serif;font-size:10pt}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px;vertical-align:top}</style></head><body><h1>${esc(title)}</h1><table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${body}</table></body></html>`;
}

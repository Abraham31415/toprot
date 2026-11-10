import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { normalizePages, parsePersonName, personToString, sanitizeRef, type Person, type Ref, type RefType } from "./model";

// EndNote XML is exchanged as a file. EndNote's own online APIs are restricted, so this is file interchange only.

const TYPE_IN: Record<number, RefType> = { 17: "article-journal", 6: "book", 5: "chapter", 27: "report", 32: "thesis", 47: "paper-conference", 10: "paper-conference", 12: "webpage", 23: "article", 13: "article" };
const TYPE_OUT: Record<RefType, [number, string]> = {
  "article-journal": [17, "Journal Article"], book: [6, "Book"], chapter: [5, "Book Section"], report: [27, "Report"], thesis: [32, "Thesis"],
  "paper-conference": [47, "Conference Paper"], webpage: [12, "Web Page"], article: [23, "Newspaper Article"], other: [13, "Generic"],
};

/** Collect the text of a node, including text wrapped in <style> elements that EndNote adds. */
function text(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    let s = "";
    if ("#text" in o) s += text(o["#text"]);
    if ("style" in o) s += text(o.style);
    return s;
  }
  return "";
}
const list = (node: unknown): unknown[] => (node == null ? [] : Array.isArray(node) ? node : [node]);
const decodeNumeric = (s: string) =>
  s.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)));
const clean = (s: string) => decodeNumeric(s).replace(/\s+/g, " ").trim();

export function parseEndnoteXml(xml: string): { refs: Ref[]; warnings: string[] } {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true, processEntities: true, parseTagValue: false });
  let doc: Record<string, unknown>;
  try { doc = parser.parse(xml.replace(/^﻿/, "")); } catch { return { refs: [], warnings: ["The file is not valid XML."] }; }
  const root = (doc.xml ?? doc) as Record<string, unknown>;
  const records = list((root.records as Record<string, unknown> | undefined)?.record);
  const refs: Ref[] = [];
  const warnings: string[] = [];
  records.forEach((rec, idx) => {
    const r = rec as Record<string, unknown>;
    const titles = (r.titles ?? {}) as Record<string, unknown>;
    const title = clean(text(titles.title));
    if (!title) { warnings.push(`Skipped record ${idx + 1}: it has no title.`); return; }
    const rt = r["ref-type"] as Record<string, unknown> | string | undefined;
    const num = typeof rt === "object" ? parseInt(String((rt as Record<string, unknown>)["#text"] ?? (rt as Record<string, unknown>)["@_name"] ?? ""), 10) : parseInt(String(rt ?? ""), 10);
    const type = TYPE_IN[num] ?? "other";
    const contributors = (r.contributors ?? {}) as Record<string, unknown>;
    const authors = list((contributors.authors as Record<string, unknown> | undefined)?.author).map((a) => parsePersonName(clean(text(a)))).filter((p) => p.family || p.literal);
    const editors = list((contributors["secondary-authors"] as Record<string, unknown> | undefined)?.author).map((a) => parsePersonName(clean(text(a)))).filter((p) => p.family || p.literal);
    const secondary = clean(text(titles["secondary-title"]));
    const periodical = (r.periodical ?? {}) as Record<string, unknown>;
    const journal = clean(text(periodical["full-title"])) || (type === "article-journal" ? secondary : "");
    const dates = (r.dates ?? {}) as Record<string, unknown>;
    const yearRaw = clean(text(dates.year));
    const urls = ((r.urls ?? {}) as Record<string, unknown>)["related-urls"] as Record<string, unknown> | undefined;
    const db = clean(text(r["remote-database-name"])).toLowerCase();
    const acc = clean(text(r["accession-num"]));
    const isbn = clean(text(r.isbn));
    const ref: Ref = {
      type, title, authors, editors: editors.length ? editors : undefined,
      journal: journal || undefined,
      containerTitle: type === "chapter" || type === "paper-conference" ? secondary || undefined : undefined,
      year: /^\d{4}$/.test(yearRaw.slice(0, 4)) ? parseInt(yearRaw.slice(0, 4), 10) : undefined,
      volume: clean(text(r.volume)) || undefined, issue: clean(text(r.number)) || undefined, pages: clean(text(r.pages)) || undefined,
      publisher: clean(text(r.publisher)) || undefined,
      doi: clean(text(r["electronic-resource-num"])) || undefined,
      pmid: /medline|pubmed/.test(db) && /^\d+$/.test(acc) ? acc : undefined,
      url: clean(text(list(urls?.url)[0])) || undefined,
      abstract: clean(text(r.abstract)) || undefined,
      keywords: list((r.keywords as Record<string, unknown> | undefined)?.keyword).map((k) => clean(text(k))).filter(Boolean),
      issn: /^\d{4}-\d{3}[\dXx]$/.test(isbn) ? isbn : undefined,
      language: clean(text(r.language)) || undefined,
      notes: clean(text(r.notes)) || undefined,
    };
    if (!ref.editors) delete ref.editors;
    refs.push(sanitizeRef(ref));
  });
  if (!records.length && !warnings.length) warnings.push("No records were found. Is this an EndNote XML export?");
  return { refs, warnings };
}

export function writeEndnoteXml(refs: Ref[]): string {
  const name = (p: Person) => p.literal ?? personToString(p);
  const records = refs.map((r, i) => {
    const [code, label] = TYPE_OUT[r.type];
    const rec: Record<string, unknown> = {
      "rec-number": i + 1,
      "ref-type": { "@_name": label, "#text": code },
      contributors: {
        ...(r.authors.length ? { authors: { author: r.authors.map(name) } } : {}),
        ...(r.editors?.length ? { "secondary-authors": { author: r.editors.map(name) } } : {}),
      },
      titles: { title: r.title, ...(r.containerTitle && r.type !== "article-journal" ? { "secondary-title": r.containerTitle } : {}) },
    };
    if (r.journal) rec.periodical = { "full-title": r.journal };
    if (r.pages) rec.pages = normalizePages(r.pages);
    if (r.volume) rec.volume = r.volume;
    if (r.issue) rec.number = r.issue;
    if (r.year) rec.dates = { year: r.year };
    if (r.publisher) rec.publisher = r.publisher;
    if (r.issn) rec.isbn = r.issn;
    if (r.abstract) rec.abstract = r.abstract;
    if (r.keywords?.length) rec.keywords = { keyword: r.keywords };
    if (r.pmid) { rec["accession-num"] = r.pmid; rec["remote-database-name"] = "PubMed"; }
    if (r.doi) rec["electronic-resource-num"] = r.doi;
    if (r.url) rec.urls = { "related-urls": { url: r.url } };
    if (r.language) rec.language = r.language;
    if (r.notes) rec.notes = r.notes;
    return rec;
  });
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", format: true, suppressEmptyNode: true });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build({ xml: { records: { record: records } } })}`;
}

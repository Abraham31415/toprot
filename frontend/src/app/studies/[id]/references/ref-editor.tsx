"use client";

import { useState } from "react";
import { parsePersonName, personToString, type Person, type RefType } from "@/lib/refs/model";
import type { RefRow } from "@/lib/refs/convert";

const TYPES: { value: RefType; label: string }[] = [
  { value: "article-journal", label: "Journal article" }, { value: "book", label: "Book" }, { value: "chapter", label: "Book chapter" }, { value: "report", label: "Report" },
  { value: "thesis", label: "Thesis" }, { value: "paper-conference", label: "Conference paper" }, { value: "webpage", label: "Web page" }, { value: "article", label: "Preprint or news article" }, { value: "other", label: "Other" },
];

const f = "w-full min-w-0 rounded-md border border-navy/25 bg-white px-2 py-1.5 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20";

export type EditorValue = {
  work_type: RefType; title: string; authorsText: string; journal: string; year: string; volume: string; issue: string; pages: string; publisher: string;
  doi: string; pmid: string; url: string; issn: string; abstract: string; keywordsText: string; tagsText: string; notes: string; collection_id: string;
};

export const emptyValue = (): EditorValue => ({ work_type: "article-journal", title: "", authorsText: "", journal: "", year: "", volume: "", issue: "", pages: "", publisher: "", doi: "", pmid: "", url: "", issn: "", abstract: "", keywordsText: "", tagsText: "", notes: "", collection_id: "" });

export function valueFromRow(r: RefRow): EditorValue {
  const people: Person[] = Array.isArray(r.author_details) && r.author_details.length ? r.author_details : (r.authors ?? []).map(parsePersonName);
  return {
    work_type: (TYPES.some((t) => t.value === r.work_type) ? r.work_type : "article-journal") as RefType, title: r.title, authorsText: people.map(personToString).join("\n"), journal: r.journal ?? "", year: r.year?.toString() ?? "",
    volume: r.volume ?? "", issue: r.issue ?? "", pages: r.pages ?? "", publisher: r.publisher ?? "", doi: r.doi ?? "", pmid: r.pmid ?? "", url: r.url ?? "", issn: r.issn ?? "", abstract: r.abstract ?? "",
    keywordsText: (r.keywords ?? []).join(", "), tagsText: (r.tags ?? []).join(", "), notes: r.notes ?? "", collection_id: r.collection_id ?? "",
  };
}

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
export const authorsFromText = (s: string): Person[] => s.split(/\n/).map((l) => parsePersonName(l)).filter((p) => p.family || p.literal);

/** The patch the server action validates. Every field is sent so blanking a field actually clears it. */
export const patchFromValue = (v: EditorValue) => ({
  work_type: v.work_type, title: v.title, authors: authorsFromText(v.authorsText), journal: v.journal, year: v.year.trim() ? Number(v.year) : null, volume: v.volume, issue: v.issue, pages: v.pages,
  publisher: v.publisher, doi: v.doi, pmid: v.pmid, url: v.url, issn: v.issn, abstract: v.abstract, keywords: split(v.keywordsText), tags: split(v.tagsText), notes: v.notes, collection_id: v.collection_id || null,
});

export function RefEditor({ initial, collections, onSave, onCancel, busy, submitLabel = "Save" }: { initial: EditorValue; collections: { id: string; name: string }[]; onSave: (v: EditorValue) => void; onCancel: () => void; busy: boolean; submitLabel?: string }) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof EditorValue>(k: K, val: EditorValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const L = ({ id, children }: { id: string; children: string }) => <label htmlFor={`re-${id}`} className="block text-xs font-medium text-navy/70">{children}</label>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(v); }} className="rounded-lg border border-cobalt/40 bg-paper p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div><L id="type">Type</L><select id="re-type" className={f} value={v.work_type} onChange={(e) => set("work_type", e.target.value as RefType)}>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
        <div><L id="year">Year</L><input id="re-year" inputMode="numeric" className={f} value={v.year} onChange={(e) => set("year", e.target.value.replace(/\D/g, "").slice(0, 4))} /></div>
        <div className="sm:col-span-2"><L id="title">Title</L><input id="re-title" required className={f} value={v.title} onChange={(e) => set("title", e.target.value)} /></div>
        <div className="sm:col-span-2"><L id="authors">Authors, one per line as Family, Given</L><textarea id="re-authors" rows={3} className={`${f} font-mono`} value={v.authorsText} onChange={(e) => set("authorsText", e.target.value)} placeholder={"Smith, John A.\nWorld Health Organization"} /></div>
        <div className="sm:col-span-2"><L id="journal">{v.work_type === "article-journal" || v.work_type === "article" ? "Journal" : "Book or proceedings title"}</L><input id="re-journal" className={f} value={v.journal} onChange={(e) => set("journal", e.target.value)} /></div>
        <div><L id="volume">Volume</L><input id="re-volume" className={f} value={v.volume} onChange={(e) => set("volume", e.target.value)} /></div>
        <div><L id="issue">Issue</L><input id="re-issue" className={f} value={v.issue} onChange={(e) => set("issue", e.target.value)} /></div>
        <div><L id="pages">Pages</L><input id="re-pages" className={f} value={v.pages} onChange={(e) => set("pages", e.target.value)} placeholder="45-67" /></div>
        <div><L id="publisher">Publisher</L><input id="re-publisher" className={f} value={v.publisher} onChange={(e) => set("publisher", e.target.value)} /></div>
        <div><L id="doi">DOI</L><input id="re-doi" className={f} value={v.doi} onChange={(e) => set("doi", e.target.value)} placeholder="10.xxxx/..." /></div>
        <div><L id="pmid">PubMed ID</L><input id="re-pmid" inputMode="numeric" className={f} value={v.pmid} onChange={(e) => set("pmid", e.target.value)} /></div>
        <div><L id="url">Link</L><input id="re-url" className={f} value={v.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" /></div>
        <div><L id="issn">ISSN</L><input id="re-issn" className={f} value={v.issn} onChange={(e) => set("issn", e.target.value)} placeholder="1234-567X" /></div>
        <div className="sm:col-span-2"><L id="abstract">Abstract</L><textarea id="re-abstract" rows={3} className={f} value={v.abstract} onChange={(e) => set("abstract", e.target.value)} /></div>
        <div><L id="keywords">Keywords (comma separated)</L><input id="re-keywords" className={f} value={v.keywordsText} onChange={(e) => set("keywordsText", e.target.value)} /></div>
        <div><L id="tags">Your tags (comma separated)</L><input id="re-tags" className={f} value={v.tagsText} onChange={(e) => set("tagsText", e.target.value)} placeholder="to read, methods" /></div>
        <div><L id="collection">Collection</L><select id="re-collection" className={f} value={v.collection_id} onChange={(e) => set("collection_id", e.target.value)}><option value="">None</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="sm:col-span-2"><L id="notes">Notes (private to your study)</L><textarea id="re-notes" rows={2} className={f} value={v.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50">{busy ? "Saving..." : submitLabel}</button>
        <button type="button" onClick={onCancel} className="rounded-md border border-navy/25 px-4 py-2 text-sm text-navy hover:border-cobalt">Cancel</button>
      </div>
    </form>
  );
}

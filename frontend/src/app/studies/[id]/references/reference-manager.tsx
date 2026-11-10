"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, ExternalLink, FolderPlus, Pencil, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { StylePicker, useStyle } from "@/components/citations/style-picker";
import { getProcessor } from "@/lib/csl/engine";
import { rowToRef, toCslItem, type RefRow } from "@/lib/refs/convert";
import { findDuplicates } from "@/lib/refs/dedupe";
import { writeBibtex } from "@/lib/refs/bibtex";
import { writeEndnoteXml } from "@/lib/refs/endnote";
import { writeRis } from "@/lib/refs/ris";
import { personToString, type Ref } from "@/lib/refs/model";
import { toCsv } from "@/lib/builders/instruments";
import { addTagsToReferences, assignCollection, createCollection, deleteCollection, deleteReferences, importReferences, lookupReference, mergeReferences, renameCollection, updateReference } from "./actions";
import { RefEditor, authorsFromText, emptyValue, patchFromValue, valueFromRow, type EditorValue } from "./ref-editor";
import { ImportPanel } from "./import-panel";

export type StudyRefRow = RefRow & { id: string; display_order: number; created_at?: string };
type Collection = { id: string; name: string };

const f = "w-full min-w-0 rounded-md border border-navy/25 bg-white px-2 py-1.5 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20";
const btn = "inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt hover:text-cobalt disabled:opacity-50";

function save(name: string, content: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const authorLine = (r: StudyRefRow) => {
  const names = (Array.isArray(r.author_details) && r.author_details.length ? r.author_details.map(personToString) : r.authors) ?? [];
  return names.length ? (names.length > 6 ? `${names.slice(0, 6).join("; ")}; and ${names.length - 6} more` : names.join("; ")) : "No authors listed";
};
const firstAuthor = (r: StudyRefRow) => ((Array.isArray(r.author_details) && r.author_details[0] ? personToString(r.author_details[0]) : r.authors?.[0]) ?? "").toLowerCase();
const SOURCE_LABEL: Record<string, string> = { crossref: "Crossref", pubmed: "PubMed", openalex: "OpenAlex", import: "Imported file", zotero: "Zotero", manual: "Typed in" };

export function ReferenceManager({ studyId, references, collections, readOnly }: { studyId: string; references: StudyRefRow[]; collections: Collection[]; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [collFilter, setCollFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState("added");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [panel, setPanel] = useState<"lookup" | "import" | null>(null);
  const [lookup, setLookup] = useState("");
  const [bulkTags, setBulkTags] = useState("");
  const [newCollection, setNewCollection] = useState("");
  const [showDups, setShowDups] = useState(false);
  const [keep, setKeep] = useState<Record<number, string>>({});
  const [showBib, setShowBib] = useState(false);
  const stylePick = useStyle();

  const say = (ok: boolean, text: string) => setMsg({ ok, text });
  const done = (text: string) => { say(true, text); router.refresh(); };
  const run = (fn: () => Promise<{ error?: string } | void>, okText: string) => start(async () => { const r = await fn(); if (r && "error" in r && r.error) say(false, r.error); else done(okText); });

  const allTags = useMemo(() => [...new Set(references.flatMap((r) => r.tags ?? []))].sort((a, b) => a.localeCompare(b)), [references]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = references.filter((r) => {
      if (collFilter === "none" ? r.collection_id : collFilter !== "all" && r.collection_id !== collFilter) return false;
      if (tagFilter && !(r.tags ?? []).includes(tagFilter)) return false;
      if (!q) return true;
      return [r.title, authorLine(r), r.journal, r.doi, r.pmid, r.year?.toString(), r.notes, ...(r.tags ?? []), ...(r.keywords ?? [])].some((s) => s && s.toLowerCase().includes(q));
    });
    const by: Record<string, (a: StudyRefRow, b: StudyRefRow) => number> = {
      added: (a, b) => a.display_order - b.display_order, "year-desc": (a, b) => (b.year ?? 0) - (a.year ?? 0), "year-asc": (a, b) => (a.year ?? 9999) - (b.year ?? 9999),
      author: (a, b) => firstAuthor(a).localeCompare(firstAuthor(b)), title: (a, b) => a.title.localeCompare(b.title),
    };
    return [...list].sort(by[sort] ?? by.added);
  }, [references, query, collFilter, tagFilter, sort]);

  const scope = (): StudyRefRow[] => (selected.size ? references.filter((r) => selected.has(r.id)) : visible);
  const collName = (id: string | null | undefined) => collections.find((c) => c.id === id)?.name;
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = [...selected];

  function exportAs(kind: "ris" | "bib" | "xml" | "csv") {
    const rows = scope();
    const refs = rows.map(rowToRef);
    if (kind === "ris") save("references.ris", writeRis(refs), "application/x-research-info-systems");
    else if (kind === "bib") save("references.bib", writeBibtex(refs), "text/x-bibtex");
    else if (kind === "xml") save("references.xml", writeEndnoteXml(refs), "application/xml");
    else save("references.csv", toCsv(["title", "authors", "journal", "year", "volume", "issue", "pages", "doi", "pmid", "tags", "collection", "notes"], rows.map((r) => [r.title, authorLine(r), r.journal ?? "", String(r.year ?? ""), r.volume ?? "", r.issue ?? "", r.pages ?? "", r.doi ?? "", r.pmid ?? "", (r.tags ?? []).join("; "), collName(r.collection_id) ?? "", r.notes ?? ""])), "text/csv;charset=utf-8");
  }

  const dupGroups = useMemo(() => (showDups ? findDuplicates(references.map(rowToRef)) : []), [showDups, references]);

  const bib = useMemo(() => {
    if (!showBib || !stylePick.style) return null;
    try {
      const rows = scope();
      const proc = getProcessor(stylePick.style.id, stylePick.style.xml, stylePick.style.locales, rows.map((r) => toCslItem(rowToRef(r), r.id)));
      proc.cite(rows.map((r) => [{ id: r.id }]));
      return proc.bibliography();
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBib, stylePick.style, references, visible, selected]);

  function doLookup() {
    setMsg(null);
    start(async () => {
      const res = await lookupReference(lookup);
      if (!res.found) { say(false, res.error ?? "No record was found. Nothing was added."); return; }
      const m = res.metadata;
      const r = await importReferences(studyId, [{ ref: { type: "article-journal", title: m.title, authors: m.authors.map((a) => { const i = a.lastIndexOf(" "); return i > 0 ? { family: a.slice(0, i), given: a.slice(i + 1).split("").join(" ") } : { literal: a }; }), journal: m.journal ?? undefined, year: m.year ?? undefined, volume: m.volume ?? undefined, issue: m.issue ?? undefined, pages: m.pages ?? undefined, doi: m.doi ?? undefined, pmid: m.pmid ?? undefined } }], m.identifier_type === "manual" ? "manual" : "import");
      if (r.error) say(false, r.error); else if (r.skipped) say(false, "That reference is already in this study."); else { setLookup(""); done("Added."); }
    });
  }

  const savingNew = (v: EditorValue) => run(async () => {
    const p = patchFromValue(v);
    const ref: Ref = {
      type: p.work_type, title: p.title, authors: authorsFromText(v.authorsText), journal: p.journal || undefined, year: p.year ?? undefined, volume: p.volume || undefined, issue: p.issue || undefined,
      pages: p.pages || undefined, publisher: p.publisher || undefined, doi: p.doi || undefined, pmid: p.pmid || undefined, url: p.url || undefined, issn: p.issn || undefined,
      abstract: p.abstract || undefined, keywords: p.keywords, notes: p.notes || undefined,
    };
    const r = await importReferences(studyId, [{ ref, tags: p.tags }], "manual", p.collection_id);
    if (r.error) return r;
    if (r.skipped) return { error: "That looks like a reference you already have." };
    if (r.invalid) return { error: "A reference needs a title." };
    setEditing(null);
  }, "Added.");

  return (
    <div className="flex flex-col gap-5">
      {msg && <p role="status" className={`rounded-md p-3 text-sm ${msg.ok ? "bg-teal/10 text-teal-ink" : "bg-red-50 text-red-800"}`}>{msg.text}</p>}

      {!readOnly && (
        <section className="rounded-xl border border-line bg-white p-4" aria-label="Add references">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn} onClick={() => setPanel(panel === "lookup" ? null : "lookup")}><Search className="h-3.5 w-3.5" aria-hidden="true" /> Look up by DOI or PubMed ID</button>
            <button type="button" className={btn} onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" aria-hidden="true" /> Type one in</button>
            <button type="button" className={btn} onClick={() => setPanel(panel === "import" ? null : "import")}><Download className="h-3.5 w-3.5 rotate-180" aria-hidden="true" /> Import file or Zotero</button>
            <a href="/literature" className={btn}><Search className="h-3.5 w-3.5" aria-hidden="true" /> Search the literature</a>
          </div>
          {panel === "lookup" && (
            <div className="mt-3"><p className="text-xs text-navy/65">Details come from Crossref or PubMed. A reference is never generated or guessed.</p>
              <div className="mt-2 flex gap-2"><label htmlFor="rm-lookup" className="sr-only">DOI, PubMed ID or title</label><input id="rm-lookup" className={f} value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doLookup()} placeholder="e.g. 10.1001/jama.2020.1585, 32167524, or a title" /><button type="button" disabled={pending || !lookup.trim()} onClick={doLookup} className="rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50">{pending ? "Looking up..." : "Add"}</button></div></div>
          )}
          {panel === "import" && <div className="mt-3"><ImportPanel studyId={studyId} existing={references.map(rowToRef)} collections={collections} onDone={(t) => { setPanel(null); done(t); }} /></div>}
          {editing === "new" && <div className="mt-3"><RefEditor initial={emptyValue()} collections={collections} busy={pending} submitLabel="Add reference" onCancel={() => setEditing(null)} onSave={savingNew} /></div>}
        </section>
      )}

      <section className="rounded-xl border border-line bg-white p-4" aria-label="Find and organise">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <div className="relative sm:col-span-2"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/45" aria-hidden="true" /><label htmlFor="rm-search" className="sr-only">Search references</label><input id="rm-search" className={`${f} pl-8`} placeholder="Search title, author, journal, DOI, tags, notes" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <div><label htmlFor="rm-coll" className="sr-only">Collection</label><select id="rm-coll" className={f} value={collFilter} onChange={(e) => setCollFilter(e.target.value)}><option value="all">All references</option><option value="none">Not in a collection</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label htmlFor="rm-sort" className="sr-only">Sort</label><select id="rm-sort" className={f} value={sort} onChange={(e) => setSort(e.target.value)}><option value="added">In the order added</option><option value="year-desc">Newest first</option><option value="year-asc">Oldest first</option><option value="author">Author A to Z</option><option value="title">Title A to Z</option></select></div>
        </div>
        {allTags.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag"><Tag className="h-3.5 w-3.5 text-navy/50" aria-hidden="true" />{allTags.map((t) => <button key={t} type="button" aria-pressed={tagFilter === t} onClick={() => setTagFilter(tagFilter === t ? "" : t)} className={`rounded-full border px-2.5 py-0.5 text-xs ${tagFilter === t ? "border-cobalt bg-cobalt text-white" : "border-navy/25 text-navy hover:border-cobalt"}`}>{t}</button>)}</div>}
        {!readOnly && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <div className="flex gap-1.5"><label htmlFor="rm-newcoll" className="sr-only">New collection name</label><input id="rm-newcoll" className={`${f} w-44`} placeholder="New collection" value={newCollection} onChange={(e) => setNewCollection(e.target.value)} /><button type="button" className={btn} disabled={pending || !newCollection.trim()} onClick={() => run(async () => { const r = await createCollection(studyId, newCollection); if (!r.error) setNewCollection(""); return r; }, "Collection created.")}><FolderPlus className="h-3.5 w-3.5" aria-hidden="true" /> Create</button></div>
            {collFilter !== "all" && collFilter !== "none" && (<>
              <button type="button" className={btn} onClick={() => { const n = window.prompt("Rename collection", collName(collFilter)); if (n) run(() => renameCollection(studyId, collFilter, n), "Renamed."); }}>Rename</button>
              <button type="button" className={btn} onClick={() => { if (window.confirm("Delete this collection? Its references are kept.")) run(async () => { const r = await deleteCollection(studyId, collFilter); setCollFilter("all"); return r; }, "Collection deleted."); }}>Delete collection</button>
            </>)}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-navy/70">{visible.length} of {references.length} reference{references.length === 1 ? "" : "s"}{selected.size > 0 && ` · ${selected.size} selected`}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => setSelected(selected.size === visible.length ? new Set() : new Set(visible.map((r) => r.id)))}>{selected.size === visible.length && visible.length ? "Clear selection" : "Select all shown"}</button>
          <button type="button" className={btn} onClick={() => setShowDups((v) => !v)}>Check for duplicates</button>
          <button type="button" className={btn} onClick={() => setShowBib((v) => !v)}>Formatted bibliography</button>
        </div>
      </div>

      {selected.size > 0 && !readOnly && (
        <section className="rounded-xl border border-cobalt bg-white p-3" aria-label="Selected references">
          <div className="flex flex-wrap items-end gap-2">
            <div><label htmlFor="rm-move" className="block text-xs font-medium text-navy/70">Move to collection</label><select id="rm-move" className={f} defaultValue="" onChange={(e) => { const v = e.target.value; if (v !== "") run(() => assignCollection(studyId, ids, v === "__none" ? null : v), "Moved."); e.target.value = ""; }}><option value="" disabled>Choose</option><option value="__none">No collection</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="flex gap-1.5"><div><label htmlFor="rm-tags" className="block text-xs font-medium text-navy/70">Add tags</label><input id="rm-tags" className={`${f} w-40`} value={bulkTags} onChange={(e) => setBulkTags(e.target.value)} placeholder="to read, methods" /></div><button type="button" className={`${btn} self-end`} disabled={pending || !bulkTags.trim()} onClick={() => run(async () => { const r = await addTagsToReferences(studyId, ids, bulkTags.split(",")); if (!r.error) setBulkTags(""); return r; }, "Tags added.")}>Add</button></div>
            <button type="button" className={`${btn} self-end text-red-700`} disabled={pending} onClick={() => { if (window.confirm(`Delete ${selected.size} reference${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) run(async () => { const r = await deleteReferences(studyId, ids); setSelected(new Set()); return r; }, "Deleted."); }}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete</button>
          </div>
        </section>
      )}

      {showDups && (
        <section className="rounded-xl border border-line bg-white p-4" aria-label="Duplicates">
          <h2 className="text-sm font-semibold text-navy">Possible duplicates</h2>
          {dupGroups.length === 0 ? <p className="mt-2 text-sm text-navy/70">No duplicates found.</p> : dupGroups.map((g, gi) => {
            const rows = g.indexes.map((i) => references[i]);
            const chosen = keep[gi] ?? rows[0].id;
            return (
              <div key={gi} className="mt-3 rounded-lg border border-line p-3">
                <p className="text-xs text-navy/60">{g.confidence === "exact" ? `Same ${g.reason === "doi" ? "DOI" : "PubMed ID"}` : "Very similar title, year and first author. Check before merging."}</p>
                <ul className="mt-2 space-y-1.5">{rows.map((r) => <li key={r.id}><label className="flex cursor-pointer items-start gap-2 text-sm"><input type="radio" name={`keep-${gi}`} className="mt-1" checked={chosen === r.id} onChange={() => setKeep({ ...keep, [gi]: r.id })} /><span><span className="font-medium text-navy">{r.title}</span><span className="block text-xs text-navy/60">{authorLine(r)} · {r.journal ?? "no journal"} {r.year ?? ""} {r.doi ? `· ${r.doi}` : ""}</span></span></label></li>)}</ul>
                {!readOnly && <button type="button" className={`${btn} mt-2`} disabled={pending} onClick={() => run(() => mergeReferences(studyId, chosen, rows.filter((r) => r.id !== chosen).map((r) => r.id)), "Merged.")}>Keep the selected one and merge the others into it</button>}
              </div>
            );
          })}
        </section>
      )}

      {showBib && (
        <section className="rounded-xl border border-line bg-white p-4" aria-label="Bibliography">
          <StylePicker idPrefix="rm" {...stylePick} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-navy/60">For {selected.size ? "the selected references" : "the references shown"}. It updates as you edit.</p>
            {bib && <div className="flex gap-2"><button type="button" className={btn} onClick={() => navigator.clipboard?.writeText(bib.text.join("\n")).catch(() => {})}><Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy</button><button type="button" className={btn} onClick={() => save("bibliography.doc", `<html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif">${bib.html.join("")}</body></html>`, "application/msword")}><Download className="h-3.5 w-3.5" aria-hidden="true" /> Word (.doc)</button></div>}</div>
          {bib ? <div className="mt-2 space-y-2 text-sm text-navy/90 [&_.csl-left-margin]:mr-1 [&_.csl-left-margin]:inline [&_.csl-right-inline]:inline" dangerouslySetInnerHTML={{ __html: bib.html.join("") }} /> : <p className="mt-2 text-sm text-navy/60">Choose a style to see the bibliography.</p>}
        </section>
      )}

      <ul className="flex flex-col gap-3">
        {references.length === 0 && <li className="rounded-lg border border-dashed border-navy/25 bg-white p-8 text-center text-sm text-navy/65">No references yet. Look one up, import a file, or search the literature.</li>}
        {references.length > 0 && visible.length === 0 && <li className="rounded-lg border border-dashed border-navy/25 bg-white p-6 text-center text-sm text-navy/65">No references match your search or filters.</li>}
        {visible.map((r) => (
          <li key={r.id} className="rounded-lg border border-line bg-white p-3">
            {editing === r.id ? (
              <RefEditor initial={valueFromRow(r)} collections={collections} busy={pending} onCancel={() => setEditing(null)} onSave={(v) => run(async () => { const res = await updateReference(studyId, r.id, patchFromValue(v)); if (!res.error) setEditing(null); return res; }, "Saved.")} />
            ) : (
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0" aria-label={`Select: ${r.title}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-navy">{r.title}</p>
                  <p className="text-sm text-navy/75">{authorLine(r)}</p>
                  <p className="text-sm text-navy/65">{[r.journal, r.year, [r.volume && `${r.volume}${r.issue ? `(${r.issue})` : ""}`, r.pages].filter(Boolean).join(":")].filter(Boolean).join(". ")}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    {r.source && <span className="rounded-full bg-paper px-2 py-0.5 text-navy/60">{SOURCE_LABEL[r.source] ?? r.source}</span>}
                    {collName(r.collection_id) && <span className="rounded-full bg-soft px-2 py-0.5 text-cobalt-dark">{collName(r.collection_id)}</span>}
                    {(r.tags ?? []).map((t) => <button key={t} type="button" onClick={() => setTagFilter(t)} className="rounded-full border border-navy/20 px-2 py-0.5 text-navy/70 hover:border-cobalt">{t}</button>)}
                    {r.doi && <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-navy/60 underline">DOI <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
                    {r.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`} target="_blank" rel="noopener noreferrer" className="text-navy/60 underline">PubMed</a>}
                    {r.is_open_access && r.open_access_url && <a href={r.open_access_url} target="_blank" rel="noopener noreferrer" className="text-teal-ink underline">Free version</a>}
                  </div>
                  {r.notes && <p className="mt-1.5 rounded bg-paper p-2 text-xs text-navy/75">{r.notes}</p>}
                </div>
                {!readOnly && <div className="flex shrink-0 gap-1"><button type="button" aria-label={`Edit ${r.title}`} className="rounded-md p-1.5 text-navy/55 hover:bg-navy/5 hover:text-cobalt" onClick={() => setEditing(r.id)}><Pencil className="h-4 w-4" /></button><button type="button" aria-label={`Delete ${r.title}`} disabled={pending} className="rounded-md p-1.5 text-navy/55 hover:bg-navy/5 hover:text-red-700 disabled:opacity-50" onClick={() => { if (window.confirm("Delete this reference?")) run(() => deleteReferences(studyId, [r.id]), "Deleted."); }}><X className="h-4 w-4" /></button></div>}
              </div>
            )}
          </li>
        ))}
      </ul>

      {references.length > 0 && (
        <section className="rounded-xl border border-line bg-white p-4" aria-label="Export">
          <p className="text-sm font-medium text-navy">Export {selected.size ? `${selected.size} selected` : `${visible.length} shown`}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => exportAs("ris")}><Download className="h-3.5 w-3.5" aria-hidden="true" /> RIS</button>
            <button type="button" className={btn} onClick={() => exportAs("bib")}><Download className="h-3.5 w-3.5" aria-hidden="true" /> BibTeX</button>
            <button type="button" className={btn} onClick={() => exportAs("xml")}><Download className="h-3.5 w-3.5" aria-hidden="true" /> EndNote XML</button>
            <button type="button" className={btn} onClick={() => exportAs("csv")}><Download className="h-3.5 w-3.5" aria-hidden="true" /> CSV</button>
          </div>
          <p className="mt-2 text-xs text-navy/55">To use your references in Word or a citation formatter, open the <a className="underline" href="/citations">Citation Formatter</a>.</p>
        </section>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { FileUp, Library } from "lucide-react";
import { parseBibtex } from "@/lib/refs/bibtex";
import { parseEndnoteXml } from "@/lib/refs/endnote";
import { parseRis } from "@/lib/refs/ris";
import { findDuplicates } from "@/lib/refs/dedupe";
import { fetchZoteroItems, ZoteroError, type ZoteroImport } from "@/lib/refs/zotero";
import type { Ref } from "@/lib/refs/model";
import { importReferences } from "./actions";

const f = "w-full min-w-0 rounded-md border border-navy/25 bg-white px-2 py-1.5 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20";
const btn = "inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt hover:text-cobalt disabled:opacity-50";

type Staged = { items: ZoteroImport[]; source: "import" | "zotero"; label: string; warnings: string[] };

/** How many staged references would be skipped as duplicates, computed the same way the server will. */
function countDuplicates(existing: Ref[], items: ZoteroImport[]): number {
  const dup = new Set<number>();
  for (const g of findDuplicates([...existing, ...items.map((i) => i.ref)])) for (const i of g.indexes) if (i >= existing.length && i !== g.indexes[0]) dup.add(i);
  return dup.size;
}

export function ImportPanel({ studyId, existing, collections, onDone }: { studyId: string; existing: Ref[]; collections: { id: string; name: string }[]; onDone: (msg: string) => void }) {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [collection, setCollection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [z, setZ] = useState({ kind: "user" as "user" | "group", id: "", key: "", collection: "" });
  const dupes = useMemo(() => (staged ? countDuplicates(existing, staged.items) : 0), [staged, existing]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > 20_000_000) { setError("That file is over 20 MB. Split it and import in parts."); return; }
    const content = await file.text();
    const name = file.name.toLowerCase();
    const parsed = name.endsWith(".bib") ? parseBibtex(content) : name.endsWith(".xml") ? parseEndnoteXml(content) : parseRis(content);
    if (!parsed.refs.length) { setStaged(null); setError(parsed.warnings[0] ?? "No references were found in that file. Supported files: RIS, BibTeX and EndNote XML."); return; }
    setStaged({ items: parsed.refs.slice(0, 500).map((ref) => ({ ref, tags: [] })), source: "import", label: file.name, warnings: [...(parsed.refs.length > 500 ? ["Only the first 500 references will be imported. Import the rest in a second file."] : []), ...parsed.warnings.slice(0, 3)] });
  }

  async function readZotero() {
    setBusy(true); setError(null); setStaged(null);
    try {
      const r = await fetchZoteroItems({ kind: z.kind, id: z.id.trim(), apiKey: z.key.trim(), collectionKey: z.collection.trim() || undefined });
      if (!r.items.length) setError("No references were found there. Attachments and notes are skipped.");
      else setStaged({ items: r.items, source: "zotero", label: `Zotero (${r.items.length} of ${r.total || r.items.length})`, warnings: r.total > r.items.length ? [`Zotero holds ${r.total} items; the first ${r.items.length} reference${r.items.length === 1 ? " was" : "s were"} read. Pick a collection to import the rest in parts.`] : [] });
    } catch (e) { setError(e instanceof ZoteroError ? e.message : "Could not read from Zotero."); }
    finally { setBusy(false); }
  }

  async function doImport() {
    if (!staged) return;
    setBusy(true); setError(null);
    const r = await importReferences(studyId, staged.items, staged.source, collection || null);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setStaged(null);
    onDone(`Imported ${r.saved} reference${r.saved === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} skipped as duplicates` : ""}${r.invalid ? `, ${r.invalid} without a title skipped` : ""}.`);
    setZ((x) => ({ ...x, key: "" }));
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-navy">Import a file</p>
        <p className="mt-1 text-xs text-navy/65">RIS, BibTeX or EndNote XML, from EndNote, Zotero, Mendeley, PubMed or a journal site. Nothing is changed or invented; the file&apos;s own details are used.</p>
        <label className={`${btn} mt-2 cursor-pointer`}><FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Choose file<input type="file" accept=".ris,.txt,.bib,.xml,.enw" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
      </div>

      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium text-navy"><Library className="mr-1 inline h-4 w-4" aria-hidden="true" /> Import from Zotero</summary>
        <p className="mt-2 text-xs text-navy/70">
          Create a read-only key at <a className="underline" href="https://www.zotero.org/settings/keys" target="_blank" rel="noopener noreferrer">zotero.org/settings/keys</a> and paste it here with your numeric user ID (shown on the same page). Your browser talks to Zotero directly. The key is not sent to ToProt
          and is not stored. Delete the key at Zotero when you are done.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div><label htmlFor="z-kind" className="block text-xs font-medium text-navy/70">Library</label><select id="z-kind" className={f} value={z.kind} onChange={(e) => setZ({ ...z, kind: e.target.value as "user" | "group" })}><option value="user">My library</option><option value="group">A group library</option></select></div>
          <div><label htmlFor="z-id" className="block text-xs font-medium text-navy/70">{z.kind === "user" ? "User ID" : "Group ID"} (number)</label><input id="z-id" inputMode="numeric" className={f} value={z.id} onChange={(e) => setZ({ ...z, id: e.target.value })} /></div>
          <div><label htmlFor="z-key" className="block text-xs font-medium text-navy/70">API key</label><input id="z-key" type="password" autoComplete="off" className={f} value={z.key} onChange={(e) => setZ({ ...z, key: e.target.value })} /></div>
          <div><label htmlFor="z-col" className="block text-xs font-medium text-navy/70">Collection key (optional)</label><input id="z-col" className={f} value={z.collection} onChange={(e) => setZ({ ...z, collection: e.target.value.toUpperCase() })} placeholder="8 letters or digits" /></div>
        </div>
        <button type="button" disabled={busy || !z.id || !z.key} onClick={readZotero} className={`${btn} mt-2`}>{busy ? "Reading..." : "Read from Zotero"}</button>
      </details>

      {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      {staged && (
        <div className="rounded-lg border border-cobalt/40 bg-paper p-3">
          <p className="text-sm font-medium text-navy">{staged.items.length} reference{staged.items.length === 1 ? "" : "s"} ready from {staged.label}</p>
          <p className="mt-1 text-xs text-navy/70">{dupes ? `${dupes} look like duplicates of references already here (or repeated in the file) and will be skipped.` : "No duplicates found."}</p>
          {staged.warnings.map((w) => <p key={w} className="mt-1 text-xs text-[#8a5d1c]">{w}</p>)}
          <ul className="mt-2 max-h-40 overflow-auto text-xs text-navy/80">{staged.items.slice(0, 50).map((i, n) => <li key={n} className="truncate">{i.ref.title}</li>)}{staged.items.length > 50 && <li>and {staged.items.length - 50} more</li>}</ul>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div><label htmlFor="imp-col" className="block text-xs font-medium text-navy/70">Put them in</label><select id="imp-col" className={f} value={collection} onChange={(e) => setCollection(e.target.value)}><option value="">No collection</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <button type="button" disabled={busy} onClick={doImport} className="rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50">{busy ? "Importing..." : `Import ${staged.items.length - dupes}`}</button>
            <button type="button" onClick={() => setStaged(null)} className={btn}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

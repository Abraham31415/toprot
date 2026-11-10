"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, FileUp, Plus, Trash2 } from "lucide-react";
import { lookupReference } from "@/app/studies/[id]/references/actions";
import { getProjectReferences, listProjectsForCitations } from "@/app/citations/actions";
import { getProcessor, renderDocument, type DocResult } from "@/lib/csl/engine";
import { StylePicker, useStyle } from "./style-picker";
import { toCslItem } from "@/lib/refs/convert";
import { citationKey, parseBibtex } from "@/lib/refs/bibtex";
import { parseEndnoteXml } from "@/lib/refs/endnote";
import { parseRis } from "@/lib/refs/ris";
import { findDuplicates } from "@/lib/refs/dedupe";
import { normalizeDoi, parsePersonName, personToString, sanitizeRef, type Ref } from "@/lib/refs/model";

/** Demonstration data only, clearly fictional, so the tool can be tried without real citations. */
const SAMPLE_REFS: Ref[] = [
  { type: "article-journal", title: "Sample article one: a fictional demonstration reference", authors: [{ family: "Sample", given: "Alex B." }, { family: "Example", given: "Sam" }], journal: "Sample Journal of Demonstrations", year: 2020, volume: "12", issue: "3", pages: "45-67" },
  { type: "article-journal", title: "Sample article two: another fictional demonstration reference", authors: [{ family: "Placeholder", given: "Pat" }], journal: "Sample Journal of Demonstrations", year: 2018, volume: "5", pages: "e1234" },
];
const sampleText = () => {
  const k = withKeys(SAMPLE_REFS).map((x) => x.key);
  return `This sentence cites one source [@${k[0]}]. This one cites two [@${k[0]}; @${k[1]}, p. 4].`;
};

const field = "w-full min-w-0 rounded-md border border-navy/25 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20";
const btn = "inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt hover:text-cobalt disabled:opacity-50";

function save(name: string, content: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

type Keyed = { key: string; ref: Ref };

function withKeys(refs: Ref[]): Keyed[] {
  const taken = new Set<string>();
  return refs.map((ref) => ({ key: citationKey(ref, taken), ref }));
}

export function CitationEditor() {
  const { styleId, setStyleId, style, busy: styleBusy, error: styleError, setError: setStyleError } = useStyle();
  const [refs, setRefs] = useState<Ref[]>(SAMPLE_REFS);
  const [text, setText] = useState(sampleText);
  const showingSample = refs === SAMPLE_REFS;
  const [doc, setDoc] = useState<DocResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [lookup, setLookup] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const keyed = useMemo(() => withKeys(refs), [refs]);
  const items = useMemo(() => keyed.map((k) => toCslItem(k.ref, k.key)), [keyed]);

  useEffect(() => {
    listProjectsForCitations().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (!style) return;
    setRendering(true);
    const t = setTimeout(() => {
      try {
        const proc = getProcessor(style.id, style.xml, style.locales, items);
        setDoc(renderDocument(text, items, style.xml, style.locales, undefined, proc));
        setStyleError(null);
      } catch (e) { setStyleError(`This style could not format your references: ${(e as Error).message}`); setDoc(null); }
      setRendering(false);
    }, 300);
    return () => clearTimeout(t);
  }, [style, items, text]);

  function insert(key: string) {
    const el = area.current;
    const marker = `[@${key}]`;
    if (!el) { setText((t) => `${t} ${marker}`); return; }
    const { selectionStart: s, selectionEnd: e } = el;
    setText((t) => `${t.slice(0, s)}${marker}${t.slice(e)}`);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + marker.length, s + marker.length); });
  }

  function addRefs(list: Ref[], note: string) {
    const clean = list.map(sanitizeRef).filter((r) => r.title);
    const merged = [...refs, ...clean];
    const dup = findDuplicates(merged);
    const drop = new Set(dup.flatMap((g) => g.indexes.slice(1)).filter((i) => i >= refs.length));
    const next = merged.filter((_, i) => !drop.has(i));
    setRefs(next);
    setMsg(`${note} ${next.length - refs.length} added${drop.size ? `, ${drop.size} duplicate${drop.size === 1 ? "" : "s"} skipped` : ""}.`);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const content = await file.text();
    const name = file.name.toLowerCase();
    const parsed = name.endsWith(".bib") ? parseBibtex(content) : name.endsWith(".xml") ? parseEndnoteXml(content) : parseRis(content);
    addRefs(parsed.refs, `Read ${parsed.refs.length} reference${parsed.refs.length === 1 ? "" : "s"} from ${file.name}.${parsed.warnings.length ? " " + parsed.warnings[0] : ""}`);
  }

  async function onLookup() {
    const v = lookup.trim();
    if (!v) return;
    setMsg("Looking up...");
    const res = await lookupReference(v);
    if (!res.found) { setMsg(res.error ?? "No record was found for that identifier. Nothing was added."); return; }
    const m = res.metadata;
    addRefs([{ type: "article-journal", title: m.title, authors: m.authors.map(parsePersonName), journal: m.journal ?? undefined, year: m.year ?? undefined, volume: m.volume ?? undefined, issue: m.issue ?? undefined, pages: m.pages ?? undefined, doi: normalizeDoi(m.doi), pmid: m.pmid ?? undefined }], "Found it.");
    setLookup("");
  }

  async function loadProject(id: string) {
    if (!id) return;
    setMsg("Loading...");
    const list = await getProjectReferences(id);
    setRefs(list);
    setMsg(`Loaded ${list.length} reference${list.length === 1 ? "" : "s"} from the project.`);
  }

  async function copy(kind: string, content: string) {
    try { await navigator.clipboard.writeText(content); setCopied(kind); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard unavailable */ }
  }

  const docHtml = () => `<html><head><meta charset="utf-8"><title>Document</title></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt"><p>${doc?.html ?? ""}</p>${doc?.notes.length ? `<h2>Notes</h2><ol>${doc.notes.map((n) => `<li>${n.html}</li>`).join("")}</ol>` : ""}<h2>References</h2>${doc?.bibliographyHtml ?? ""}</body></html>`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-xl border border-line bg-white p-4" aria-label="Citation style">
          <StylePicker styleId={styleId} setStyleId={setStyleId} style={style} busy={styleBusy} error={styleError} />
        </section>

        <section className="rounded-xl border border-line bg-white p-4" aria-label="References">
          <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-navy">References ({refs.length})</h2>{refs.length > 0 && <button type="button" className="text-xs text-navy/60 hover:text-red-700" onClick={() => { setRefs([]); setMsg("Cleared."); }}>Clear all</button>}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="flex min-w-0 flex-1 gap-2"><label htmlFor="cs-lookup" className="sr-only">DOI or PubMed ID</label><input id="cs-lookup" className={field} placeholder="Add by DOI or PubMed ID" value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onLookup()} /><button type="button" className={btn} onClick={onLookup}><Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add</button></div>
            <label className={`${btn} cursor-pointer`}><FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Import RIS, BibTeX or EndNote XML<input type="file" accept=".ris,.txt,.bib,.xml" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
          </div>
          {projects.length > 0 && (
            <div className="mt-3"><label htmlFor="cs-project" className="block text-xs font-medium text-navy/70">Or use the references in one of your projects</label><select id="cs-project" className={field} defaultValue="" onChange={(e) => void loadProject(e.target.value)}><option value="">Choose a project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
          )}
          {msg && <p role="status" className="mt-2 text-xs text-navy/70">{msg}</p>}
          {showingSample && <p className="mt-2 rounded-md bg-gold/10 p-2 text-xs text-[#8a5d1c]">These two references are fictional samples so you can try the tool. Clear them and add your own.</p>}
          <ul className="mt-3 max-h-64 space-y-1.5 overflow-auto">
            {keyed.map((k, i) => (
              <li key={`${k.key}-${i}`} className="flex items-start justify-between gap-2 rounded-md border border-line p-2 text-xs">
                <div className="min-w-0"><p className="truncate font-medium text-navy">{k.ref.title}</p><p className="truncate text-navy/60">{k.ref.authors.slice(0, 2).map(personToString).join("; ") || "No authors"} {k.ref.year ?? ""}</p><code className="text-navy/50">@{k.key}</code></div>
                <div className="flex shrink-0 gap-1"><button type="button" className={btn} onClick={() => insert(k.key)}>Cite</button><button type="button" aria-label={`Remove ${k.ref.title}`} className="rounded-md p-1.5 text-navy/50 hover:text-red-700" onClick={() => setRefs((r) => r.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></div>
              </li>
            ))}
            {refs.length === 0 && <li className="rounded-md border border-dashed border-navy/25 p-4 text-center text-xs text-navy/60">Add references by DOI or PubMed ID, or import a file.</li>}
          </ul>
        </section>

        <section className="rounded-xl border border-line bg-white p-4" aria-label="Your text">
          <label htmlFor="cs-text" className="block text-sm font-semibold text-navy">Your text</label>
          <p className="mt-1 text-xs text-navy/60">Write <code>[@key]</code> where a citation belongs. Several: <code>[@a; @b]</code>. With a page: <code>[@a, p. 12]</code>. Use Cite beside a reference to insert it at the cursor.</p>
          <textarea id="cs-text" ref={area} rows={9} className={`${field} mt-2 font-mono`} value={text} onChange={(e) => setText(e.target.value)} />
        </section>
      </div>

      <div className="min-w-0 space-y-5">
        <section className="rounded-xl border border-line bg-white p-4" aria-label="Formatted output" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-navy">Formatted {rendering && <span className="font-normal text-navy/50">(updating...)</span>}</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn} disabled={!doc} onClick={() => doc && copy("text", `${doc.text}\n\nReferences\n${doc.bibliographyText}`)}><Copy className="h-3.5 w-3.5" aria-hidden="true" /> {copied === "text" ? "Copied" : "Copy"}</button>
              <button type="button" className={btn} disabled={!doc} onClick={() => save("document.doc", docHtml(), "application/msword")}><Download className="h-3.5 w-3.5" aria-hidden="true" /> Word (.doc)</button>
            </div>
          </div>
          {doc ? (
            <>
              <p className="mt-3 text-sm leading-6 text-navy/90 [&_.cite-missing]:rounded [&_.cite-missing]:bg-red-50 [&_.cite-missing]:px-1 [&_.cite-missing]:text-red-700" dangerouslySetInnerHTML={{ __html: doc.html }} />
              {doc.notes.length > 0 && <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-navy/80">{doc.notes.map((n) => <li key={n.n} dangerouslySetInnerHTML={{ __html: n.html }} />)}</ol>}
              <h3 className="mt-5 text-sm font-semibold text-navy">References</h3>
              {doc.bibliographyHtml ? <div className="mt-2 space-y-2 text-sm text-navy/90 [&_.csl-entry]:break-words [&_.csl-left-margin]:mr-1 [&_.csl-left-margin]:inline [&_.csl-right-inline]:inline" dangerouslySetInnerHTML={{ __html: doc.bibliographyHtml }} /> : <p className="mt-2 text-xs text-navy/60">The reference list appears once your text cites a reference.</p>}
              {doc.missing.length > 0 && <p role="alert" className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-800">Not in your reference list: {doc.missing.join(", ")}. They are shown as [missing: ...] so nothing is lost.</p>}
              {doc.uncited.length > 0 && <p className="mt-2 text-xs text-navy/60">Not cited yet: {doc.uncited.length} reference{doc.uncited.length === 1 ? "" : "s"}. Only cited references appear in the list.</p>}
            </>
          ) : <p className="mt-3 text-sm text-navy/60">{styleBusy ? "Preparing the style. Large styles can take a few seconds the first time." : "Nothing to show yet."}</p>}
        </section>
      </div>
    </div>
  );
}

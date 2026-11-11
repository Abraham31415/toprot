"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Highlighter, Search, Trash2 } from "lucide-react";
import {
  addAnnotation, addReferenceFromPdf, deleteAnnotation, deletePdf, getOriginalUrl, getPageText, linkPdf, searchLibrary, updateAnnotation, updatePdf, type SearchHit,
} from "@/app/library/actions";
import { locateQuote } from "@/lib/pdf/qa";
import { Headline } from "./grounded-views";

export type ReaderDoc = {
  id: string; title: string; status: "ready" | "no_text" | "failed"; page_count: number | null; file_size: number; folder: string | null; tags: string[];
  notes: string | null; doi: string | null; study_id: string | null; reference_id: string | null; original_filename: string; metadata: { info?: Record<string, string>; truncated?: boolean }; created_at: string;
};
export type Annotation = { id: string; page: number; quote: string | null; note: string | null; color: "yellow" | "green" | "blue" | "pink"; created_at: string };
export type StudyOption = { id: string; title: string };

const field = "w-full min-w-0 rounded-md border border-navy/25 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20";
const btn = "inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt hover:text-cobalt disabled:opacity-50";
const COLOR: Record<Annotation["color"], string> = { yellow: "bg-yellow-200", green: "bg-green-200", blue: "bg-blue-200", pink: "bg-pink-200" };

/** Splits page text into plain and highlighted segments for the user's saved quotes. */
function segments(text: string, ann: Annotation[]): { text: string; color?: Annotation["color"]; id?: string }[] {
  const spans: { s: number; e: number; color: Annotation["color"]; id: string }[] = [];
  for (const a of ann) {
    if (!a.quote) continue;
    const found = locateQuote(text, a.quote);
    const own = found?.split(" ... ")[0];
    const at = own ? text.indexOf(own) : -1;
    if (own && at >= 0) spans.push({ s: at, e: at + own.length, color: a.color, id: a.id });
  }
  spans.sort((x, y) => x.s - y.s);
  const out: { text: string; color?: Annotation["color"]; id?: string }[] = [];
  let at = 0;
  for (const sp of spans) {
    if (sp.s < at) continue;
    if (sp.s > at) out.push({ text: text.slice(at, sp.s) });
    out.push({ text: text.slice(sp.s, sp.e), color: sp.color, id: sp.id });
    at = sp.e;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export function Reader({ doc, annotations, studies, references, initialPage }: { doc: ReaderDoc; annotations: Annotation[]; studies: StudyOption[]; references: { id: string; title: string; year: number | null }[]; initialPage: number }) {
  const router = useRouter();
  const total = Math.max(doc.page_count ?? 1, 1);
  const [page, setPage] = useState(initialPage);
  const [view, setView] = useState<"text" | "original">("text");
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [origUrl, setOrigUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [color, setColor] = useState<Annotation["color"]>("yellow");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(doc.title);
  const [doi, setDoi] = useState(doc.doi ?? "");
  const [folder, setFolder] = useState(doc.folder ?? "");
  const [tags, setTags] = useState(doc.tags.join(", "));
  const [notes, setNotes] = useState(doc.notes ?? "");
  const textRef = useRef<HTMLDivElement>(null);

  const pageAnn = annotations.filter((a) => a.page === page);
  const segs = useMemo(() => (text ? segments(text, pageAnn) : []), [text, pageAnn]);

  useEffect(() => {
    let live = true;
    setText(null); setLoadError(null);
    if (doc.status !== "ready") return;
    getPageText(doc.id, page).then((r) => { if (!live) return; if ("error" in r) setLoadError(r.error); else setText(r.text); });
    return () => { live = false; };
  }, [doc.id, doc.status, page]);

  const openOriginal = useCallback(async () => {
    setView("original");
    const r = await getOriginalUrl(doc.id);
    if ("error" in r) setMessage(r.error); else setOrigUrl(r.url);
  }, [doc.id]);

  const go = (p: number) => { const n = Math.min(Math.max(p, 1), total); setPage(n); window.history.replaceState(null, "", `?page=${n}`); };

  const selectedQuote = (): string => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !textRef.current) return "";
    if (!textRef.current.contains(sel.anchorNode) || !textRef.current.contains(sel.focusNode)) return "";
    return sel.toString().replace(/\s+/g, " ").trim();
  };
  const run = (fn: () => Promise<{ error?: string } | void>, ok?: string) => start(async () => {
    setMessage(null);
    const r = await fn();
    if (r && "error" in r && r.error) { setMessage(r.error); return; }
    if (ok) setMessage(ok);
    router.refresh();
  });
  const highlight = () => {
    const quote = selectedQuote();
    if (!quote && !note.trim()) { setMessage("Select some text on the page first, or write a note."); return; }
    run(async () => { const r = await addAnnotation(doc.id, { page, quote: quote || undefined, note: note || undefined, color }); if (!r.error) setNote(""); return r; }, "Annotation saved.");
  };
  const doSearch = () => start(async () => { const r = await searchLibrary(q, [doc.id]); setHits("hits" in r ? r.hits : []); if ("error" in r) setMessage(r.error); });

  const info = doc.metadata?.info ?? {};
  const linkedStudy = studies.find((s) => s.id === doc.study_id);

  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6">
      <Link href="/library" className="inline-flex items-center gap-1 text-sm text-navy/70 hover:text-cobalt"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> PDF library</Link>
      <h1 className="mt-2 text-lg font-semibold text-navy">{doc.title}</h1>
      <p className="text-xs text-navy/60">{doc.original_filename} · {total} pages · {(doc.file_size / 1048576).toFixed(1)} MB</p>
      {message && <p role="status" className="mt-2 rounded-md bg-soft px-3 py-2 text-sm text-navy">{message}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section aria-label="Document" className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="View" className="flex rounded-md border border-line bg-white p-0.5 text-sm">
              <button role="tab" type="button" aria-selected={view === "text"} onClick={() => setView("text")} className={`rounded px-3 py-1 ${view === "text" ? "bg-soft font-medium text-cobalt" : "text-navy"}`}>Text</button>
              <button role="tab" type="button" aria-selected={view === "original"} onClick={openOriginal} className={`rounded px-3 py-1 ${view === "original" ? "bg-soft font-medium text-cobalt" : "text-navy"}`}>Original PDF</button>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" className={btn} onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /></button>
              <label htmlFor="rd-page" className="sr-only">Page number</label>
              <input id="rd-page" type="number" min={1} max={total} value={page} onChange={(e) => go(Number(e.target.value) || 1)} className="w-16 rounded-md border border-navy/25 px-2 py-1 text-center text-sm" />
              <span className="text-xs text-navy/65">of {total}</span>
              <button type="button" className={btn} onClick={() => go(page + 1)} disabled={page >= total} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </div>
          </div>

          {view === "text" ? (
            <div className="mt-3 rounded-md border border-line bg-white p-4">
              {doc.status !== "ready" ? (
                <p className="text-sm text-navy/70">This PDF has no extractable text, usually because it is a scan. ToProt does not do OCR. Open the original PDF to read it; notes can still be added.</p>
              ) : loadError ? <p role="alert" className="text-sm text-red-700">{loadError}</p> : text === null ? <p className="text-sm text-navy/60">Loading page {page}...</p> : text === "" ? <p className="text-sm text-navy/60">No text on this page (it may be an image or figure).</p> : (
                <div ref={textRef} className="whitespace-pre-wrap text-sm leading-relaxed text-navy" data-testid="page-text">
                  {segs.map((s, i) => (s.color ? <mark key={i} className={`${COLOR[s.color]} rounded px-0.5`}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
                </div>
              )}
              <p className="mt-3 border-t border-line pt-2 text-xs text-navy/55">Text is extracted from the PDF and may differ in layout, line breaks and tables. Page numbers are PDF pages. Select text and use Highlight to save a passage.</p>
            </div>
          ) : (
            <div className="mt-3 rounded-md border border-line bg-white">
              {origUrl ? (
                <>
                  <iframe title="Original PDF" src={`${origUrl}#page=${page}`} className="h-[75vh] w-full rounded-md" />
                  <p className="px-3 py-2 text-xs text-navy/60">If nothing shows (some phones cannot display PDFs inline), <a className="text-cobalt underline" href={origUrl} target="_blank" rel="noopener noreferrer">open the PDF in a new tab <ExternalLink className="inline h-3 w-3" aria-hidden="true" /></a>. The link expires in 15 minutes.</p>
                </>
              ) : <p className="p-4 text-sm text-navy/60">Loading the file...</p>}
            </div>
          )}
        </section>

        <aside aria-label="Tools" className="min-w-0 space-y-4">
          {doc.status === "ready" && (
            <div className="rounded-md border border-line bg-white p-3">
              <h2 className="text-sm font-semibold text-navy">Search this PDF</h2>
              <div className="mt-2 flex gap-1.5">
                <label htmlFor="rd-q" className="sr-only">Search text</label>
                <input id="rd-q" className={field} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim().length > 1 && doSearch()} />
                <button type="button" onClick={doSearch} disabled={pending || q.trim().length < 2} className={btn} aria-label="Search"><Search className="h-3.5 w-3.5" aria-hidden="true" /></button>
              </div>
              {hits && (hits.length === 0 ? <p className="mt-2 text-xs text-navy/60">No matches.</p> : (
                <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
                  {hits.map((h, i) => <li key={i} className="text-xs"><button type="button" onClick={() => { go(h.page); setView("text"); }} className="font-medium text-cobalt hover:underline">Page {h.page}</button> <span className="text-navy/80"><Headline text={h.headline} /></span></li>)}
                </ul>
              ))}
            </div>
          )}

          <div className="rounded-md border border-line bg-white p-3">
            <h2 className="text-sm font-semibold text-navy">Annotations</h2>
            <div className="mt-2 space-y-2">
              <label htmlFor="rd-note" className="sr-only">Note</label>
              <textarea id="rd-note" className={field} rows={2} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Note for page ${page} (optional)`} />
              <div className="flex flex-wrap items-center gap-2">
                <span role="radiogroup" aria-label="Highlight colour" className="flex gap-1">
                  {(Object.keys(COLOR) as Annotation["color"][]).map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className={`h-5 w-5 rounded-full border-2 ${COLOR[c]} ${color === c ? "border-navy" : "border-transparent"}`} />)}
                </span>
                <button type="button" disabled={pending} onClick={highlight} className="inline-flex items-center gap-1.5 rounded-md bg-cobalt px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-dark disabled:opacity-50"><Highlighter className="h-3.5 w-3.5" aria-hidden="true" /> Highlight selection / add note</button>
              </div>
            </div>
            {annotations.length === 0 ? <p className="mt-3 text-xs text-navy/60">No annotations yet.</p> : (
              <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {annotations.map((a) => (
                  <li key={a.id} className="rounded border border-line p-2 text-xs">
                    <div className="flex items-center justify-between gap-2"><button type="button" onClick={() => { go(a.page); setView("text"); }} className="font-medium text-cobalt hover:underline">Page {a.page}</button>
                      <button type="button" aria-label="Delete annotation" onClick={() => run(() => deleteAnnotation(a.id))} className="text-navy/50 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button></div>
                    {a.quote && <p className={`mt-1 rounded px-1 ${COLOR[a.color]} text-navy`}>{a.quote}</p>}
                    <AnnNote ann={a} onSave={(n) => run(() => updateAnnotation(a.id, { note: n }))} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-md border border-line bg-white p-3">
            <h2 className="text-sm font-semibold text-navy">Details</h2>
            <dl className="mt-1 text-xs text-navy/70">
              {info.author && <div><dt className="inline font-medium">Author in file: </dt><dd className="inline">{info.author}</dd></div>}
              {info.creationDate && <div><dt className="inline font-medium">File date: </dt><dd className="inline">{info.creationDate}</dd></div>}
              {info.keywords && <div><dt className="inline font-medium">Keywords in file: </dt><dd className="inline">{info.keywords}</dd></div>}
            </dl>
            <p className="mt-1 text-xs text-navy/55">Read from the PDF itself and often incomplete. Check against the paper before citing.</p>
            <div className="mt-2 space-y-2">
              <label className="block text-xs font-medium text-navy">Title<input className={`${field} mt-1`} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="block text-xs font-medium text-navy">DOI<input className={`${field} mt-1`} value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="10.xxxx/..." /></label>
              <label className="block text-xs font-medium text-navy">Folder<input className={`${field} mt-1`} value={folder} maxLength={80} onChange={(e) => setFolder(e.target.value)} /></label>
              <label className="block text-xs font-medium text-navy">Tags (comma separated)<input className={`${field} mt-1`} value={tags} onChange={(e) => setTags(e.target.value)} /></label>
              <label className="block text-xs font-medium text-navy">Notes<textarea className={`${field} mt-1`} rows={3} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
              <button type="button" disabled={pending} onClick={() => run(() => updatePdf(doc.id, { title, doi: doi || null, folder: folder || null, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), notes: notes || null }), "Saved.")} className="rounded-md bg-cobalt px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-dark disabled:opacity-50">Save details</button>
            </div>
          </div>

          <div className="rounded-md border border-line bg-white p-3">
            <h2 className="text-sm font-semibold text-navy">Link to a reference</h2>
            {studies.length === 0 ? <p className="mt-1 text-xs text-navy/60">Create a study first to link this PDF to one of its references.</p> : (
              <div className="mt-2 space-y-2">
                <label className="block text-xs font-medium text-navy">Study
                  <select className={`${field} mt-1`} value={doc.study_id ?? ""} onChange={(e) => run(() => linkPdf(doc.id, e.target.value || null, null))}><option value="">Not linked</option>{studies.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
                </label>
                {linkedStudy && (
                  <>
                    <label className="block text-xs font-medium text-navy">Reference in this study
                      <select className={`${field} mt-1`} value={doc.reference_id ?? ""} onChange={(e) => run(() => linkPdf(doc.id, doc.study_id, e.target.value || null))}><option value="">None</option>{references.map((r) => <option key={r.id} value={r.id}>{r.title}{r.year ? ` (${r.year})` : ""}</option>)}</select>
                    </label>
                    <button type="button" disabled={pending || !doc.doi} onClick={() => run(() => addReferenceFromPdf(doc.id, linkedStudy.id), "Reference added from the DOI and linked.")} className={btn} title={doc.doi ? "Looks the DOI up at Crossref" : "Save a DOI first"}>Add reference from this PDF&apos;s DOI</button>
                  </>
                )}
              </div>
            )}
          </div>

          <button type="button" disabled={pending} onClick={() => { if (window.confirm("Delete this PDF, its text and its annotations? This cannot be undone.")) start(async () => { const r = await deletePdf(doc.id); if (r.error) setMessage(r.error); else router.push("/library"); }); }} className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete this PDF</button>
        </aside>
      </div>
    </div>
  );
}

function AnnNote({ ann, onSave }: { ann: Annotation; onSave: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(ann.note ?? "");
  if (editing) return (
    <div className="mt-1">
      <label className="sr-only" htmlFor={`an-${ann.id}`}>Edit note</label>
      <textarea id={`an-${ann.id}`} className="w-full rounded border border-navy/25 p-1 text-xs" rows={2} maxLength={5000} value={v} onChange={(e) => setV(e.target.value)} />
      <button type="button" className="mr-2 text-cobalt underline" onClick={() => { onSave(v); setEditing(false); }}>Save</button>
      <button type="button" className="text-navy/60 underline" onClick={() => setEditing(false)}>Cancel</button>
    </div>
  );
  return <p className="mt-1 text-navy/85">{ann.note ?? <span className="text-navy/50">No note.</span>} <button type="button" className="text-cobalt underline" onClick={() => setEditing(true)}>{ann.note ? "Edit" : "Add note"}</button></p>;
}

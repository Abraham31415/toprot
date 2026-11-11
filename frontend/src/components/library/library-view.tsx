"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, FileWarning, Search, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { registerPdf, searchLibrary, type SearchHit } from "@/app/library/actions";
import { askDocuments, compareDocuments } from "@/app/library/ai-actions";
import type { AskResult, VerifiedPaper } from "@/lib/pdf/qa";
import { AnswerView, CompareView, Headline } from "./grounded-views";

export type LibraryDoc = {
  id: string; title: string; status: "ready" | "no_text" | "failed"; page_count: number | null; file_size: number;
  folder: string | null; tags: string[]; doi: string | null; study_id: string | null; reference_id: string | null; created_at: string;
};

const MAX_BYTES = 20 * 1024 * 1024, QUOTA = 100 * 1024 * 1024, MAX_FILES = 100;
const field = "w-full min-w-0 rounded-md border border-navy/25 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20";
const btn = "inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt hover:text-cobalt disabled:opacity-50";
const mb = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;

type Upload = { key: string; name: string; state: "uploading" | "reading" | "done" | "error"; message?: string };

export function LibraryView({ docs, userId }: { docs: LibraryDoc[]; userId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [filter, setFilter] = useState("");
  const [folder, setFolder] = useState("");
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ result: AskResult; usedAi: boolean } | null>(null);
  const [papers, setPapers] = useState<VerifiedPaper[] | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [drag, setDrag] = useState(false);

  const used = docs.reduce((n, d) => n + d.file_size, 0);
  const folders = useMemo(() => [...new Set(docs.map((d) => d.folder).filter((f): f is string => !!f))].sort(), [docs]);
  const tags = useMemo(() => [...new Set(docs.flatMap((d) => d.tags))].sort(), [docs]);
  const shown = docs.filter((d) => (!folder || d.folder === folder) && (!tag || d.tags.includes(tag)) && (!filter.trim() || `${d.title} ${d.doi ?? ""} ${d.tags.join(" ")}`.toLowerCase().includes(filter.trim().toLowerCase())));
  const readable = docs.filter((d) => d.status === "ready");

  const setUp = (key: string, patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function addFiles(files: FileList | File[]) {
    const supabase = createClient();
    let usedNow = used, count = docs.length;
    for (const file of Array.from(files)) {
      const key = crypto.randomUUID();
      setUploads((u) => [...u, { key, name: file.name, state: "uploading" }]);
      const looksPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (!looksPdf) { setUp(key, { state: "error", message: "Only PDF files can be added." }); continue; }
      if (file.size > MAX_BYTES) { setUp(key, { state: "error", message: `Over the 20 MB limit (${mb(file.size)}).` }); continue; }
      if (file.size === 0) { setUp(key, { state: "error", message: "The file is empty." }); continue; }
      if (count >= MAX_FILES) { setUp(key, { state: "error", message: "Your library holds the maximum of 100 PDFs." }); continue; }
      if (usedNow + file.size > QUOTA) { setUp(key, { state: "error", message: "This would go over your 100 MB library limit." }); continue; }
      const id = crypto.randomUUID();
      const { error } = await supabase.storage.from("research-pdfs").upload(`${userId}/${id}.pdf`, file, { contentType: "application/pdf", upsert: false });
      if (error) { setUp(key, { state: "error", message: "Upload failed. Check your connection and the 100 MB limit." }); continue; }
      setUp(key, { state: "reading" });
      const r = await registerPdf(id, file.name);
      if (r.ok) {
        usedNow += file.size; count++;
        setUp(key, { state: "done", message: r.status === "no_text" ? "Added, but it has no searchable text (a scan?). There is no OCR, so search and questions cannot use it." : r.truncated ? `Added (${r.pages} pages). Very long text was cut off for search.` : `Added (${r.pages} pages).` });
      } else setUp(key, { state: "error", message: r.error });
    }
    router.refresh();
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = [...selected].filter((id) => docs.some((d) => d.id === id));

  const runSearch = () => start(async () => {
    setSearchError(null); setHits(null);
    const r = await searchLibrary(q, chosen.length ? chosen : undefined);
    if ("error" in r) setSearchError(r.error); else setHits(r.hits);
  });
  const ask = () => start(async () => {
    setAiError(null); setAnswer(null); setPapers(null);
    const r = await askDocuments(question, chosen, crypto.randomUUID());
    if ("error" in r) setAiError(r.error); else setAnswer(r);
  });
  const compare = () => start(async () => {
    setAiError(null); setAnswer(null); setPapers(null);
    const r = await compareDocuments(chosen, crypto.randomUUID());
    if ("error" in r) setAiError(r.error); else setPapers(r.papers);
  });

  return (
    <div className="space-y-6">
      <section
        aria-label="Add PDFs" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}
        className={`rounded-md border-2 border-dashed p-4 text-center ${drag ? "border-cobalt bg-soft/60" : "border-line bg-white"}`}
      >
        <Upload className="mx-auto h-5 w-5 text-cobalt" aria-hidden="true" />
        <p className="mt-1 text-sm text-navy">Drop PDFs here, or <button type="button" onClick={() => input.current?.click()} className="font-medium text-cobalt underline">choose files</button></p>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="sr-only" aria-label="Choose PDF files" onChange={(e) => { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ""; }} />
        <p className="mt-1 text-xs text-navy/60">Up to 20 MB and 400 pages each. Library limit: 100 PDFs and 100 MB. Text is read from the file; scanned PDFs are stored but cannot be searched (no OCR).</p>
        <div className="mx-auto mt-2 max-w-sm" aria-label={`Storage used: ${mb(used)} of 100 MB`}>
          <div className="h-1.5 overflow-hidden rounded bg-line"><div className={`h-full ${used > QUOTA * 0.9 ? "bg-red-600" : "bg-cobalt"}`} style={{ width: `${Math.min(100, (used / QUOTA) * 100)}%` }} /></div>
          <p className="mt-1 text-xs text-navy/60">{mb(used)} of 100 MB used · {docs.length} of {MAX_FILES} PDFs</p>
        </div>
        {uploads.length > 0 && (
          <ul className="mx-auto mt-3 max-w-xl space-y-1 text-left" aria-live="polite">
            {uploads.map((u) => (
              <li key={u.key} className={`text-xs ${u.state === "error" ? "text-red-700" : "text-navy/80"}`}>
                <span className="font-medium">{u.name}</span>: {u.state === "uploading" ? "uploading..." : u.state === "reading" ? "reading the text..." : u.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Your PDFs">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="lib-filter" className="text-xs font-medium text-navy">Filter by title, DOI or tag</label>
            <input id="lib-filter" className={`${field} mt-1`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {folders.length > 0 && (
            <div>
              <label htmlFor="lib-folder" className="text-xs font-medium text-navy">Folder</label>
              <select id="lib-folder" className={`${field} mt-1`} value={folder} onChange={(e) => setFolder(e.target.value)}><option value="">All</option>{folders.map((f) => <option key={f} value={f}>{f}</option>)}</select>
            </div>
          )}
        </div>
        {tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">{tags.map((t) => <button key={t} type="button" aria-pressed={tag === t} onClick={() => setTag(tag === t ? "" : t)} className={`rounded-full border px-2.5 py-0.5 text-xs ${tag === t ? "border-cobalt bg-cobalt text-white" : "border-navy/25 text-navy hover:border-cobalt"}`}>{t}</button>)}</div>}

        {docs.length === 0 ? <p className="mt-3 rounded-md border border-line bg-white p-4 text-sm text-navy/65">No PDFs yet. Add one above.</p> : (
          <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-white">
            {shown.length === 0 && <li className="p-3 text-sm text-navy/60">No PDFs match the filter.</li>}
            {shown.map((d) => (
              <li key={d.id} className="flex items-start gap-3 px-3 py-2.5">
                <input type="checkbox" className="mt-1.5" checked={selected.has(d.id)} onChange={() => toggle(d.id)} aria-label={`Select ${d.title}`} />
                {d.status === "ready" ? <FileText className="mt-0.5 h-4 w-4 shrink-0 text-cobalt" aria-hidden="true" /> : <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <Link href={`/library/${d.id}`} className="block truncate text-sm font-medium text-navy hover:text-cobalt">{d.title}</Link>
                  <p className="text-xs text-navy/60">{d.page_count ?? "?"} pages · {mb(d.file_size)}{d.folder ? ` · ${d.folder}` : ""}{d.doi ? ` · DOI ${d.doi}` : ""}{d.reference_id ? " · linked to a reference" : ""}{d.status !== "ready" ? " · no searchable text" : ""}</p>
                  {d.tags.length > 0 && <p className="mt-0.5 flex flex-wrap gap-1">{d.tags.map((t) => <span key={t} className="rounded bg-soft px-1.5 text-xs text-navy">{t}</span>)}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {docs.length > 0 && <p className="mt-2 text-xs text-navy/60">{chosen.length ? `${chosen.length} selected. Search and questions below use only the selected PDFs.` : "Nothing selected: search and questions use all PDFs with searchable text."} <button type="button" className="underline" onClick={() => setSelected(new Set(readable.map((d) => d.id)))}>Select all readable</button> · <button type="button" className="underline" onClick={() => setSelected(new Set())}>Clear</button></p>}
      </section>

      {readable.length > 0 && (
        <>
          <section aria-labelledby="lib-search-h" className="rounded-md border border-line bg-white p-4">
            <h2 id="lib-search-h" className="text-sm font-semibold text-navy">Search inside your PDFs</h2>
            <div className="mt-2 flex gap-2">
              <label htmlFor="lib-q" className="sr-only">Search text</label>
              <input id="lib-q" className={field} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim().length > 1 && runSearch()} placeholder="Words or a phrase, e.g. sample size calculation" />
              <button type="button" disabled={pending || q.trim().length < 2} onClick={runSearch} className="inline-flex items-center gap-1.5 rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50"><Search className="h-4 w-4" aria-hidden="true" /> Search</button>
            </div>
            {searchError && <p role="alert" className="mt-2 text-sm text-red-700">{searchError}</p>}
            {hits && (hits.length === 0 ? <p className="mt-3 text-sm text-navy/65">No passages match.</p> : (
              <ul className="mt-3 space-y-2" aria-label="Search results">
                {hits.map((h, i) => (
                  <li key={i} className="rounded border border-line p-2 text-sm">
                    <Link href={`/library/${h.documentId}?page=${h.page}`} className="text-xs font-medium text-cobalt hover:underline">{h.title}, PDF page {h.page}</Link>
                    <p className="mt-0.5 text-navy/85"><Headline text={h.headline} /></p>
                  </li>
                ))}
              </ul>
            ))}
          </section>

          <section aria-labelledby="lib-ask-h" className="rounded-md border border-line bg-white p-4">
            <h2 id="lib-ask-h" className="text-sm font-semibold text-navy">Ask your PDFs</h2>
            <p className="mt-1 text-xs text-navy/65">Answers are drawn only from passages found in the selected PDFs, and every quoted passage is checked against the PDF text. This uses AI credits.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <label htmlFor="lib-question" className="sr-only">Your question</label>
              <input id="lib-question" className={`${field} flex-1`} value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && question.trim().length >= 5 && ask()} placeholder="e.g. What sample size did the authors use, and how did they justify it?" />
              <button type="button" disabled={pending || question.trim().length < 5} onClick={ask} className="rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50">{pending ? "Working..." : "Ask"}</button>
              <button type="button" disabled={pending || chosen.length < 2 || chosen.length > 4} onClick={compare} title="Select 2 to 4 PDFs" className={btn}>Compare selected ({chosen.length})</button>
            </div>
            {aiError && <p role="alert" className="mt-3 text-sm text-red-700">{aiError}</p>}
            {answer && <AnswerView result={answer.result} />}
            {papers && <CompareView papers={papers} />}
          </section>
        </>
      )}
    </div>
  );
}

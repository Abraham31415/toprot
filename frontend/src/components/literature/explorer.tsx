"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, ChevronLeft, ChevronRight, Download, ExternalLink, FolderPlus, LockOpen, Search, Table2, X } from "lucide-react";
import { listMyStudiesForTools } from "@/app/tools/actions";
import { send as sendEvent } from "@/components/analytics/tracker";
import { saveWorksToStudy } from "@/app/literature/actions";
import { ARTICLE_TYPES, PUBMED_STUDY_TYPES, SOURCE_INFO, type LitSource, type SearchResult, type Work } from "@/lib/literature/types";
import { EVIDENCE_COLUMNS, evidenceCsv, evidenceDoc, evidenceRowFor, workToRef, worksToCsv, type EvidenceRow } from "@/lib/literature/convert";
import { writeRis } from "@/lib/refs/ris";
import { writeBibtex } from "@/lib/refs/bibtex";
import { writeEndnoteXml } from "@/lib/refs/endnote";
import { personToString } from "@/lib/refs/model";

type Form = { keywords: string; title: string; author: string; journal: string; doi: string; yearFrom: string; yearTo: string; openAccess: boolean; articleType: string; studyType: string; sort: string };
const EMPTY: Form = { keywords: "", title: "", author: "", journal: "", doi: "", yearFrom: "", yearTo: "", openAccess: false, articleType: "", studyType: "", sort: "relevance" };

function download(name: string, content: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const input = "w-full min-w-0 rounded-md border border-navy/25 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20 disabled:bg-paper disabled:text-navy/40";
const btn = "inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt hover:text-cobalt disabled:opacity-50";

function authorLine(w: Work) {
  const names = w.authors.map(personToString);
  if (!names.length) return "No authors listed";
  return names.length > 6 ? `${names.slice(0, 6).join("; ")}; and ${names.length - 6} more` : names.join("; ");
}

function citationLine(w: Work) {
  const vol = w.volume ? `${w.volume}${w.issue ? `(${w.issue})` : ""}` : "";
  return [w.journal, w.year, [vol, w.pages].filter(Boolean).join(":")].filter(Boolean).join(". ");
}

export function LiteratureExplorer() {
  const [source, setSource] = useState<LitSource>("openalex");
  const [form, setForm] = useState<Form>(EMPTY);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, Work>>(new Map());
  const [abstracts, setAbstracts] = useState<Record<string, string | null | "loading">>({});
  const [studies, setStudies] = useState<{ id: string; title: string }[]>([]);
  const [studyId, setStudyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const info = SOURCE_INFO[source];

  useEffect(() => {
    let live = true;
    listMyStudiesForTools().then((s) => { if (live) { setStudies(s); setStudyId(s[0]?.id ?? ""); } }).catch(() => {});
    return () => { live = false; };
  }, []);

  const run = useCallback(async (page: number) => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true); setError(null);
    const q = new URLSearchParams({ source, page: String(page), pageSize: "20", sort: form.sort });
    for (const k of ["keywords", "title", "author", "journal", "doi", "yearFrom", "yearTo"] as const) if (form[k].trim()) q.set(k, form[k].trim());
    if (form.openAccess && info.filters.openAccess) q.set("openAccess", "1");
    if (form.articleType && info.filters.articleType) q.set("articleType", form.articleType);
    if (form.studyType && info.filters.studyType) q.set("studyType", form.studyType);
    try {
      const res = await fetch(`/api/literature/search?${q}`, { signal: ctl.signal });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "The search failed."); setResult(null); }
      else { setResult(data as SearchResult); sendEvent({ e: "literature_search", p: window.location.pathname }); }
    } catch (e) {
      if ((e as Error).name !== "AbortError") { setError("Could not reach the search service. Check your connection and try again."); setResult(null); }
    } finally {
      if (abortRef.current === ctl) setLoading(false);
    }
  }, [source, form, info.filters.openAccess, info.filters.articleType, info.filters.studyType]);

  const toggle = (w: Work) => setSelected((m) => { const n = new Map(m); if (n.has(w.id)) n.delete(w.id); else n.set(w.id, w); return n; });
  const chosen = useMemo(() => [...selected.values()], [selected]);
  const refs = () => chosen.map(workToRef);

  async function showAbstract(w: Work) {
    if (w.abstract || !w.pmid) return;
    setAbstracts((a) => ({ ...a, [w.id]: "loading" }));
    try {
      const res = await fetch(`/api/literature/abstract?pmid=${w.pmid}`);
      const d = await res.json();
      setAbstracts((a) => ({ ...a, [w.id]: res.ok ? d.abstract : null }));
    } catch { setAbstracts((a) => ({ ...a, [w.id]: null })); }
  }

  async function save() {
    if (!studyId || !chosen.length) return;
    setSaving(true); setSaveMsg(null);
    try {
      const r = await saveWorksToStudy(studyId, chosen.map((w) => ({ doi: w.doi, pmid: w.pmid, openalexId: w.openalexId, title: w.title })));
      if (r.error) setSaveMsg({ ok: false, text: r.error });
      else {
        const parts = [`${r.saved} saved`, r.skipped.length ? `${r.skipped.length} already in the study` : "", r.failed.length ? `${r.failed.length} could not be saved (${r.failed[0].reason})` : ""].filter(Boolean);
        setSaveMsg({ ok: r.failed.length === 0, text: parts.join(", ") + "." });
      }
    } catch { setSaveMsg({ ok: false, text: "Could not reach the server. Try again." }); }
    finally { setSaving(false); }
  }

  const addToEvidence = () => setEvidence((rows) => { const have = new Set(rows.map((r) => r.workId)); return [...rows, ...chosen.filter((w) => !have.has(w.id)).map(evidenceRowFor)]; });
  const setCell = (i: number, id: string, v: string) => setEvidence((rows) => rows.map((r, j) => (j === i ? { ...r, [id]: v } : r)));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const typeOptions = source === "openalex" ? ARTICLE_TYPES.openalex : source === "crossref" ? ARTICLE_TYPES.crossref : [];
  const pages = result ? Math.max(1, Math.ceil(Math.min(result.total, 10000) / result.pageSize)) : 1;

  return (
    <div>
      <div role="tablist" aria-label="Source" className="flex flex-wrap gap-2">
        {(Object.keys(SOURCE_INFO) as LitSource[]).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={source === s} onClick={() => { setSource(s); setResult(null); setError(null); }}
            className={`rounded-md border px-4 py-2 text-sm font-medium ${source === s ? "border-cobalt bg-cobalt text-white" : "border-navy/25 bg-white text-navy hover:border-cobalt"}`}>
            {SOURCE_INFO[s].name}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-navy/70">{info.blurb}</p>

      <form onSubmit={(e) => { e.preventDefault(); void run(1); }} className="mt-4 rounded-xl border border-line bg-white p-4" aria-label="Search">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([["keywords", "Keywords"], ["title", "Title words"], ["author", source === "pubmed" ? "Author (Surname Initials)" : "Author"], ["journal", "Journal"], ["doi", "DOI"]] as const).map(([k, label]) => (
            <div key={k} className="min-w-0">
              <label htmlFor={`lit-${k}`} className="block text-xs font-medium text-navy/70">{label}</label>
              <input id={`lit-${k}`} className={input} value={form[k]} onChange={(e) => set(k, e.target.value)} maxLength={200} />
            </div>
          ))}
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <div><label htmlFor="lit-from" className="block text-xs font-medium text-navy/70">Year from</label><input id="lit-from" inputMode="numeric" className={input} value={form.yearFrom} onChange={(e) => set("yearFrom", e.target.value.replace(/\D/g, "").slice(0, 4))} /></div>
            <div><label htmlFor="lit-to" className="block text-xs font-medium text-navy/70">Year to</label><input id="lit-to" inputMode="numeric" className={input} value={form.yearTo} onChange={(e) => set("yearTo", e.target.value.replace(/\D/g, "").slice(0, 4))} /></div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={`flex items-center gap-2 text-sm ${info.filters.openAccess ? "text-navy" : "text-navy/40"}`} title={info.filters.openAccess ? undefined : `${info.name} does not record open access reliably`}>
            <input type="checkbox" disabled={!info.filters.openAccess} checked={form.openAccess && info.filters.openAccess} onChange={(e) => set("openAccess", e.target.checked)} /> Open access only
          </label>
          {source === "pubmed" ? (
            <div><label htmlFor="lit-study" className="block text-xs font-medium text-navy/70">Study type (assigned by PubMed)</label>
              <select id="lit-study" className={input} value={form.studyType} onChange={(e) => set("studyType", e.target.value)}><option value="">Any</option>{PUBMED_STUDY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          ) : (
            <div><label htmlFor="lit-type" className="block text-xs font-medium text-navy/70">Work type</label>
              <select id="lit-type" className={input} value={form.articleType} onChange={(e) => set("articleType", e.target.value)}><option value="">Any</option>{typeOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          )}
          <div><label htmlFor="lit-sort" className="block text-xs font-medium text-navy/70">Sort by</label>
            <select id="lit-sort" className={input} value={form.sort} onChange={(e) => set("sort", e.target.value)}><option value="relevance">Relevance</option><option value="newest">Newest first</option>{source !== "pubmed" && <option value="cited">Most cited</option>}</select></div>
          <div className="flex items-end"><button type="submit" disabled={loading} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-cobalt px-5 py-2.5 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-60"><Search className="h-4 w-4" aria-hidden="true" />{loading ? "Searching..." : "Search"}</button></div>
        </div>
      </form>

      <div aria-live="polite" className="mt-4">
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {result && !error && (
          <>
            <p className="text-sm text-navy/70">
              {result.total.toLocaleString("en-GB")} {result.total === 1 ? "result" : "results"} from {info.name}. Showing page {result.page} of {pages.toLocaleString("en-GB")}.
              {result.total > 10000 && " Only the first 10,000 can be paged through. Narrow the search to see the rest."}
            </p>
            {result.notes.map((n) => <p key={n} className="mt-1 text-xs text-navy/60">{n}</p>)}
          </>
        )}
      </div>

      {result && result.works.length === 0 && !error && <p className="mt-4 rounded-lg border border-dashed border-navy/25 p-6 text-center text-sm text-navy/65">No records matched. Try fewer or broader terms.</p>}

      <ul className="mt-4 space-y-3">
        {result?.works.map((w) => {
          const abs = w.abstract ?? (typeof abstracts[w.id] === "string" && abstracts[w.id] !== "loading" ? (abstracts[w.id] as string) : undefined);
          return (
            <li key={w.id} className="rounded-lg border border-line bg-white p-4">
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0" aria-label={`Select: ${w.title}`} checked={selected.has(w.id)} onChange={() => toggle(w)} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-navy">{w.landingUrl ? <a href={w.landingUrl} target="_blank" rel="noopener noreferrer" className="hover:text-cobalt">{w.title}</a> : w.title}</h3>
                  <p className="mt-1 text-sm text-navy/75">{authorLine(w)}</p>
                  <p className="text-sm text-navy/65">{citationLine(w) || "No journal details supplied"}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {w.sourceType && <span className="rounded-full bg-soft px-2 py-0.5 text-cobalt-dark">{w.sourceType}</span>}
                    {w.publicationTypes?.slice(0, 3).map((t) => <span key={t} className="rounded-full bg-soft px-2 py-0.5 text-cobalt-dark">{t}</span>)}
                    {w.citedBy != null && <span className="text-navy/60">Cited by {w.citedBy.toLocaleString("en-GB")}</span>}
                    {w.doi && <a href={`https://doi.org/${w.doi}`} target="_blank" rel="noopener noreferrer" className="text-navy/60 underline">DOI {w.doi}</a>}
                    {w.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${w.pmid}/`} target="_blank" rel="noopener noreferrer" className="text-navy/60 underline">PMID {w.pmid}</a>}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {w.landingUrl && <a href={w.landingUrl} target="_blank" rel="noopener noreferrer" className={btn}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open original</a>}
                    {w.openAccess?.isOa && w.openAccess.url && <a href={w.openAccess.url} target="_blank" rel="noopener noreferrer" className={`${btn} border-teal text-teal-ink`}><LockOpen className="h-3.5 w-3.5" aria-hidden="true" /> Free version (reported by {SOURCE_INFO[w.source].name})</a>}
                    {!w.abstract && w.pmid && abs === undefined && <button type="button" className={btn} onClick={() => showAbstract(w)} disabled={abstracts[w.id] === "loading"}>{abstracts[w.id] === "loading" ? "Loading..." : "Show abstract"}</button>}
                  </div>
                  {abstracts[w.id] === null && <p className="mt-2 text-xs text-navy/60">PubMed has no abstract for this record.</p>}
                  {abs && <details className="mt-2 text-sm"><summary className="cursor-pointer text-navy/75">Abstract (as supplied by {SOURCE_INFO[w.source].name}; copyright stays with the publisher)</summary><p className="mt-1 whitespace-pre-line text-navy/85">{abs}</p></details>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {result && result.works.length > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <button type="button" className={btn} disabled={loading || result.page <= 1} onClick={() => void run(result.page - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous</button>
          <span className="text-xs text-navy/60">Page {result.page}</span>
          <button type="button" className={btn} disabled={loading || result.page >= pages} onClick={() => void run(result.page + 1)}>Next <ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      )}

      {chosen.length > 0 && (
        <section aria-label="Selected records" className="sticky bottom-3 z-10 mt-6 rounded-xl border border-cobalt bg-white p-4 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-navy">{chosen.length} selected</p>
            <button type="button" className="inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy" onClick={() => setSelected(new Map())}><X className="h-3.5 w-3.5" aria-hidden="true" /> Clear</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => download("references.ris", writeRis(refs()), "application/x-research-info-systems")}><Download className="h-3.5 w-3.5" aria-hidden="true" /> RIS</button>
            <button type="button" className={btn} onClick={() => download("references.bib", writeBibtex(refs()), "text/x-bibtex")}><Download className="h-3.5 w-3.5" aria-hidden="true" /> BibTeX</button>
            <button type="button" className={btn} onClick={() => download("references.xml", writeEndnoteXml(refs()), "application/xml")}><Download className="h-3.5 w-3.5" aria-hidden="true" /> EndNote XML</button>
            <button type="button" className={btn} onClick={() => download("references.csv", worksToCsv(chosen), "text/csv;charset=utf-8")}><Download className="h-3.5 w-3.5" aria-hidden="true" /> CSV</button>
            <button type="button" className={btn} onClick={addToEvidence}><Table2 className="h-3.5 w-3.5" aria-hidden="true" /> Add to evidence table</button>
          </div>
          <div className="mt-3 border-t border-line pt-3">
            {studies.length === 0 ? (
              <p className="text-xs text-navy/65"><a href="/login" className="font-medium text-cobalt underline">Log in</a> as a student to save these to a research project.</p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1"><label htmlFor="lit-study-pick" className="block text-xs font-medium text-navy/70">Save to project</label>
                  <select id="lit-study-pick" className={input} value={studyId} onChange={(e) => setStudyId(e.target.value)}>{studies.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
                <button type="button" disabled={saving} onClick={save} className="inline-flex items-center gap-1.5 rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50"><FolderPlus className="h-4 w-4" aria-hidden="true" /> {saving ? "Saving..." : "Save"}</button>
              </div>
            )}
            {saveMsg && <p role="status" className={`mt-2 text-sm ${saveMsg.ok ? "text-teal-ink" : "text-red-700"}`}>{saveMsg.text}</p>}
            <p className="mt-2 text-xs text-navy/55">Each record is fetched again from its source when saved, so only verified bibliographic details are stored.</p>
          </div>
        </section>
      )}

      {evidence.length > 0 && (
        <section aria-label="Evidence table" className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-navy"><BookOpenCheck className="h-5 w-5 text-cobalt" aria-hidden="true" /> Evidence table</h2>
            <div className="flex gap-2">
              <button type="button" className={btn} onClick={() => download("evidence-table.csv", evidenceCsv(evidence), "text/csv;charset=utf-8")}><Download className="h-3.5 w-3.5" aria-hidden="true" /> CSV</button>
              <button type="button" className={btn} onClick={() => download("evidence-table.doc", evidenceDoc(evidence, "Evidence table"), "application/msword")}><Download className="h-3.5 w-3.5" aria-hidden="true" /> Word (.doc)</button>
              <button type="button" className={btn} onClick={() => setEvidence([])}>Clear table</button>
            </div>
          </div>
          <p className="mt-1 text-xs text-navy/60">Only the citation details are filled in. Read each paper and complete the other columns yourself. ToProt does not summarise findings.</p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
            <table className="min-w-[1100px] w-full text-sm">
              <thead><tr className="bg-paper text-left text-xs text-navy/70"><th className="px-2 py-2">Study</th><th className="px-2 py-2">Journal and year</th>{EVIDENCE_COLUMNS.map((c) => <th key={c.id} className="px-2 py-2">{c.label}</th>)}<th className="px-2 py-2"><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {evidence.map((r, i) => (
                  <tr key={r.workId} className="border-t border-line align-top">
                    <td className="px-2 py-2 font-medium text-navy">{r.study}<span className="block text-xs font-normal text-navy/60">{r.title}</span></td>
                    <td className="px-2 py-2 text-navy/75">{r.journal} {r.year}</td>
                    {EVIDENCE_COLUMNS.map((c) => <td key={c.id} className="px-1 py-1"><textarea aria-label={`${c.label} for ${r.study}`} rows={3} className="w-44 rounded border border-navy/20 bg-white p-1 text-xs" value={r[c.id]} onChange={(e) => setCell(i, c.id, e.target.value)} /></td>)}
                    <td className="px-2 py-2"><button type="button" aria-label={`Remove ${r.study}`} className="text-navy/50 hover:text-red-700" onClick={() => setEvidence((rows) => rows.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="mt-10 text-xs leading-5 text-navy/60">
        Records come from OpenAlex, PubMed (US National Library of Medicine) and Crossref, shown as those sources supply them, which can contain errors. Check details against the publisher&apos;s page before you cite. These are bibliographic
        records and abstracts only. ToProt does not hold full texts. &quot;Open original&quot; goes to the publisher or DOI page, and a free-version link is shown only when the source reports one. ToProt is not affiliated with or endorsed by these services.
      </p>
    </div>
  );
}

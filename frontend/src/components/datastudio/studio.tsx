"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Database, FileCode2, FlaskConical, History, Loader2, Pin, Redo2, RotateCcw, Save, Sparkles, Table2, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ds";
import { applyAll, OP_LABEL, type Operation } from "@/lib/datastudio/transform";
import { pythonScript, datasetToCsv } from "@/lib/datastudio/export";
import { METHOD_BY_ID } from "@/lib/datastudio/engine/registry";
import { normalizeTier } from "@/lib/datastudio/entitlements";
import { nRows, type Dataset } from "@/lib/datastudio/types";
import type { Limits } from "@/lib/datastudio/server";
import {
  authorizeExport, combineDatasets, deleteAnalysis, deleteDataset, listAnalyses, loadDataset, restoreVersion, runAnalysisAction, saveChart, saveVersion, updateAnalysis,
  type SavedAnalysis, type VersionMeta,
} from "@/app/studies/[id]/data/actions";
import { AnalysisPanel } from "./analysis-panel";
import { Analyst } from "./analyst";
import { CleanPanel } from "./clean-panel";
import { DataGrid, VariableView } from "./data-grid";
import { ProfileView } from "./profile-view";
import { DEFAULT_REPORT, ResultView, type ReportStyle } from "./result-view";
import { Visualize } from "./visualize";
import { download } from "./chart";

type Section = "data" | "analyze" | "visualize" | "ai" | "results";
type DataView = "grid" | "variables" | "profile" | "clean" | "history";
export type VersionListItem = { id: string; version_no: number; change_description: string; created_at: string; n_rows: number; n_cols: number; checksum: string; creator: string | null; operations: Operation[] };

const SECTIONS: { id: Section; label: string; icon: typeof Database }[] = [
  { id: "data", label: "Data Manager", icon: Database }, { id: "analyze", label: "Statistical Laboratory", icon: FlaskConical },
  { id: "visualize", label: "Visualization Studio", icon: BarChart3 }, { id: "ai", label: "AI Research Analyst", icon: Sparkles }, { id: "results", label: "Results and Reporting", icon: Table2 },
];

export function DataStudio(props: {
  studyId: string; datasetId: string; datasetName: string; datasets: { id: string; name: string }[]; versions: VersionListItem[];
  canWrite: boolean; isOwner: boolean; initialAnalyses: SavedAnalysis[];
}) {
  const { studyId, datasetId } = props;
  const router = useRouter();
  const [section, setSection] = useState<Section>("data");
  const [view, setView] = useState<DataView>("grid");
  const [versionId, setVersionId] = useState<string | null>(null);
  const [base, setBase] = useState<Dataset | null>(null);
  const [meta, setMeta] = useState<VersionMeta | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [ops, setOps] = useState<Operation[]>([]);
  const [redo, setRedo] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [desc, setDesc] = useState("");
  const [analyses, setAnalyses] = useState<SavedAnalysis[]>(props.initialAnalyses);
  const [current, setCurrent] = useState<SavedAnalysis | null>(props.initialAnalyses[0] ?? null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ReportStyle>(DEFAULT_REPORT);
  const latest = props.versions[0];
  const viewingOld = !!versionId && versionId !== latest?.id;

  const accept = useCallback((r: Awaited<ReturnType<typeof loadDataset>>) => {
    setLoading(false);
    if (!r.ok) { setMsg({ kind: "error", text: r.error }); return; }
    setBase(r.data.dataset); setMeta(r.data.version); setLimits(r.data.limits); setVersionId(r.data.version.id); setOps([]); setRedo([]);
  }, []);
  /** Loads a version (the current one by default). Called from event handlers. */
  const load = useCallback(async (vid?: string) => {
    setLoading(true); setMsg(null);
    accept(await loadDataset(studyId, datasetId, vid));
  }, [studyId, datasetId, accept]);
  useEffect(() => {
    let live = true;
    loadDataset(studyId, datasetId).then((r) => { if (live) accept(r); });
    return () => { live = false; };
  }, [studyId, datasetId, accept]);

  const working = useMemo(() => {
    if (!base) return { data: null as Dataset | null, error: null as string | null };
    try { return { data: applyAll(base, ops).dataset, error: null }; } catch (e) { return { data: base, error: (e as Error).message }; }
  }, [base, ops]);
  const data = working.data;
  const editable = props.canWrite && !viewingOld;

  useEffect(() => {
    if (!ops.length) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [ops.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "z" && !e.shiftKey && ops.length) { e.preventDefault(); undo(); }
      else if ((e.key === "y" || (e.key === "z" && e.shiftKey)) && redo.length) { e.preventDefault(); redoOne(); }
      else if (e.key === "s" && ops.length && editable) { e.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  function addOps(o: Operation[]) {
    // Merge consecutive cell edits into one step so the history stays readable.
    setOps((cur) => {
      const last = cur[cur.length - 1];
      if (o.length === 1 && o[0].op === "set_cells" && last?.op === "set_cells" && last.edits.length + o[0].edits.length <= 5000) return [...cur.slice(0, -1), { op: "set_cells", edits: [...last.edits, ...o[0].edits] }];
      return [...cur, ...o];
    });
    setRedo([]);
  }
  function undo() { setOps((cur) => { if (!cur.length) return cur; setRedo((r) => [cur[cur.length - 1], ...r]); return cur.slice(0, -1); }); }
  function redoOne() { setRedo((r) => { if (!r.length) return r; setOps((cur) => [...cur, r[0]]); return r.slice(1); }); }
  async function save() {
    if (!meta || !ops.length) return;
    setSaving(true);
    const r = await saveVersion(studyId, datasetId, meta.id, ops, desc);
    setSaving(false);
    if (!r.ok) { setMsg({ kind: "error", text: r.error }); return; }
    setMsg({ kind: "ok", text: `Saved as version ${r.data.versionNo}.` }); setDesc("");
    router.refresh();
    await load();
  }
  const canExport = useCallback(async (f: "csv" | "svg" | "png" | "python", what = "file") => {
    const r = await authorizeExport(studyId, f, `${props.datasetName}: ${what}`);
    if (!r.ok) setMsg({ kind: "error", text: r.error });
    return r.ok;
  }, [studyId, props.datasetName]);

  async function run(method: string, params: Record<string, unknown>) {
    if (!meta) return;
    if (ops.length) { setMsg({ kind: "error", text: "Save or discard your unsaved data changes first. Analyses always run on a saved version, so they can be reproduced." }); return; }
    setRunning(true); setMsg(null);
    const r = await runAnalysisAction(studyId, datasetId, meta.id, method, params);
    setRunning(false);
    if (!r.ok) { setMsg({ kind: "error", text: r.error }); return; }
    setAnalyses((a) => [r.data, ...a]); setCurrent(r.data); setSection("results");
  }
  async function refreshAnalyses() { const r = await listAnalyses(studyId, datasetId); if (r.ok) setAnalyses(r.data); }

  const tier = normalizeTier(limits?.method_tier);
  const versionOf = (vid: string) => props.versions.find((v) => v.id === vid);

  return (
    <div className="space-y-4">
      {/* Workspace bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-card">
        <label className="flex items-center gap-2 text-sm"><span className="sr-only">Dataset</span>
          <select value={datasetId} onChange={(e) => { if (!ops.length || confirm("Discard unsaved changes?")) router.push(`/studies/${studyId}/data/${e.target.value}`); }} className="rounded-control border border-line-strong bg-surface px-2 py-1.5 text-sm font-medium">
            {props.datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft">Version
          <select value={versionId ?? ""} onChange={(e) => { if (!ops.length || confirm("Discard unsaved changes?")) void load(e.target.value); }} className="rounded-control border border-line-strong bg-surface px-2 py-1.5 text-sm">
            {props.versions.map((v) => <option key={v.id} value={v.id}>v{v.version_no}{v.id === latest?.id ? " (current)" : ""}</option>)}
          </select>
        </label>
        {data && <span className="type-caption">{nRows(data).toLocaleString("en-GB")} rows × {data.variables.length} variables{meta ? ` · checksum ${meta.checksum.slice(0, 10)}` : ""}</span>}
        {limits && <span className="type-caption">Plan: {limits.plan}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {ops.length > 0 && <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-ink">{ops.length} unsaved step{ops.length === 1 ? "" : "s"}</span>}
          <button type="button" onClick={undo} disabled={!ops.length} aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" className="rounded-control p-2 text-ink-soft hover:bg-hover disabled:opacity-40"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={redoOne} disabled={!redo.length} aria-label="Redo (Ctrl+Y)" title="Redo (Ctrl+Y)" className="rounded-control p-2 text-ink-soft hover:bg-hover disabled:opacity-40"><Redo2 className="h-4 w-4" /></button>
          {editable && ops.length > 0 && <input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} placeholder="Describe this change (optional)" aria-label="Change description" className="w-56 rounded-control border border-line-strong px-2 py-1.5 text-sm" />}
          {editable && <Button size="sm" onClick={save} loading={saving} disabled={!ops.length}><Save className="h-4 w-4" aria-hidden="true" />Save version</Button>}
        </div>
      </div>
      {viewingOld && <p className="rounded-control border border-info-line bg-info-bg p-2 text-sm text-info-ink">You are viewing version {meta?.version_no}, an earlier version. It is read-only; restore it from History to continue from it.</p>}
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`rounded-control border p-2 text-sm ${msg.kind === "error" ? "border-danger-line bg-danger-bg text-danger-ink" : "border-success-line bg-success-bg text-success-ink"}`}>{msg.text}</p>}
      {working.error && <p role="alert" className="rounded-control border border-danger-line bg-danger-bg p-2 text-sm text-danger-ink">{working.error} Undo the last step.</p>}

      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Data Studio sections" className="flex gap-1 overflow-x-auto lg:flex-col">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => setSection(s.id)} aria-current={section === s.id ? "page" : undefined}
              className={`flex items-center gap-2 whitespace-nowrap rounded-control px-3 py-2 text-left text-sm font-medium ${section === s.id ? "bg-surface-soft text-primary-hover" : "text-ink-soft hover:bg-hover"}`}>
              <s.icon className="h-4 w-4 flex-none" aria-hidden="true" />{s.label}
            </button>
          ))}
        </nav>

        <main className="min-w-0 rounded-card border border-line bg-surface p-4 shadow-card" aria-busy={loading}>
          {loading || !data ? (
            <p className="flex items-center gap-2 text-sm text-ink-soft" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading and verifying the dataset…</p>
          ) : section === "data" ? (
            <div className="space-y-4">
              <div role="tablist" aria-label="Data views" className="flex flex-wrap gap-1 border-b border-line">
                {([["grid", "Data"], ["variables", "Variables"], ["profile", "Quality profile"], ["clean", "Clean and transform"], ["history", "History"]] as [DataView, string][]).map(([k, l]) => (
                  <button key={k} role="tab" type="button" aria-selected={view === k} onClick={() => setView(k)} className={`px-3 py-2 text-sm font-medium ${view === k ? "border-b-2 border-primary text-primary-hover" : "text-ink-soft hover:text-ink"}`}>{l}</button>
                ))}
                <button type="button" className="ml-auto px-2 text-sm text-primary hover:underline" onClick={async () => { if (await canExport("csv", "dataset")) download(`${props.datasetName} v${meta?.version_no}.csv`, datasetToCsv(data), "text/csv"); }}>Export CSV</button>
              </div>
              {view === "grid" && <DataGrid dataset={data} editable={editable} onOps={addOps} />}
              {view === "variables" && <VariableView key={`${versionId}-${ops.length}`} dataset={data} editable={editable} onOps={addOps} />}
              {view === "profile" && <ProfileView dataset={data} datasetName={props.datasetName} canExport={(f) => canExport(f, "dictionary")} />}
              {view === "clean" && (editable ? <CleanPanel dataset={data} onAdd={(o) => addOps([o])} combine={<Combine studyId={studyId} datasetId={datasetId} datasets={props.datasets} busy={!!ops.length} onDone={async (t) => { setMsg({ kind: "ok", text: t }); router.refresh(); await load(); }} onError={(t) => setMsg({ kind: "error", text: t })} />} /> : <p className="type-support">Cleaning needs editor access to the current version.</p>)}
              {view === "history" && (
                <div className="space-y-4">
                  {ops.length > 0 && (
                    <section><h3 className="type-card">Unsaved steps</h3>
                      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-soft">{ops.map((o, i) => <li key={i}>{OP_LABEL[o.op]} <code className="text-xs text-ink-muted">{JSON.stringify(o).slice(0, 140)}</code></li>)}</ol>
                    </section>
                  )}
                  <section><h3 className="type-card">Saved versions</h3>
                    <ul className="mt-2 divide-y divide-line rounded-control border border-line">
                      {props.versions.map((v) => (
                        <li key={v.id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
                          <div className="min-w-0">
                            <p className="font-medium text-ink">Version {v.version_no}{v.id === latest?.id && <span className="ml-2 rounded-full bg-success-bg px-2 py-0.5 text-xs text-success-ink">current</span>}</p>
                            <p className="text-ink-soft">{v.change_description || "No description"}</p>
                            <p className="type-caption">{new Date(v.created_at).toLocaleString("en-GB")}{v.creator ? ` by ${v.creator}` : ""} · {v.n_rows.toLocaleString("en-GB")} × {v.n_cols} · SHA-256 {v.checksum.slice(0, 12)}…</p>
                            {v.operations.length > 0 && <details className="mt-1"><summary className="cursor-pointer text-xs text-primary">{v.operations.length} step(s)</summary><ol className="mt-1 list-decimal pl-5 text-xs text-ink-muted">{v.operations.map((o, i) => <li key={i}>{OP_LABEL[o.op]}: <code>{JSON.stringify(o).slice(0, 160)}</code></li>)}</ol></details>}
                          </div>
                          <div className="flex gap-2">
                            <button type="button" className="text-xs text-primary hover:underline" onClick={() => void load(v.id)}>View</button>
                            {props.canWrite && v.id !== latest?.id && <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={async () => { const r = await restoreVersion(studyId, datasetId, v.id); if (!r.ok) setMsg({ kind: "error", text: r.error }); else { setMsg({ kind: "ok", text: `Restored as version ${r.data.versionNo}.` }); router.refresh(); await load(); } }}><RotateCcw className="h-3 w-3" aria-hidden="true" />Restore</button>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                  {props.isOwner && <DeleteDataset studyId={studyId} datasetId={datasetId} name={props.datasetName} onError={(t) => setMsg({ kind: "error", text: t })} />}
                </div>
              )}
            </div>
          ) : section === "analyze" ? (
            <AnalysisPanel dataset={data} tier={tier} plan={limits?.plan} canRun={props.canWrite && !ops.length} running={running} onRun={run} />
          ) : section === "visualize" ? (
            <Visualize dataset={data} canExport={(f) => canExport(f, "chart")} canSave={props.canWrite && !!meta}
              onSave={async (spec, title) => { const r = await saveChart(studyId, datasetId, meta!.id, spec.chart.kind, title, spec); setMsg(r.ok ? { kind: "ok", text: "Chart settings saved to the project." } : { kind: "error", text: r.error }); }} />
          ) : section === "ai" ? (
            <Analyst studyId={studyId} analyses={analyses} canUse={props.canWrite} initialId={current?.id} />
          ) : (
            <Results analyses={analyses} current={current} setCurrent={setCurrent} report={report} setReport={setReport} canWrite={props.canWrite} isOwner={props.isOwner}
              versionOf={versionOf} latestId={latest?.id} canExport={canExport} datasetName={props.datasetName}
              onPin={async (a) => { await updateAnalysis(studyId, a.id, { pinned: !a.pinned }); await refreshAnalyses(); }}
              onDelete={async (a) => { if (!confirm("Delete this saved result? This cannot be undone.")) return; const r = await deleteAnalysis(studyId, a.id); if (!r.ok) setMsg({ kind: "error", text: r.error }); else { setCurrent(null); await refreshAnalyses(); } }}
              onRerun={async (a) => { if (!meta) return; setSection("results"); await run(a.method, a.config); }} />
          )}
        </main>
      </div>
    </div>
  );
}

function Results(p: {
  analyses: SavedAnalysis[]; current: SavedAnalysis | null; setCurrent: (a: SavedAnalysis) => void; report: ReportStyle; setReport: (r: ReportStyle) => void;
  canWrite: boolean; isOwner: boolean; versionOf: (id: string) => VersionListItem | undefined; latestId?: string; datasetName: string;
  canExport: (f: "csv" | "svg" | "png" | "python", what?: string) => Promise<boolean>; onPin: (a: SavedAnalysis) => void; onDelete: (a: SavedAnalysis) => void; onRerun: (a: SavedAnalysis) => void;
}) {
  const sorted = [...p.analyses].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));
  if (!sorted.length) return <p className="type-support">No results yet. Run an analysis in the Statistical Laboratory.</p>;
  const cur = p.current ?? sorted[0];
  const v = cur ? p.versionOf(cur.version_id) : undefined;
  return (
    <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
      <aside aria-label="Analysis history" className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><History className="h-4 w-4" aria-hidden="true" />History</h3>
        <ul className="max-h-[70vh] space-y-1 overflow-y-auto">
          {sorted.map((a) => (
            <li key={a.id}><button type="button" onClick={() => p.setCurrent(a)} aria-current={cur?.id === a.id ? "true" : undefined} className={`w-full rounded-control px-2 py-1.5 text-left text-sm ${cur?.id === a.id ? "bg-surface-soft" : "hover:bg-hover"}`}>
              <span className="flex items-center gap-1 font-medium text-ink">{a.pinned && <Pin className="h-3 w-3 text-primary" aria-label="Pinned" />}{a.title}</span>
              <span className="type-caption">{METHOD_BY_ID.get(a.method)?.label} · v{p.versionOf(a.version_id)?.version_no ?? "?"}{a.version_id !== p.latestId ? " (older data)" : ""} · {new Date(a.created_at).toLocaleDateString("en-GB")}</span>
            </button></li>
          ))}
        </ul>
      </aside>
      {cur?.result && (
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-canvas p-2 text-sm">
            <label className="flex items-center gap-1">Decimals<select value={p.report.decimals} onChange={(e) => p.setReport({ ...p.report, decimals: Number(e.target.value) })} className="rounded border border-line-strong px-1 py-0.5">{[1, 2, 3, 4].map((d) => <option key={d}>{d}</option>)}</select></label>
            <label className="flex items-center gap-1">P-values<select value={p.report.pStyle} onChange={(e) => p.setReport({ ...p.report, pStyle: e.target.value as ReportStyle["pStyle"] })} className="rounded border border-line-strong px-1 py-0.5"><option value="apa">p &lt; 0.001 style</option><option value="exact">Exact</option><option value="stars">With stars</option></select></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={!p.report.leadingZero} onChange={(e) => p.setReport({ ...p.report, leadingZero: !e.target.checked })} />No leading zero (APA)</label>
            <span className="type-caption">Formatting never changes the stored result.</span>
            <div className="ml-auto flex gap-3">
              {p.canWrite && <button type="button" className="text-primary hover:underline" onClick={() => p.onPin(cur)}>{cur.pinned ? "Unpin" : "Pin"}</button>}
              {p.canWrite && <button type="button" className="text-primary hover:underline" onClick={() => p.onRerun(cur)} title="Run the same settings on the current version">Re-run on current version</button>}
              <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={async () => { if (await p.canExport("python", cur.method)) download(`${cur.title}.py`, pythonScript({ datasetName: p.datasetName, versionNo: v?.version_no ?? 0, checksum: v?.checksum ?? "", method: cur.method, params: cur.config, csvName: `${p.datasetName} v${v?.version_no ?? 0}.csv`, operations: v?.operations }), "text/x-python"); }}><FileCode2 className="h-4 w-4" aria-hidden="true" />Python script</button>
              {p.isOwner && <button type="button" aria-label="Delete result" className="text-danger-ink" onClick={() => p.onDelete(cur)}><Trash2 className="h-4 w-4" /></button>}
            </div>
          </div>
          {cur.version_id !== p.latestId && <p className="rounded-control border border-warning-line bg-warning-bg p-2 text-sm text-warning-ink">This result was computed on version {v?.version_no ?? "?"}; the dataset has changed since. Re-run it if the result should reflect the current data.</p>}
          <ResultView result={cur.result} style={p.report} canExport={(f) => p.canExport(f, cur.title)} />
          <details className="rounded-control border border-line p-3 text-xs text-ink-soft">
            <summary className="cursor-pointer font-medium text-ink">Reproducibility record</summary>
            <dl className="mt-2 grid grid-cols-[160px_1fr] gap-1">
              <dt>Method</dt><dd>{cur.method}</dd>
              <dt>Settings</dt><dd><code>{JSON.stringify(cur.config)}</code></dd>
              <dt>Dataset version</dt><dd>v{v?.version_no} · SHA-256 {v?.checksum}</dd>
              <dt>Engine</dt><dd>{cur.engine_version}</dd>
              <dt>Computed</dt><dd>{new Date(cur.created_at).toLocaleString("en-GB")} in {cur.duration_ms} ms</dd>
            </dl>
          </details>
        </div>
      )}
    </div>
  );
}

function Combine({ studyId, datasetId, datasets, busy, onDone, onError }: { studyId: string; datasetId: string; datasets: { id: string; name: string }[]; busy: boolean; onDone: (t: string) => void; onError: (t: string) => void }) {
  const others = datasets.filter((d) => d.id !== datasetId);
  const [src, setSrc] = useState(others[0]?.id ?? "");
  const [how, setHow] = useState<"append" | "left" | "inner">("left");
  const [keys, setKeys] = useState("");
  const [working, setWorking] = useState(false);
  if (!others.length) return null;
  return (
    <div className="rounded-control border border-line p-2">
      <p className="type-eyebrow px-1">Combine datasets</p>
      <div className="mt-1 space-y-2 text-sm">
        <select value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Dataset to combine" className="w-full rounded border border-line-strong px-1 py-1">{others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select value={how} onChange={(e) => setHow(e.target.value as typeof how)} aria-label="How to combine" className="w-full rounded border border-line-strong px-1 py-1"><option value="left">Merge (keep all rows here)</option><option value="inner">Merge (matching rows only)</option><option value="append">Append rows</option></select>
        {how !== "append" && <input value={keys} onChange={(e) => setKeys(e.target.value)} placeholder="Key variables, e.g. id" aria-label="Key variables" className="w-full rounded border border-line-strong px-1 py-1" />}
        <Button size="sm" variant="secondary" loading={working} disabled={busy} onClick={async () => { setWorking(true); const r = await combineDatasets(studyId, datasetId, src, how, keys.split(",").map((k) => k.trim()).filter(Boolean)); setWorking(false); if (r.ok) onDone(`Saved as version ${r.data.versionNo}. ${r.data.summary}`); else onError(r.error); }}>Combine and save</Button>
        {busy && <p className="type-caption">Save your unsaved steps first.</p>}
      </div>
    </div>
  );
}

function DeleteDataset({ studyId, datasetId, name, onError }: { studyId: string; datasetId: string; name: string; onError: (t: string) => void }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  return (
    <section className="rounded-control border border-danger-line p-3">
      <h3 className="text-sm font-semibold text-danger-ink">Delete dataset</h3>
      <p className="type-caption mt-1">Removes every version and its files. Saved results that used it are deleted too. This cannot be undone. Type the dataset name to confirm.</p>
      <div className="mt-2 flex gap-2"><input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Dataset name to confirm" className="rounded-control border border-line-strong px-2 py-1 text-sm" />
        <Button size="sm" variant="secondary" disabled={typed !== name} onClick={async () => { const r = await deleteDataset(studyId, datasetId, typed); if (!r.ok) onError(r.error); else router.push(`/studies/${studyId}/data`); }}>Delete</Button></div>
    </section>
  );
}

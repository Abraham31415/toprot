"use client";

import { useMemo, useRef, useState } from "react";
import { Download, Save } from "lucide-react";
import { Button } from "@/components/ds";
import { buildChart, CHART_KINDS, type ChartSpec } from "@/lib/datastudio/chart-builder";
import { DEFAULT_STYLE, PALETTES, type ChartStyle, type Palette } from "@/lib/datastudio/chart-style";
import type { Dataset } from "@/lib/datastudio/types";
import { Chart, download, pngBlob, svgString } from "./chart";

const TEMPLATE_KEY = "toprot-ds-chart-templates";
type Template = { name: string; style: Partial<ChartStyle> };
const loadTemplates = (): Template[] => { try { return JSON.parse(localStorage.getItem(TEMPLATE_KEY) ?? "[]"); } catch { return []; } };

/** Chart builder and graphical editor. Charts are drawn from the loaded dataset version with deterministic code. */
export function Visualize({ dataset, canExport, onSave, canSave }: { dataset: Dataset; canExport: (f: "svg" | "png") => Promise<boolean>; onSave: (spec: { chart: ChartSpec; style: Partial<ChartStyle> }, title: string) => Promise<void>; canSave: boolean }) {
  const [spec, setSpec] = useState<ChartSpec>({ kind: "histogram" });
  const [style, setStyle] = useState<Partial<ChartStyle>>({});
  const [dpi, setDpi] = useState(300);
  const [templates, setTemplates] = useState<Template[]>(() => (typeof window === "undefined" ? [] : loadTemplates()));
  const ref = useRef<SVGSVGElement>(null);
  const { chart, error } = useMemo(() => { try { return { chart: buildChart(spec, dataset), error: null }; } catch (e) { return { chart: null, error: (e as Error).message }; } }, [spec, dataset]);
  const s = { ...DEFAULT_STYLE, ...style };
  const nums = dataset.variables.filter((v) => v.type === "numeric").map((v) => v.name);
  const all = dataset.variables.filter((v) => v.type !== "date").map((v) => v.name);
  const inp = "mt-1 w-full rounded-control border border-line-strong bg-surface px-2 py-1.5 text-sm";
  const pick = (k: keyof ChartSpec, opts: string[], label: string, optional = false) => (
    <label className="type-label">{label}<select value={(spec[k] as string) ?? ""} onChange={(e) => setSpec({ ...spec, [k]: e.target.value || undefined })} className={inp}><option value="">{optional ? "None" : "Choose…"}</option>{opts.map((o) => <option key={o}>{o}</option>)}</select></label>
  );
  const st = <K extends keyof ChartStyle>(k: K, v: ChartStyle[K] | undefined) => setStyle((x) => ({ ...x, [k]: v }));

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <fieldset className="space-y-3 rounded-control border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-ink">Chart</legend>
          <label className="type-label">Type<select value={spec.kind} onChange={(e) => setSpec({ kind: e.target.value as ChartSpec["kind"] })} className={inp}>{CHART_KINDS.map((c) => <option key={c.kind} value={c.kind}>{c.label}</option>)}</select></label>
          <p className="type-caption">Needs {CHART_KINDS.find((c) => c.kind === spec.kind)?.needs}.</p>
          {(spec.kind === "histogram" || spec.kind === "qq") && pick("x", nums, "Variable")}
          {spec.kind === "histogram" && <label className="type-label">Bins (blank = automatic)<input type="number" min={1} max={40} value={spec.bins ?? ""} onChange={(e) => setSpec({ ...spec, bins: e.target.value ? Number(e.target.value) : undefined })} className={inp} /></label>}
          {spec.kind === "bar" && <>{pick("x", all, "Categories")}{pick("group", all, "Group by", true)}<label className="type-label">Show<select value={spec.stat ?? "count"} onChange={(e) => setSpec({ ...spec, stat: e.target.value as ChartSpec["stat"] })} className={inp}><option value="count">Counts</option><option value="percent">Percent within group</option><option value="mean">Mean of a variable</option></select></label>{spec.stat === "mean" && pick("y", nums, "Variable to average")}</>}
          {(spec.kind === "box" || spec.kind === "means") && <>{pick("y", nums, "Variable")}{pick("group", all, "Group by", true)}</>}
          {spec.kind === "scatter" && <>{pick("x", nums, "X axis")}{pick("y", nums, "Y axis")}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!spec.fit} onChange={(e) => setSpec({ ...spec, fit: e.target.checked })} />Least-squares line</label></>}
          {spec.kind === "heatmap" && <><label className="type-label">Variables<select multiple value={spec.variables ?? []} onChange={(e) => setSpec({ ...spec, variables: [...e.target.selectedOptions].map((o) => o.value) })} className={`${inp} h-32`}>{nums.map((n) => <option key={n}>{n}</option>)}</select></label><label className="type-label">Coefficient<select value={spec.method ?? "pearson"} onChange={(e) => setSpec({ ...spec, method: e.target.value as "pearson" })} className={inp}><option value="pearson">Pearson</option><option value="spearman">Spearman</option></select></label></>}
        </fieldset>
        <fieldset className="grid grid-cols-2 gap-3 rounded-control border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-ink">Appearance</legend>
          <label className="type-label col-span-2">Title<input value={style.title ?? ""} placeholder={chart?.title} onChange={(e) => st("title", e.target.value || undefined)} className={inp} /></label>
          <label className="type-label">X label<input value={style.xLabel ?? ""} onChange={(e) => st("xLabel", e.target.value || undefined)} className={inp} /></label>
          <label className="type-label">Y label<input value={style.yLabel ?? ""} onChange={(e) => st("yLabel", e.target.value || undefined)} className={inp} /></label>
          <label className="type-label col-span-2">Colours<select value={s.palette} onChange={(e) => st("palette", e.target.value as Palette)} className={inp}>{Object.entries(PALETTES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></label>
          <label className="type-label">Width (px)<input type="number" min={300} max={2400} value={s.width} onChange={(e) => st("width", Math.max(300, Math.min(2400, Number(e.target.value) || 640)))} className={inp} /></label>
          <label className="type-label">Height (px)<input type="number" min={200} max={2400} value={s.height} onChange={(e) => st("height", Math.max(200, Math.min(2400, Number(e.target.value) || 420)))} className={inp} /></label>
          <label className="type-label">Font size<input type="number" min={8} max={28} value={s.fontSize} onChange={(e) => st("fontSize", Number(e.target.value) || 12)} className={inp} /></label>
          <label className="type-label">Font<select value={s.fontFamily} onChange={(e) => st("fontFamily", e.target.value)} className={inp}><option value="Arial, Helvetica, sans-serif">Arial</option><option value="'Times New Roman', Times, serif">Times New Roman</option><option value="Calibri, Carlito, sans-serif">Calibri</option></select></label>
          <label className="type-label">Line width<input type="number" step={0.5} min={0.5} max={6} value={s.lineWidth} onChange={(e) => st("lineWidth", Number(e.target.value) || 1.5)} className={inp} /></label>
          <label className="type-label">Marker size<input type="number" step={0.5} min={1} max={10} value={s.markerSize} onChange={(e) => st("markerSize", Number(e.target.value) || 3)} className={inp} /></label>
          <label className="type-label">Y minimum<input type="number" step="any" value={style.yMin ?? ""} onChange={(e) => st("yMin", e.target.value === "" ? null : Number(e.target.value))} className={inp} /></label>
          <label className="type-label">Y maximum<input type="number" step="any" value={style.yMax ?? ""} onChange={(e) => st("yMax", e.target.value === "" ? null : Number(e.target.value))} className={inp} /></label>
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={s.grid} onChange={(e) => st("grid", e.target.checked)} />Gridlines</label>
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={s.showLegend} onChange={(e) => st("showLegend", e.target.checked)} />Legend</label>
        </fieldset>
        <fieldset className="space-y-2 rounded-control border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-ink">Style templates</legend>
          <div className="flex flex-wrap gap-2">{templates.map((t) => <button key={t.name} type="button" onClick={() => setStyle((x) => ({ ...x, ...t.style, title: x.title, xLabel: x.xLabel, yLabel: x.yLabel }))} className="rounded border border-line px-2 py-0.5 text-xs hover:border-primary">{t.name}</button>)}</div>
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => { const name = prompt("Template name"); if (!name) return; const { title: _t, xLabel: _x, yLabel: _y, ...rest } = style; void _t; void _x; void _y; const next = [...templates.filter((t) => t.name !== name), { name: name.slice(0, 40), style: rest }]; setTemplates(next); try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } }}>Save current style as a template</button>
        </fieldset>
      </div>
      <div className="min-w-0 space-y-3">
        {error && <p role="alert" className="rounded-control border border-info-line bg-info-bg p-3 text-sm text-info-ink">{error}</p>}
        {chart && <div className="overflow-auto rounded-control border border-line bg-surface p-2"><Chart ref={ref} chart={chart} style={style} /></div>}
        {chart && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={async () => { if (ref.current && (await canExport("svg"))) download(`${s.title ?? chart.title}.svg`, svgString(ref.current, s.width, s.height), "image/svg+xml"); }}><Download className="h-4 w-4" aria-hidden="true" />SVG (vector)</Button>
            <Button variant="secondary" size="sm" onClick={async () => { if (ref.current && (await canExport("png"))) download(`${s.title ?? chart.title}.png`, await pngBlob(ref.current, s.width, s.height, dpi / 96)); }}><Download className="h-4 w-4" aria-hidden="true" />PNG</Button>
            <label className="text-sm text-ink-soft">at <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))} className="rounded border border-line-strong px-1 py-0.5"><option value={96}>96</option><option value={300}>300</option><option value={600}>600</option></select> dpi</label>
            {canSave && <Button variant="secondary" size="sm" onClick={() => onSave({ chart: spec, style }, s.title ?? chart.title)}><Save className="h-4 w-4" aria-hidden="true" />Save to project</Button>}
            <span className="type-caption">For PDF, print the SVG or place it in your document; vector quality is kept.</span>
          </div>
        )}
      </div>
    </div>
  );
}

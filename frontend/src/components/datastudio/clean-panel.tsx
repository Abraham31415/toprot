"use client";

import { useState } from "react";
import { AlertTriangle, Eye, Plus } from "lucide-react";
import { Button } from "@/components/ds";
import { FUNCTION_NAMES } from "@/lib/datastudio/expr";
import { apply, DESTRUCTIVE, OP_LABEL, parseRecodeRules, type Operation } from "@/lib/datastudio/transform";
import { nRows, type Dataset } from "@/lib/datastudio/types";

type OpKind = Operation["op"];
const GROUPS: { label: string; ops: OpKind[] }[] = [
  { label: "Create and transform", ops: ["compute", "recode", "bin", "standardize", "math", "flag_outliers"] },
  { label: "Clean values", ops: ["impute", "replace", "text_clean"] },
  { label: "Rows", ops: ["filter_rows", "drop_duplicates", "drop_missing", "sort", "insert_rows"] },
  { label: "Variables and structure", ops: ["insert_column", "delete_columns", "wide_to_long", "long_to_wide"] },
];

const inp = "mt-1 w-full rounded-control border border-line-strong bg-surface px-2 py-1.5 text-sm";
const num = (s: string) => (s.trim() === "" ? null : Number(s));

/** Build, preview and add data-management steps. Nothing changes until the steps are saved as a new version. */
export function CleanPanel({ dataset, onAdd, combine }: { dataset: Dataset; onAdd: (op: Operation) => void; combine?: React.ReactNode }) {
  const [kind, setKind] = useState<OpKind>("compute");
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [preview, setPreview] = useState<{ summary: string; rows: number; cols: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const names = dataset.variables.map((v) => v.name);
  const numeric = dataset.variables.filter((v) => v.type === "numeric").map((v) => v.name);
  const text = dataset.variables.filter((v) => v.type === "string").map((v) => v.name);
  const g = (k: string) => (f[k] as string) ?? "";
  const setv = (k: string, v: string | boolean) => { setF((s) => ({ ...s, [k]: v })); setPreview(null); setError(null); };
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const val = (s: string) => (s.trim() === "" ? null : Number.isFinite(Number(s)) ? Number(s) : s);

  function build(): Operation {
    switch (kind) {
      case "compute": return { op: "compute", name: g("name"), expr: g("expr"), label: g("label") || undefined, overwrite: !!f.overwrite };
      case "recode": return { op: "recode", source: g("source"), target: g("target") || g("source"), rules: parseRecodeRules(g("rules")), otherwise: g("otherwise") === "missing" ? "missing" : "copy" };
      case "bin": return { op: "bin", name: g("name"), target: g("target") || `${g("name")}_grp`, breaks: list(g("breaks")).map(Number), labels: g("labels") ? list(g("labels")) : undefined, rightClosed: !!f.rightClosed };
      case "standardize": return { op: "standardize", name: g("name"), target: g("target") || `${g("name")}_${g("method") || "z"}`, method: (g("method") || "z") as "z" | "minmax" | "center" };
      case "math": return { op: "math", name: g("name"), target: g("target") || `${g("fn") || "ln"}_${g("name")}`, fn: (g("fn") || "ln") as "ln" };
      case "flag_outliers": return { op: "flag_outliers", name: g("name"), target: g("target") || `${g("name")}_outlier`, method: (g("method") || "iqr") as "iqr" | "z", k: Number(g("k") || (g("method") === "z" ? 3 : 1.5)) };
      case "impute": return { op: "impute", name: g("name"), method: (g("method") || "median") as "median", value: g("method") === "constant" ? val(g("value")) : undefined, flag: f.flag !== false };
      case "replace": return { op: "replace", name: g("name"), find: val(g("find")), replace: val(g("replace")) };
      case "text_clean": return { op: "text_clean", name: g("name"), trim: f.trim !== false, case: (g("case") || "none") as "none" };
      case "filter_rows": return { op: "filter_rows", expr: g("expr") };
      case "drop_duplicates": return { op: "drop_duplicates", by: g("by") ? list(g("by")) : undefined };
      case "drop_missing": return { op: "drop_missing", names: list(g("names")), how: (g("how") || "any") as "any" };
      case "sort": return { op: "sort", by: list(g("by")).map((x) => ({ name: x.replace(/\s+desc$/i, ""), desc: /\s+desc$/i.test(x) })) };
      case "insert_rows": return { op: "insert_rows", at: Math.max(0, (num(g("at")) ?? nRows(dataset) + 1) - 1), count: Number(g("count") || 1) };
      case "insert_column": return { op: "insert_column", name: g("name"), type: (g("type") || "numeric") as "numeric", after: g("after") || null };
      case "delete_columns": return { op: "delete_columns", names: list(g("names")) };
      case "wide_to_long": return { op: "wide_to_long", id: g("id"), stubs: list(g("stubs")), timeName: g("timeName") || "time", sep: g("sep") || "_" };
      case "long_to_wide": return { op: "long_to_wide", id: g("id"), time: g("time"), values: list(g("values")), sep: g("sep") || "_" };
      default: throw new Error("Use the data grid or variable view for this step.");
    }
  }
  function doPreview() {
    setError(null);
    try { const op = build(); const r = apply(dataset, op); setPreview({ summary: r.summary, rows: nRows(r.dataset), cols: r.dataset.variables.length }); }
    catch (e) { setPreview(null); setError((e as Error).message.replace(/^\[.*?\]\s*/, "")); }
  }
  function add() {
    try { const op = build(); apply(dataset, op); onAdd(op); setPreview(null); setConfirmed(false); setF({}); }
    catch (e) { setError((e as Error).message); }
  }
  const destructive = DESTRUCTIVE.has(kind);
  const pickVar = (k: string, opts: string[], label: string) => <label className="type-label">{label}<select value={g(k)} onChange={(e) => setv(k, e.target.value)} className={inp}><option value="">Choose…</option>{opts.map((o) => <option key={o}>{o}</option>)}</select></label>;
  const txt = (k: string, label: string, ph = "") => <label className="type-label">{label}<input value={g(k)} placeholder={ph} onChange={(e) => setv(k, e.target.value)} className={inp} /></label>;
  const sel = (k: string, label: string, opts: [string, string][]) => <label className="type-label">{label}<select value={g(k) || opts[0][0]} onChange={(e) => setv(k, e.target.value)} className={inp}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  const chk = (k: string, label: string, def = false) => <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f[k] === undefined ? def : !!f[k]} onChange={(e) => setv(k, e.target.checked)} />{label}</label>;

  const forms: Partial<Record<OpKind, React.ReactNode>> = {
    compute: <>{txt("name", "New variable name", "bmi")}{txt("label", "Label (optional)")}<label className="type-label sm:col-span-2">Expression<input value={g("expr")} onChange={(e) => setv("expr", e.target.value)} placeholder="weight / (height / 100) ^ 2" className={`${inp} font-mono`} /></label><p className="type-caption sm:col-span-2">Operators + - * / ^ %, comparisons, and/or/not, and functions: {FUNCTION_NAMES.join(", ")}. Missing values stay missing.</p>{chk("overwrite", "Overwrite if it exists")}</>,
    recode: <>{pickVar("source", names, "Variable")}{txt("target", "Into variable (blank = same)")}<label className="type-label sm:col-span-2">Rules, one per line<textarea rows={4} value={g("rules")} onChange={(e) => setv("rules", e.target.value)} placeholder={"1 = 0\n2 = 1\n18 to 39 = 1\n40 to = 2\nmissing = 9"} className={`${inp} font-mono`} /></label>{sel("otherwise", "Other values", [["copy", "Keep as they are"], ["missing", "Set to missing"]])}</>,
    bin: <>{pickVar("name", numeric, "Variable")}{txt("target", "New variable")}{txt("breaks", "Cut points", "18, 40, 65")}{txt("labels", "Labels (optional, one more than cut points)", "<18, 18-39, 40-64, 65+")}{chk("rightClosed", "Upper bound included (≤)")}</>,
    standardize: <>{pickVar("name", numeric, "Variable")}{txt("target", "New variable")}{sel("method", "Method", [["z", "z-score (mean 0, SD 1)"], ["minmax", "Rescale to 0-1"], ["center", "Centre at the mean"]])}</>,
    math: <>{pickVar("name", numeric, "Variable")}{txt("target", "New variable")}{sel("fn", "Function", [["ln", "Natural log"], ["log10", "Log base 10"], ["log2", "Log base 2"], ["log1p", "log(1 + x)"], ["sqrt", "Square root"], ["square", "Square"], ["inverse", "1 / x"], ["abs", "Absolute value"]])}</>,
    flag_outliers: <>{pickVar("name", numeric, "Variable")}{txt("target", "Flag variable")}{sel("method", "Rule", [["iqr", "Outside Q1 - k·IQR to Q3 + k·IQR"], ["z", "More than k SD from the mean"]])}{txt("k", "k", "1.5 (IQR) or 3 (SD)")}<p className="type-caption sm:col-span-2">Creates a 0/1 flag. No value is changed or removed.</p></>,
    impute: <>{pickVar("name", names, "Variable")}{sel("method", "Fill with", [["median", "Median"], ["mean", "Mean"], ["mode", "Most common value"], ["constant", "A value"]])}{g("method") === "constant" && txt("value", "Value")}{chk("flag", "Add an indicator of which values were imputed", true)}<p className="type-caption sm:col-span-2">Single imputation understates uncertainty. Multiple imputation is planned.</p></>,
    replace: <>{pickVar("name", names, "Variable")}{txt("find", "Find (blank = missing)")}{txt("replace", "Replace with (blank = missing)")}</>,
    text_clean: <>{pickVar("name", text, "Text variable")}{sel("case", "Case", [["none", "Unchanged"], ["lower", "lower case"], ["upper", "UPPER CASE"], ["title", "Title Case"]])}{chk("trim", "Trim and collapse spaces", true)}</>,
    filter_rows: <><label className="type-label sm:col-span-2">Keep rows where<input value={g("expr")} onChange={(e) => setv("expr", e.target.value)} placeholder='age >= 18 and consent == "yes"' className={`${inp} font-mono`} /></label><p className="type-caption sm:col-span-2">Rows where the condition is false or missing are removed from the new version (the original version is kept).</p></>,
    drop_duplicates: <>{txt("by", "Match on (blank = all variables)", "id")}</>,
    drop_missing: <>{txt("names", "Variables", "age, sex")}{sel("how", "Remove a row if", [["any", "Any of them is missing"], ["all", "All of them are missing"]])}</>,
    sort: <>{txt("by", "Sort by (add 'desc' for descending)", "site, age desc")}</>,
    insert_rows: <>{txt("count", "Number of rows", "1")}{txt("at", "Before row number (blank = end)")}</>,
    insert_column: <>{txt("name", "Name")}{sel("type", "Type", [["numeric", "Numeric"], ["string", "Text"], ["date", "Date"]])}{pickVar("after", names, "After variable (optional)")}</>,
    delete_columns: <>{txt("names", "Variables to delete", "notes, temp1")}</>,
    wide_to_long: <>{pickVar("id", names, "ID variable")}{txt("stubs", "Stubs", "weight, sbp (for weight_1, weight_2, …)")}{txt("sep", "Separator", "_")}{txt("timeName", "Time variable name", "visit")}</>,
    long_to_wide: <>{pickVar("id", names, "ID variable")}{pickVar("time", names, "Time variable")}{txt("values", "Variables to spread", "weight, sbp")}{txt("sep", "Separator", "_")}</>,
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      <nav aria-label="Data operations" className="space-y-3">
        {GROUPS.map((gr) => (
          <div key={gr.label}><p className="type-eyebrow px-1">{gr.label}</p>
            <ul className="mt-1 space-y-0.5">{gr.ops.map((o) => <li key={o}><button type="button" aria-current={kind === o ? "true" : undefined} onClick={() => { setKind(o); setF({}); setPreview(null); setError(null); setConfirmed(false); }} className={`w-full rounded-control px-2 py-1.5 text-left text-sm ${kind === o ? "bg-surface-soft text-primary-hover" : "text-ink-soft hover:bg-hover"}`}>{OP_LABEL[o]}</button></li>)}</ul>
          </div>
        ))}
        {combine}
      </nav>
      <section aria-labelledby="op-h" className="space-y-4">
        <h3 id="op-h" className="type-card">{OP_LABEL[kind]}</h3>
        <div className="grid gap-3 sm:grid-cols-2">{forms[kind]}</div>
        {error && <p role="alert" className="rounded-control border border-danger-line bg-danger-bg p-2 text-sm text-danger-ink">{error}</p>}
        {preview && (
          <div role="status" className="rounded-control border border-info-line bg-info-bg p-3 text-sm text-info-ink">
            <p className="font-medium">Preview</p><p>{preview.summary}</p>
            <p className="mt-1 text-xs">Result: {preview.rows.toLocaleString("en-GB")} rows × {preview.cols} variables (now {nRows(dataset).toLocaleString("en-GB")} × {dataset.variables.length}).</p>
          </div>
        )}
        {destructive && preview && (
          <label className="flex items-start gap-2 rounded-control border border-warning-line bg-warning-bg p-2 text-sm text-warning-ink"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" /><span><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden="true" />This step removes or overwrites data in the new version. The current version stays in the history and can be restored.</span></label>
        )}
        <div className="flex gap-3">
          <Button variant="secondary" size="sm" onClick={doPreview}><Eye className="h-4 w-4" aria-hidden="true" />Preview</Button>
          <Button size="sm" onClick={add} disabled={!preview || (destructive && !confirmed)}><Plus className="h-4 w-4" aria-hidden="true" />Add step</Button>
        </div>
      </section>
    </div>
  );
}

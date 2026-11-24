// Shared pieces of the analysis engine: the structured result format, data extraction with explicit missing-data handling,
// grouping, and multiple-comparison adjustment.

import { DataError, colIndex, isMissing, nRows, type Cell, type Dataset, type Variable, type Warning } from "../types";

/** A numeric cell is stored as a number; everything in a table is either text, a number, or null (shown as a dash). */
export type TableCell = string | number | null;
export type ResultTable = {
  title: string;
  columns: string[];
  rows: TableCell[][];
  /** Column kinds drive formatting: p-values are shown as "<0.001", counts as integers, estimates to the chosen precision. */
  kinds?: ("text" | "int" | "num" | "p" | "pct")[];
  notes?: string[];
};
export type Assumption = { name: string; detail: string; status: "met" | "violated" | "check" | "info" };
export type ChartData =
  | { kind: "histogram"; title: string; variable: string; bins: { lo: number; hi: number; count: number }[]; normal?: { mean: number; sd: number; n: number } }
  | { kind: "box"; title: string; groups: { label: string; min: number; q1: number; median: number; q3: number; max: number; whiskerLo: number; whiskerHi: number; outliers: number[]; n: number; mean: number }[]; yLabel: string }
  | { kind: "scatter"; title: string; xLabel: string; yLabel: string; points: [number, number][]; line?: { intercept: number; slope: number }; refY?: number }
  | { kind: "qq"; title: string; points: [number, number][] }
  | { kind: "bar"; title: string; categories: string[]; series: { name: string; values: number[] }[]; yLabel: string }
  | { kind: "means"; title: string; groups: { label: string; mean: number; lo: number; hi: number; n: number }[]; yLabel: string }
  | { kind: "step"; title: string; xLabel: string; yLabel: string; series: { name: string; points: [number, number][]; lower?: [number, number][]; upper?: [number, number][]; censored?: [number, number][] }[] }
  | { kind: "roc"; title: string; points: [number, number][]; auc: number }
  | { kind: "forest"; title: string; rows: { label: string; est: number; lo: number; hi: number }[]; ref: number; log: boolean; xLabel: string }
  | { kind: "heatmap"; title: string; labels: string[]; values: (number | null)[][] }
  | { kind: "bland_altman"; title: string; points: [number, number][]; bias: number; loaLo: number; loaHi: number };

export type AnalysisResult = {
  method: string;
  title: string;
  /** Plain-language statement of what was computed and how, for the methods section. */
  methodsText: string;
  n: { used: number; excluded: number; total: number };
  tables: ResultTable[];
  assumptions: Assumption[];
  warnings: Warning[];
  charts: ChartData[];
  /** Key numbers for the AI analyst and for reporting, keyed by a stable name. */
  keyResults: Record<string, number | string | null>;
};

/** A fatal analysis failure: no partial result is shown. */
export class AnalysisError extends DataError {
  constructor(message: string) { super(message); this.name = "AnalysisError"; }
}

export type Vars = { names: string[]; idx: number[]; vars: Variable[] };
export function vars(d: Dataset, names: string[]): Vars {
  const idx = names.map((n) => colIndex(d, n));
  return { names, idx, vars: idx.map((j) => d.variables[j]) };
}

/** Rows where every listed variable is present (listwise deletion). */
export function completeRows(d: Dataset, names: string[], extraFilter?: (i: number) => boolean): number[] {
  const v = vars(d, names);
  const out: number[] = [];
  for (let i = 0; i < nRows(d); i++) {
    if (extraFilter && !extraFilter(i)) continue;
    if (v.idx.every((j, k) => !isMissing(v.vars[k], d.columns[j][i]))) out.push(i);
  }
  return out;
}

export function requireNumeric(d: Dataset, name: string, why = "This analysis"): number {
  const j = colIndex(d, name);
  if (d.variables[j].type !== "numeric") throw new AnalysisError(`${why} needs a numeric variable; "${name}" is ${d.variables[j].type}. Change its type or choose another variable.`);
  return j;
}

export const num = (d: Dataset, j: number, rows: number[]) => rows.map((i) => d.columns[j][i] as number);

/** Display label of a category value: its value label if one exists. */
export function levelLabel(v: Variable, value: string): string {
  const l = v.valueLabels?.[value];
  return l ? `${l}` : value;
}

/** Distinct present values of a grouping variable, in a stable order: numeric codes ascending, text alphabetically. */
export function levels(d: Dataset, j: number, rows: number[]): string[] {
  const set = new Set<string>();
  const nums: number[] = [];
  let allNum = true;
  for (const i of rows) {
    const c = d.columns[j][i] as Cell;
    if (c === null) continue;
    const k = String(c);
    if (!set.has(k)) { set.add(k); if (typeof c === "number") nums.push(c); else allNum = false; }
  }
  return allNum ? nums.sort((a, b) => a - b).map(String) : [...set].sort((a, b) => a.localeCompare(b));
}

export function groupRows(d: Dataset, gj: number, rows: number[], only?: string[]): { level: string; rows: number[] }[] {
  const lv = only?.length ? only : levels(d, gj, rows);
  const map = new Map(lv.map((l) => [l, [] as number[]]));
  for (const i of rows) { const g = map.get(String(d.columns[gj][i])); if (g) g.push(i); }
  return lv.map((l) => ({ level: l, rows: map.get(l)! }));
}

export type Adjust = "none" | "bonferroni" | "holm" | "fdr_bh";
/** Adjusted p-values (same definitions as statsmodels multipletests). */
export function adjustP(p: number[], method: Adjust): number[] {
  const m = p.length;
  if (method === "none" || m <= 1) return p.slice();
  if (method === "bonferroni") return p.map((x) => Math.min(1, x * m));
  const order = p.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(m);
  if (method === "holm") {
    let run = 0;
    order.forEach(([x, i], k) => { run = Math.max(run, Math.min(1, (m - k) * x)); out[i] = run; });
    return out;
  }
  let run = 1;
  for (let k = m - 1; k >= 0; k--) { const [x, i] = order[k]; run = Math.min(run, (x * m) / (k + 1)); out[i] = Math.min(1, run); }
  return out;
}

export const ADJUST_LABEL: Record<Adjust, string> = { none: "no adjustment", bonferroni: "Bonferroni", holm: "Holm", fdr_bh: "Benjamini-Hochberg false discovery rate" };

export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return "-";
  if (p < 0.001) return "<0.001";
  return p.toFixed(3);
}
export function fmt(x: number, d = 2): string {
  if (x === null || !Number.isFinite(x)) return "-";
  if (Math.abs(x) >= 1e6 || (Math.abs(x) < 1e-4 && x !== 0)) return x.toExponential(Math.max(1, d));
  return x.toFixed(d);
}

export function assertMinN(n: number, min: number, what: string): void {
  if (n < min) throw new AnalysisError(`${what} needs at least ${min} complete observations; only ${n} are available after removing missing values.`);
}

export function excludedNote(total: number, used: number, names: string[]): Warning[] {
  const ex = total - used;
  return ex > 0 ? [{ level: "note", text: `${ex} of ${total} rows were excluded because of missing values in ${names.join(", ")} (complete-case analysis).` }] : [];
}

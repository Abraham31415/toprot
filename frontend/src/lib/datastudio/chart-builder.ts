// Builds chart data directly from a dataset for the Visualization Studio. Deterministic; uses the same statistics as the engine.

import { pearson, spearman, linearRegression } from "@/lib/stats/tests";
import { DataError, colIndex, isMissing, nRows, type Dataset } from "./types";
import type { ChartData } from "./engine/common";
import { groupRows, levelLabel, levels, completeRows } from "./engine/common";
import { summarize } from "./engine/describe";
import { histogram } from "./profile";
import { qqPoints } from "./engine/normality";

export type ChartKind = "histogram" | "bar" | "box" | "scatter" | "means" | "qq" | "heatmap";
export type ChartSpec = { kind: ChartKind; x?: string; y?: string; group?: string; bins?: number; fit?: boolean; stat?: "count" | "percent" | "mean"; variables?: string[]; method?: "pearson" | "spearman" };

export const CHART_KINDS: { kind: ChartKind; label: string; needs: string }[] = [
  { kind: "histogram", label: "Histogram", needs: "one numeric variable" },
  { kind: "bar", label: "Bar chart (grouped)", needs: "a categorical variable, optionally a grouping variable" },
  { kind: "box", label: "Box plot", needs: "a numeric variable, optionally by group" },
  { kind: "means", label: "Means with 95% CI (error bars)", needs: "a numeric variable by group" },
  { kind: "scatter", label: "Scatter plot", needs: "two numeric variables" },
  { kind: "qq", label: "Normal Q-Q plot", needs: "one numeric variable" },
  { kind: "heatmap", label: "Correlation heatmap", needs: "two or more numeric variables" },
];

const need = (v: string | undefined, what: string) => { if (!v) throw new DataError(`Choose ${what}.`); return v; };
const numericCol = (d: Dataset, name: string) => { const j = colIndex(d, name); if (d.variables[j].type !== "numeric") throw new DataError(`"${name}" must be numeric for this chart.`); return j; };

export function buildChart(spec: ChartSpec, d: Dataset): ChartData {
  switch (spec.kind) {
    case "histogram": {
      const x = need(spec.x, "a variable"); const j = numericCol(d, x);
      const vals = d.columns[j].filter((c) => !isMissing(d.variables[j], c)) as number[];
      if (!vals.length) throw new DataError(`${x} has no values.`);
      const s = summarize(vals);
      return { kind: "histogram", title: `Distribution of ${x}`, variable: x, bins: histogram(vals, spec.bins), normal: { mean: s.mean, sd: s.sd, n: vals.length } };
    }
    case "qq": {
      const x = need(spec.x, "a variable"); const j = numericCol(d, x);
      const vals = d.columns[j].filter((c) => !isMissing(d.variables[j], c)) as number[];
      if (vals.length < 3) throw new DataError("A Q-Q plot needs at least 3 values.");
      return { kind: "qq", title: `Normal Q-Q plot of ${x}`, points: qqPoints(vals) };
    }
    case "bar": {
      const x = need(spec.x, "a category variable"); const xj = colIndex(d, x);
      const rows = completeRows(d, spec.group ? [x, spec.group] : [x]);
      const cats = levels(d, xj, rows);
      if (cats.length > 60) throw new DataError(`${x} has too many categories for a bar chart.`);
      if (spec.stat === "mean") {
        const y = need(spec.y, "a numeric variable for the mean"); const yj = numericCol(d, y);
        const r2 = completeRows(d, spec.group ? [x, y, spec.group] : [x, y]);
        const groups = spec.group ? groupRows(d, colIndex(d, spec.group), r2) : [{ level: y, rows: r2 }];
        return { kind: "bar", title: `Mean ${y} by ${x}`, categories: cats.map((c) => levelLabel(d.variables[xj], c)), yLabel: `Mean ${y}`, series: groups.map((g) => ({ name: spec.group ? levelLabel(d.variables[colIndex(d, spec.group)], g.level) : y, values: cats.map((c) => { const v = g.rows.filter((i) => String(d.columns[xj][i]) === c).map((i) => d.columns[yj][i] as number); return v.length ? summarize(v).mean : 0; }) })) };
      }
      const groups = spec.group ? groupRows(d, colIndex(d, spec.group), rows) : [{ level: "Count", rows }];
      const pct = spec.stat === "percent";
      return { kind: "bar", title: `${x}${spec.group ? ` by ${spec.group}` : ""}`, categories: cats.map((c) => levelLabel(d.variables[xj], c)), yLabel: pct ? "Percent within group" : "Count", series: groups.map((g) => ({ name: spec.group ? levelLabel(d.variables[colIndex(d, spec.group!)], g.level) : "Count", values: cats.map((c) => { const k = g.rows.filter((i) => String(d.columns[xj][i]) === c).length; return pct ? (100 * k) / (g.rows.length || 1) : k; }) })) };
    }
    case "box": case "means": {
      const y = need(spec.y, "a numeric variable"); const yj = numericCol(d, y);
      const rows = completeRows(d, spec.group ? [y, spec.group] : [y]);
      const groups = spec.group ? groupRows(d, colIndex(d, spec.group), rows) : [{ level: y, rows }];
      const lab = (g: { level: string }) => (spec.group ? levelLabel(d.variables[colIndex(d, spec.group)], g.level) : y);
      const usable = groups.filter((g) => g.rows.length > 0);
      if (!usable.length) throw new DataError("No data to plot.");
      if (spec.kind === "means") return { kind: "means", title: `Mean ${y}${spec.group ? ` by ${spec.group}` : ""} (95% CI)`, yLabel: y, groups: usable.map((g) => { const s = summarize(g.rows.map((i) => d.columns[yj][i] as number)); return { label: lab(g), mean: s.mean, lo: Number.isFinite(s.ciLower) ? s.ciLower : s.mean, hi: Number.isFinite(s.ciUpper) ? s.ciUpper : s.mean, n: s.n }; }) };
      return { kind: "box", title: `${y}${spec.group ? ` by ${spec.group}` : ""}`, yLabel: y, groups: usable.map((g) => {
        const x = g.rows.map((i) => d.columns[yj][i] as number); const s = summarize(x);
        const lo = s.q1 - 1.5 * s.iqr, hi = s.q3 + 1.5 * s.iqr; const inside = x.filter((v) => v >= lo && v <= hi);
        return { label: lab(g), min: s.min, q1: s.q1, median: s.median, q3: s.q3, max: s.max, whiskerLo: Math.min(...inside), whiskerHi: Math.max(...inside), outliers: x.filter((v) => v < lo || v > hi).slice(0, 300), n: s.n, mean: s.mean };
      }) };
    }
    case "scatter": {
      const x = need(spec.x, "an X variable"), y = need(spec.y, "a Y variable");
      const xj = numericCol(d, x), yj = numericCol(d, y);
      const rows = completeRows(d, [x, y]);
      const pts = rows.map((i) => [d.columns[xj][i] as number, d.columns[yj][i] as number] as [number, number]);
      let line;
      if (spec.fit && pts.length > 2) { const r = linearRegression(pts.map((p) => p[0]), pts.map((p) => p[1])); if (Number.isFinite(r.slope)) line = { intercept: r.intercept, slope: r.slope }; }
      return { kind: "scatter", title: `${y} against ${x}`, xLabel: x, yLabel: y, points: pts.slice(0, 20000), line };
    }
    case "heatmap": {
      const vars = (spec.variables ?? []).filter((v) => d.variables.some((x) => x.name === v && x.type === "numeric"));
      if (vars.length < 2) throw new DataError("Choose at least two numeric variables.");
      const values = vars.map((a) => vars.map((b) => {
        if (a === b) return 1;
        const rows = completeRows(d, [a, b]);
        if (rows.length < 3) return null;
        const xa = rows.map((i) => d.columns[colIndex(d, a)][i] as number), xb = rows.map((i) => d.columns[colIndex(d, b)][i] as number);
        const r = spec.method === "spearman" ? spearman(xa, xb).rho : pearson(xa, xb).r;
        return Number.isFinite(r) ? r : null;
      }));
      return { kind: "heatmap", title: `${spec.method === "spearman" ? "Spearman" : "Pearson"} correlations`, labels: vars, values };
    }
  }
}

export const rowCount = nRows;

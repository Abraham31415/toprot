// Automated data-quality profile of a dataset version. Pure and deterministic: it flags, it never changes data.

import { pearson } from "@/lib/stats/tests";
import { summarize, type Summary } from "./engine/describe";
import { isMissing, nRows, type Dataset, type Variable, type Warning } from "./types";

export type VariableProfile = {
  name: string; label?: string; type: Variable["type"]; measure: Variable["measure"];
  n: number; missing: number; missingPct: number; distinct: number;
  numeric?: Summary & { outliersIqr: number; outliersZ: number; outOfRange: number; histogram: { lo: number; hi: number; count: number }[] };
  categories?: { value: string; label?: string; count: number; pct: number }[];
  dates?: { min: string; max: string; future: number };
  issues: Warning[];
};

export type DatasetProfile = {
  rows: number; columns: number; completeRows: number; duplicateRows: number; missingCells: number; totalCells: number;
  variables: VariableProfile[];
  strongCorrelations: { a: string; b: string; r: number; n: number }[];
  issues: Warning[];
};

/** Histogram with Freedman-Diaconis bin width (falls back to Sturges), capped at 40 bins. */
export function histogram(x: number[], bins?: number): { lo: number; hi: number; count: number }[] {
  if (!x.length) return [];
  const s = [...x].sort((a, b) => a - b);
  const min = s[0], max = s[s.length - 1];
  if (min === max) return [{ lo: min, hi: max, count: x.length }];
  let k = bins;
  if (!k) {
    const q = (p: number) => { const pos = (s.length - 1) * p, lo = Math.floor(pos); return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo); };
    const iqr = q(0.75) - q(0.25);
    const h = 2 * iqr / Math.cbrt(x.length);
    k = h > 0 ? Math.ceil((max - min) / h) : Math.ceil(Math.log2(x.length) + 1);
  }
  k = Math.max(1, Math.min(40, k));
  const width = (max - min) / k;
  const out = Array.from({ length: k }, (_, i) => ({ lo: min + i * width, hi: i === k - 1 ? max : min + (i + 1) * width, count: 0 }));
  for (const v of x) out[Math.min(k - 1, Math.floor((v - min) / width))].count++;
  return out;
}

export function profileDataset(d: Dataset, today = new Date().toISOString().slice(0, 10)): DatasetProfile {
  const rows = nRows(d);
  const issues: Warning[] = [];
  const miss = d.variables.map((v, j) => d.columns[j].map((c) => isMissing(v, c)));
  let missingCells = 0, completeRows = 0;
  for (let i = 0; i < rows; i++) {
    let complete = true;
    for (let j = 0; j < d.variables.length; j++) if (miss[j][i]) { missingCells++; complete = false; }
    if (complete) completeRows++;
  }
  const seen = new Set<string>();
  let duplicateRows = 0;
  for (let i = 0; i < rows; i++) {
    const k = JSON.stringify(d.columns.map((c) => c[i]));
    if (seen.has(k)) duplicateRows++; else seen.add(k);
  }

  const variables: VariableProfile[] = d.variables.map((v, j) => {
    const col = d.columns[j];
    const present = col.filter((_, i) => !miss[j][i]);
    const vi: Warning[] = [];
    const p: VariableProfile = {
      name: v.name, label: v.label, type: v.type, measure: v.measure, n: present.length, missing: rows - present.length,
      missingPct: rows ? (100 * (rows - present.length)) / rows : 0, distinct: new Set(present.map(String)).size, issues: vi,
    };
    if (present.length === 0) vi.push({ level: "warning", text: "All values are missing." });
    else if (p.distinct === 1) vi.push({ level: "note", text: "Every value is the same (a constant). It cannot be used as a predictor or outcome." });
    if (p.missingPct >= 20 && present.length) vi.push({ level: "warning", text: `${p.missingPct.toFixed(1)}% of values are missing.` });

    if (v.type === "numeric" && v.measure === "scale") {
      const x = present as number[];
      const s = summarize(x);
      const lo = s.q1 - 1.5 * s.iqr, hi = s.q3 + 1.5 * s.iqr;
      const outliersIqr = x.filter((t) => t < lo || t > hi).length;
      const outliersZ = s.sd > 0 ? x.filter((t) => Math.abs((t - s.mean) / s.sd) > 3).length : 0;
      const outOfRange = x.filter((t) => (v.validMin !== undefined && t < v.validMin) || (v.validMax !== undefined && t > v.validMax)).length;
      p.numeric = { ...s, outliersIqr, outliersZ, outOfRange, histogram: histogram(x) };
      if (outOfRange) vi.push({ level: "warning", text: `${outOfRange} value(s) are outside the valid range ${v.validMin ?? "-inf"} to ${v.validMax ?? "inf"}.` });
      if (outliersZ) vi.push({ level: "note", text: `${outliersZ} value(s) are more than 3 SD from the mean. Check them; they are not removed.` });
      if (Math.abs(s.skewness) > 2) vi.push({ level: "note", text: `Strongly skewed (skewness ${s.skewness.toFixed(2)}). Medians, nonparametric tests or a transformation may suit it better.` });
    } else if (v.type !== "date") {
      const counts = new Map<string, number>();
      for (const c of present) counts.set(String(c), (counts.get(String(c)) ?? 0) + 1);
      const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      p.categories = cats.slice(0, 50).map(([value, count]) => ({ value, label: v.valueLabels?.[value], count, pct: (100 * count) / present.length }));
      if (v.type === "string") {
        const folded = new Map<string, Set<string>>();
        for (const [val] of cats) { const k = val.trim().toLowerCase().replace(/\s+/g, " "); if (!folded.has(k)) folded.set(k, new Set()); folded.get(k)!.add(val); }
        const variants = [...folded.values()].filter((s) => s.size > 1);
        if (variants.length) vi.push({ level: "warning", text: `Inconsistent spelling or case: ${variants.slice(0, 3).map((s) => [...s].map((x) => `"${x}"`).join(" / ")).join("; ")}. Use Recode or Text clean-up to merge them.` });
        if (cats.length > 0 && cats.length === present.length && present.length > 20 && v.role !== "id") vi.push({ level: "note", text: "Every value is different; this looks like free text or an identifier rather than a category." });
      }
      if (v.valueLabels) {
        const unlabeled = cats.filter(([val]) => !(val in v.valueLabels!)).map(([val]) => val);
        if (unlabeled.length) vi.push({ level: "note", text: `Values without a label: ${unlabeled.slice(0, 5).join(", ")}${unlabeled.length > 5 ? "…" : ""}.` });
      }
      const rare = cats.filter(([, c]) => c < 5).length;
      if (cats.length > 1 && rare && v.measure !== "scale") vi.push({ level: "note", text: `${rare} categor${rare === 1 ? "y has" : "ies have"} fewer than 5 observations; sparse categories can make tests and models unstable.` });
    } else {
      const ds = (present as string[]).slice().sort();
      if (ds.length) {
        const future = ds.filter((x) => x.slice(0, 10) > today).length;
        p.dates = { min: ds[0], max: ds[ds.length - 1], future };
        if (future) vi.push({ level: "warning", text: `${future} date(s) are in the future.` });
        if (ds[0] < "1900-01-01") vi.push({ level: "warning", text: `The earliest date (${ds[0]}) is before 1900; check for entry errors.` });
      }
    }
    if (v.role === "id") {
      const vals = present.map(String);
      const dups = vals.length - new Set(vals).size;
      if (dups) vi.push({ level: "warning", text: `${dups} duplicate identifier value(s).` });
    }
    return p;
  });

  // Very strong correlations between numeric scale variables (possible duplicates or derived variables).
  const strongCorrelations: DatasetProfile["strongCorrelations"] = [];
  const numIdx = d.variables.map((v, j) => (v.type === "numeric" && v.measure === "scale" ? j : -1)).filter((j) => j >= 0).slice(0, 60);
  for (let a = 0; a < numIdx.length; a++)
    for (let b = a + 1; b < numIdx.length; b++) {
      const ja = numIdx[a], jb = numIdx[b];
      const xs: number[] = [], ys: number[] = [];
      for (let i = 0; i < rows; i++) if (!miss[ja][i] && !miss[jb][i]) { xs.push(d.columns[ja][i] as number); ys.push(d.columns[jb][i] as number); }
      if (xs.length < 10) continue;
      const r = pearson(xs, ys).r;
      if (Number.isFinite(r) && Math.abs(r) >= 0.9) strongCorrelations.push({ a: d.variables[ja].name, b: d.variables[jb].name, r, n: xs.length });
    }
  strongCorrelations.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  if (duplicateRows) issues.push({ level: "warning", text: `${duplicateRows} row(s) are exact duplicates of another row.` });
  if (rows && completeRows / rows < 0.5) issues.push({ level: "warning", text: `Only ${completeRows} of ${rows} rows (${((100 * completeRows) / rows).toFixed(0)}%) have no missing values. A complete-case analysis would lose much of the data.` });
  if (strongCorrelations.length) issues.push({ level: "note", text: `${strongCorrelations.length} pair(s) of variables are almost perfectly correlated (|r| ≥ 0.9). Using both in one model causes multicollinearity.` });
  return { rows, columns: d.variables.length, completeRows, duplicateRows, missingCells, totalCells: rows * d.variables.length, variables, strongCorrelations: strongCorrelations.slice(0, 30), issues };
}

// Reliability and agreement for continuous measurements: Cronbach's alpha, intraclass correlation (Shrout & Fleiss / McGraw & Wong),
// and Bland-Altman limits of agreement. Rows are subjects, columns are items or raters, with no missing values.

import { fCdf, fPpf, tPpf } from "@/lib/stats/dist";
import { pearson } from "@/lib/stats/tests";
import { AnalysisError } from "./common";

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const variance = (x: number[]) => { const m = mean(x); return x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1); };

export function cronbachAlpha(rows: number[][], conf = 0.95) {
  const n = rows.length, k = rows[0]?.length ?? 0;
  if (k < 2) throw new AnalysisError("Cronbach's alpha needs at least two items.");
  if (n < 3) throw new AnalysisError("Cronbach's alpha needs at least three respondents with complete answers.");
  const cols = Array.from({ length: k }, (_, j) => rows.map((r) => r[j]));
  const totals = rows.map((r) => r.reduce((s, v) => s + v, 0));
  const vt = variance(totals);
  if (vt === 0) throw new AnalysisError("Total scores do not vary, so alpha is undefined.");
  const alpha = (k / (k - 1)) * (1 - cols.reduce((s, c) => s + variance(c), 0) / vt);
  const g = 1 - conf;
  const df1 = n - 1, df2 = (n - 1) * (k - 1);
  const lo = 1 - (1 - alpha) * fPpf(1 - g / 2, df1, df2);
  const hi = 1 - (1 - alpha) * fPpf(g / 2, df1, df2);
  const items = cols.map((c, j) => {
    const rest = rows.map((r) => r.reduce((s, v, t) => (t === j ? s : s + v), 0));
    const others = rows.map((r) => r.filter((_, t) => t !== j));
    let ifDeleted = NaN;
    if (k > 2) {
      const ot = others.map((r) => r.reduce((s, v) => s + v, 0));
      const vo = variance(ot);
      ifDeleted = ((k - 1) / (k - 2)) * (1 - Array.from({ length: k - 1 }, (_, t) => variance(others.map((r) => r[t]))).reduce((s, v) => s + v, 0) / vo);
    }
    return { mean: mean(c), sd: Math.sqrt(variance(c)), itemRest: variance(c) > 0 ? pearson(c, rest).r : NaN, alphaIfDeleted: ifDeleted };
  });
  // Standardised alpha from the mean inter-item correlation.
  let rsum = 0, cnt = 0;
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) { const r = pearson(cols[a], cols[b]).r; if (Number.isFinite(r)) { rsum += r; cnt++; } }
  const rbar = rsum / cnt;
  return { alpha, lo, hi, standardized: (k * rbar) / (1 + (k - 1) * rbar), meanInterItemR: rbar, items, n, k };
}

export type IccForm = "ICC1" | "ICC2" | "ICC3";
export function icc(rows: number[][], conf = 0.95) {
  const n = rows.length, k = rows[0]?.length ?? 0;
  if (k < 2 || n < 3) throw new AnalysisError("ICC needs at least two raters and three subjects with complete ratings.");
  const grand = mean(rows.flat());
  const rowM = rows.map(mean);
  const colM = Array.from({ length: k }, (_, j) => mean(rows.map((r) => r[j])));
  const SSR = k * rowM.reduce((s, m) => s + (m - grand) ** 2, 0);
  const SSC = n * colM.reduce((s, m) => s + (m - grand) ** 2, 0);
  const SST = rows.flat().reduce((s, v) => s + (v - grand) ** 2, 0);
  const SSE = SST - SSR - SSC;
  const MSR = SSR / (n - 1), MSC = SSC / (k - 1), MSE = SSE / ((n - 1) * (k - 1)), MSW = (SSC + SSE) / (n * (k - 1));
  const a = 1 - conf;
  const out: { form: string; description: string; single: number; average: number; f: number; df1: number; df2: number; p: number; lo: number; hi: number; loAvg: number; hiAvg: number }[] = [];
  // ICC(1): one-way random effects
  {
    const f = MSR / MSW, df1 = n - 1, df2 = n * (k - 1);
    const FL = f / fPpf(1 - a / 2, df1, df2), FU = f * fPpf(1 - a / 2, df2, df1);
    out.push({ form: "ICC1", description: "One-way random effects, absolute agreement", single: (MSR - MSW) / (MSR + (k - 1) * MSW), average: (MSR - MSW) / MSR, f, df1, df2, p: 1 - fCdf(f, df1, df2), lo: (FL - 1) / (FL + k - 1), hi: (FU - 1) / (FU + k - 1), loAvg: 1 - 1 / FL, hiAvg: 1 - 1 / FU });
  }
  // ICC(2): two-way random effects, absolute agreement (McGraw & Wong CI)
  {
    const s = (MSR - MSE) / (MSR + (k - 1) * MSE + (k * (MSC - MSE)) / n);
    const f = MSR / MSE, df1 = n - 1, df2 = (n - 1) * (k - 1);
    const A = (k * s) / (n * (1 - s)), B = 1 + (k * s * (n - 1)) / (n * (1 - s));
    const v = (A * MSC + B * MSE) ** 2 / ((A * MSC) ** 2 / (k - 1) + (B * MSE) ** 2 / ((n - 1) * (k - 1)));
    const FL = fPpf(1 - a / 2, n - 1, v), FU = fPpf(1 - a / 2, v, n - 1);
    const lo = (n * (MSR - FL * MSE)) / (FL * (k * MSC + (k * n - k - n) * MSE) + n * MSR);
    const hi = (n * (FU * MSR - MSE)) / (k * MSC + (k * n - k - n) * MSE + n * FU * MSR);
    out.push({ form: "ICC2", description: "Two-way random effects, absolute agreement", single: s, average: (MSR - MSE) / (MSR + (MSC - MSE) / n), f, df1, df2, p: 1 - fCdf(f, df1, df2), lo, hi, loAvg: (lo * k) / (1 + (k - 1) * lo), hiAvg: (hi * k) / (1 + (k - 1) * hi) });
  }
  // ICC(3): two-way mixed effects, consistency
  {
    const f = MSR / MSE, df1 = n - 1, df2 = (n - 1) * (k - 1);
    const FL = f / fPpf(1 - a / 2, df1, df2), FU = f * fPpf(1 - a / 2, df2, df1);
    out.push({ form: "ICC3", description: "Two-way mixed effects, consistency", single: (MSR - MSE) / (MSR + (k - 1) * MSE), average: (MSR - MSE) / MSR, f, df1, df2, p: 1 - fCdf(f, df1, df2), lo: (FL - 1) / (FL + k - 1), hi: (FU - 1) / (FU + k - 1), loAvg: 1 - 1 / FL, hiAvg: 1 - 1 / FU });
  }
  return { forms: out, n, k, ms: { MSR, MSC, MSE, MSW } };
}

/** Bland-Altman: bias, limits of agreement (bias ± 1.96 SD), and their approximate CIs (Bland & Altman 1999). */
export function blandAltman(a: number[], b: number[], conf = 0.95) {
  const n = a.length;
  if (n < 3) throw new AnalysisError("Bland-Altman analysis needs at least three pairs.");
  const diff = a.map((v, i) => v - b[i]), avg = a.map((v, i) => (v + b[i]) / 2);
  const bias = mean(diff), sd = Math.sqrt(variance(diff));
  const t = tPpf(1 - (1 - conf) / 2, n - 1);
  const seBias = sd / Math.sqrt(n), seLoa = Math.sqrt((3 * sd * sd) / n);
  const loaLo = bias - 1.96 * sd, loaHi = bias + 1.96 * sd;
  // Proportional bias: regression of differences on averages.
  const pr = pearson(avg, diff);
  return {
    n, bias, sd, biasLo: bias - t * seBias, biasHi: bias + t * seBias, loaLo, loaHi,
    loaLoCi: [loaLo - t * seLoa, loaLo + t * seLoa] as [number, number], loaHiCi: [loaHi - t * seLoa, loaHi + t * seLoa] as [number, number],
    points: avg.map((m, i) => [m, diff[i]] as [number, number]), proportionalR: pr.r, proportionalP: pr.p,
  };
}

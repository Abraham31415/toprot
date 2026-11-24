// Descriptive statistics for one numeric sample. Conventions (stated so results can be checked against other software):
//   variance and SD use n - 1; quantiles use linear interpolation (R type 7, NumPy default, Stata "centile" differs slightly);
//   skewness is the adjusted Fisher-Pearson G1 and kurtosis the excess G2, both as in SPSS, Excel and SciPy with bias=False;
//   the CI for the mean is t-based.

import { tPpf } from "@/lib/stats/dist";
import { quantile } from "@/lib/stats/tests";

export type Summary = {
  n: number; mean: number; sd: number; variance: number; se: number; ciLower: number; ciUpper: number;
  median: number; mode: number[]; min: number; max: number; range: number; q1: number; q3: number; iqr: number;
  p5: number; p10: number; p90: number; p95: number;
  skewness: number; seSkewness: number; kurtosis: number; seKurtosis: number; cv: number; sum: number;
};

/** Kahan-compensated sum, so means of large or wide-ranging data stay accurate. */
export function ksum(x: number[]): number {
  let s = 0, c = 0;
  for (const v of x) { const y = v - c; const t = s + y; c = (t - s) - y; s = t; }
  return s;
}

export function modes(x: number[]): number[] {
  const counts = new Map<number, number>();
  for (const v of x) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0;
  for (const c of counts.values()) best = Math.max(best, c);
  if (best <= 1 && x.length > 1) return []; // every value unique: no mode
  return [...counts.entries()].filter(([, c]) => c === best).map(([v]) => v).sort((a, b) => a - b);
}

export function summarize(x: number[], conf = 0.95): Summary {
  const n = x.length;
  const nan = NaN;
  if (n === 0) {
    return { n, mean: nan, sd: nan, variance: nan, se: nan, ciLower: nan, ciUpper: nan, median: nan, mode: [], min: nan, max: nan, range: nan, q1: nan, q3: nan, iqr: nan, p5: nan, p10: nan, p90: nan, p95: nan, skewness: nan, seSkewness: nan, kurtosis: nan, seKurtosis: nan, cv: nan, sum: 0 };
  }
  const s = ksum(x);
  const mean = s / n;
  // Two-pass central moments for numerical stability.
  let m2 = 0, m3 = 0, m4 = 0;
  for (const v of x) { const d = v - mean; const d2 = d * d; m2 += d2; m3 += d2 * d; m4 += d2 * d2; }
  const variance = n > 1 ? m2 / (n - 1) : nan;
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(n);
  const tc = n > 1 ? tPpf(1 - (1 - conf) / 2, n - 1) : nan;
  const sorted = [...x].sort((a, b) => a - b);
  const q = (p: number) => quantile(sorted, p);
  const b2 = m2 / n, b3 = m3 / n, b4 = m4 / n;
  const g1 = b2 > 0 ? b3 / b2 ** 1.5 : nan;
  const g2 = b2 > 0 ? b4 / (b2 * b2) - 3 : nan;
  const skewness = n > 2 && b2 > 0 ? (Math.sqrt(n * (n - 1)) / (n - 2)) * g1 : nan;
  const kurtosis = n > 3 && b2 > 0 ? ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6) : nan;
  const seSkewness = n > 2 ? Math.sqrt((6 * n * (n - 1)) / ((n - 2) * (n + 1) * (n + 3))) : nan;
  const seKurtosis = n > 3 ? Math.sqrt((4 * (n * n - 1) * seSkewness ** 2) / ((n - 3) * (n + 5))) : nan;
  const min = sorted[0], max = sorted[n - 1];
  return {
    n, mean, sd, variance, se, ciLower: mean - tc * se, ciUpper: mean + tc * se,
    median: q(0.5), mode: modes(x), min, max, range: max - min, q1: q(0.25), q3: q(0.75), iqr: q(0.75) - q(0.25),
    p5: q(0.05), p10: q(0.1), p90: q(0.9), p95: q(0.95),
    skewness, seSkewness, kurtosis, seKurtosis, cv: mean !== 0 ? sd / Math.abs(mean) : nan, sum: s,
  };
}

/** Weighted mean and SD with frequency-weight semantics (SPSS WEIGHT BY): n is the sum of weights. */
export function weightedSummary(x: number[], w: number[]) {
  let sw = 0, swx = 0;
  for (let i = 0; i < x.length; i++) { sw += w[i]; swx += w[i] * x[i]; }
  const mean = swx / sw;
  let ss = 0;
  for (let i = 0; i < x.length; i++) ss += w[i] * (x[i] - mean) ** 2;
  const variance = ss / (sw - 1);
  return { sumWeights: sw, mean, sd: Math.sqrt(variance), variance };
}

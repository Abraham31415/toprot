import { betaPpf, chi2Sf, fCdf, lnGamma, normCdf, tCdf, tPpf, tukeyCdf, tukeyPpf, zCrit } from "./dist";
import type { Interval } from "./epi";

export const sum = (x: number[]) => x.reduce((s, v) => s + v, 0);
export const mean = (x: number[]) => sum(x) / x.length;
export const variance = (x: number[]) => {
  const m = mean(x);
  return sum(x.map((v) => (v - m) ** 2)) / (x.length - 1);
};
export const sd = (x: number[]) => Math.sqrt(variance(x));

/** Linear-interpolation quantile (NumPy default / R type 7). */
export function quantile(x: number[], q: number): number {
  const s = [...x].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

const twoSidedT = (t: number, df: number) => Math.min(1, 2 * tCdf(-Math.abs(t), df));

export function describe(x: number[], conf = 0.95) {
  const n = x.length;
  const m = mean(x);
  const s = n > 1 ? sd(x) : NaN;
  const se = s / Math.sqrt(n);
  const tcrit = n > 1 ? tPpf(1 - (1 - conf) / 2, n - 1) : NaN;
  return {
    n, mean: m, sd: s, se, median: quantile(x, 0.5), q1: quantile(x, 0.25), q3: quantile(x, 0.75),
    min: Math.min(...x), max: Math.max(...x),
    meanCi: { lower: m - tcrit * se, upper: m + tcrit * se } as Interval,
  };
}

export type TTestResult = {
  t: number; df: number; p: number; meanDiff: number; se: number; ci: Interval; cohenD: number; method: string;
};

export function oneSampleT(x: number[], mu0: number, conf = 0.95): TTestResult {
  const n = x.length, m = mean(x), s = sd(x), se = s / Math.sqrt(n), df = n - 1;
  const t = (m - mu0) / se, c = tPpf(1 - (1 - conf) / 2, df);
  return { t, df, p: twoSidedT(t, df), meanDiff: m - mu0, se, ci: { lower: m - mu0 - c * se, upper: m - mu0 + c * se }, cohenD: (m - mu0) / s, method: "One-sample t-test" };
}

export function pairedT(x: number[], y: number[], conf = 0.95): TTestResult {
  const diff = x.map((v, i) => v - y[i]);
  return { ...oneSampleT(diff, 0, conf), method: "Paired t-test" };
}

export function twoSampleT(x: number[], y: number[], equalVar: boolean, conf = 0.95): TTestResult {
  const n1 = x.length, n2 = y.length, m1 = mean(x), m2 = mean(y), v1 = variance(x), v2 = variance(y);
  let se: number, df: number, sp: number;
  if (equalVar) {
    const pooled = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
    se = Math.sqrt(pooled * (1 / n1 + 1 / n2));
    df = n1 + n2 - 2;
    sp = Math.sqrt(pooled);
  } else {
    se = Math.sqrt(v1 / n1 + v2 / n2);
    df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
    sp = Math.sqrt((v1 + v2) / 2);
  }
  const diff = m1 - m2, t = diff / se, c = tPpf(1 - (1 - conf) / 2, df);
  return { t, df, p: twoSidedT(t, df), meanDiff: diff, se, ci: { lower: diff - c * se, upper: diff + c * se }, cohenD: diff / sp, method: equalVar ? "Student two-sample t-test (equal variances)" : "Welch two-sample t-test" };
}

export type ChiSquareResult = {
  chi2: number; df: number; p: number; expected: number[][]; minExpected: number; cellsBelow5: number; cramersV: number; yates: boolean;
};

/** Pearson chi-square test of independence for an r x c table (Yates correction optional for 2x2). */
export function chiSquare(table: number[][], yates = false): ChiSquareResult {
  const r = table.length, c = table[0].length;
  const rowT = table.map(sum);
  const colT = table[0].map((_, j) => sum(table.map((row) => row[j])));
  const N = sum(rowT);
  const expected = table.map((_, i) => colT.map((ct) => (rowT[i] * ct) / N));
  const useYates = yates && r === 2 && c === 2;
  let chi2 = 0;
  for (let i = 0; i < r; i++)
    for (let j = 0; j < c; j++) {
      const diff = Math.abs(table[i][j] - expected[i][j]);
      const adj = useYates ? Math.max(0, diff - 0.5) : diff;
      chi2 += (adj * adj) / expected[i][j];
    }
  const df = (r - 1) * (c - 1);
  const flat = expected.flat();
  return {
    chi2, df, p: chi2Sf(chi2, df), expected, minExpected: Math.min(...flat), cellsBelow5: flat.filter((e) => e < 5).length,
    cramersV: Math.sqrt(chi2 / (N * Math.min(r - 1, c - 1))), yates: useYates,
  };
}

const lnFact = (n: number) => lnGamma(n + 1);

/** Fisher exact test for a 2x2 table, two-sided (sums all tables at most as probable as observed; same rule as SciPy). */
export function fisherExact(a: number, b: number, c: number, d: number) {
  const r1 = a + b, r2 = c + d, c1 = a + c, N = r1 + r2;
  const logP = (x: number) => lnFact(r1) + lnFact(r2) + lnFact(c1) + lnFact(N - c1) - lnFact(N) - lnFact(x) - lnFact(r1 - x) - lnFact(c1 - x) - lnFact(r2 - c1 + x);
  const lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1);
  const pObs = Math.exp(logP(a));
  let two = 0, less = 0, greater = 0;
  for (let x = lo; x <= hi; x++) {
    const px = Math.exp(logP(x));
    if (px <= pObs * (1 + 1e-7)) two += px;
    if (x <= a) less += px;
    if (x >= a) greater += px;
  }
  return { pTwoSided: Math.min(1, two), pLess: Math.min(1, less), pGreater: Math.min(1, greater), sampleOddsRatio: (a * d) / (b * c) };
}

export type AnovaResult = {
  f: number; dfBetween: number; dfWithin: number; p: number; ssBetween: number; ssWithin: number;
  msBetween: number; msWithin: number; etaSquared: number; groups: { n: number; mean: number; sd: number }[];
};

export function oneWayAnova(groups: number[][]): AnovaResult {
  const all = groups.flat(), N = all.length, k = groups.length, gm = mean(all);
  const ssB = sum(groups.map((g) => g.length * (mean(g) - gm) ** 2));
  const ssW = sum(groups.map((g) => sum(g.map((v) => (v - mean(g)) ** 2))));
  const dfB = k - 1, dfW = N - k, msB = ssB / dfB, msW = ssW / dfW, f = msB / msW;
  return {
    f, dfBetween: dfB, dfWithin: dfW, p: Math.max(0, 1 - fCdf(f, dfB, dfW)), ssBetween: ssB, ssWithin: ssW, msBetween: msB, msWithin: msW,
    etaSquared: ssB / (ssB + ssW), groups: groups.map((g) => ({ n: g.length, mean: mean(g), sd: g.length > 1 ? sd(g) : NaN })),
  };
}

export type TukeyPair = { i: number; j: number; diff: number; q: number; p: number; ci: Interval };

/** Tukey-Kramer HSD: all pairwise comparisons after a one-way ANOVA, family-wise error controlled. */
export function tukeyHsd(groups: number[][], conf = 0.95): { pairs: TukeyPair[]; qCrit: number; msWithin: number; dfWithin: number } {
  const a = oneWayAnova(groups);
  const k = groups.length;
  const qCrit = tukeyPpf(conf, k, a.dfWithin);
  const pairs: TukeyPair[] = [];
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) {
      const diff = a.groups[i].mean - a.groups[j].mean;
      const se = Math.sqrt((a.msWithin / 2) * (1 / a.groups[i].n + 1 / a.groups[j].n));
      const q = Math.abs(diff) / se;
      pairs.push({ i, j, diff, q, p: Math.min(1, Math.max(0, 1 - tukeyCdf(q, k, a.dfWithin))), ci: { lower: diff - qCrit * se, upper: diff + qCrit * se } });
    }
  return { pairs, qCrit, msWithin: a.msWithin, dfWithin: a.dfWithin };
}

export function pearson(x: number[], y: number[], conf = 0.95) {
  const n = x.length, mx = mean(x), my = mean(y);
  const sxy = sum(x.map((v, i) => (v - mx) * (y[i] - my)));
  const r = sxy / Math.sqrt(sum(x.map((v) => (v - mx) ** 2)) * sum(y.map((v) => (v - my) ** 2)));
  const df = n - 2;
  const t = r * Math.sqrt(df / (1 - r * r));
  const p = Math.abs(r) === 1 ? 0 : twoSidedT(t, df);
  const z = Math.atanh(r), se = 1 / Math.sqrt(n - 3), zc = zCrit(conf);
  const ci = n > 3 ? { lower: Math.tanh(z - zc * se), upper: Math.tanh(z + zc * se) } : null;
  return { r, n, df, t, p, ci, rSquared: r * r };
}

/** Average ranks (ties share the mean rank). */
export function ranks(x: number[]): number[] {
  const idx = x.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(x.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

export function spearman(x: number[], y: number[], conf = 0.95) {
  const base = pearson(ranks(x), ranks(y), conf);
  // Bonett-Wright (2000) standard error for the Fisher-transformed Spearman coefficient.
  const n = x.length;
  const z = Math.atanh(base.r), se = Math.sqrt((1 + base.r ** 2 / 2) / (n - 3)), zc = zCrit(conf);
  const ci = n > 3 ? { lower: Math.tanh(z - zc * se), upper: Math.tanh(z + zc * se) } : null;
  return { rho: base.r, n, p: base.p, ci };
}

export function linearRegression(x: number[], y: number[], conf = 0.95) {
  const n = x.length, mx = mean(x), my = mean(y);
  const sxx = sum(x.map((v) => (v - mx) ** 2)), sxy = sum(x.map((v, i) => (v - mx) * (y[i] - my)));
  const slope = sxy / sxx, intercept = my - slope * mx;
  const resid = y.map((v, i) => v - (intercept + slope * x[i]));
  const sse = sum(resid.map((e) => e * e)), sst = sum(y.map((v) => (v - my) ** 2));
  const df = n - 2, s2 = sse / df;
  const seSlope = Math.sqrt(s2 / sxx), seInt = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  const tc = tPpf(1 - (1 - conf) / 2, df);
  return {
    n, slope, intercept, seSlope, seIntercept: seInt, tSlope: slope / seSlope, pSlope: twoSidedT(slope / seSlope, df),
    pIntercept: twoSidedT(intercept / seInt, df), slopeCi: { lower: slope - tc * seSlope, upper: slope + tc * seSlope },
    interceptCi: { lower: intercept - tc * seInt, upper: intercept + tc * seInt },
    rSquared: 1 - sse / sst, residualSe: Math.sqrt(s2), df,
  };
}

/** Logistic regression with one predictor, fitted by Newton-Raphson (IRLS). */
export function logisticRegression(x: number[], y: number[], conf = 0.95) {
  if (y.some((v) => v !== 0 && v !== 1)) throw new Error("The outcome must be coded 0 or 1.");
  const n = x.length;
  const ones = y.filter((v) => v === 1).length;
  if (ones === 0 || ones === n) throw new Error("The outcome has only one value, so a model cannot be fitted.");
  let b0 = Math.log(ones / (n - ones)), b1 = 0;
  let converged = false;
  let info = [0, 0, 0];
  for (let it = 0; it < 100; it++) {
    let g0 = 0, g1 = 0, i00 = 0, i01 = 0, i11 = 0;
    for (let i = 0; i < n; i++) {
      const eta = b0 + b1 * x[i], p = 1 / (1 + Math.exp(-eta)), w = p * (1 - p);
      g0 += y[i] - p; g1 += (y[i] - p) * x[i];
      i00 += w; i01 += w * x[i]; i11 += w * x[i] * x[i];
    }
    const det = i00 * i11 - i01 * i01;
    if (!(det > 1e-12)) throw new Error("The predictor has no variation, or the data are perfectly separated.");
    const d0 = (i11 * g0 - i01 * g1) / det, d1 = (-i01 * g0 + i00 * g1) / det;
    b0 += d0; b1 += d1;
    info = [i00, i01, i11];
    if (Math.abs(d0) < 1e-10 && Math.abs(d1) < 1e-10) { converged = true; break; }
    if (Math.abs(b0) > 30 || Math.abs(b1) > 30) throw new Error("Perfect or near-perfect separation: the maximum-likelihood estimate does not exist.");
  }
  if (!converged) throw new Error("The model did not converge.");
  const det = info[0] * info[2] - info[1] ** 2;
  const se0 = Math.sqrt(info[2] / det), se1 = Math.sqrt(info[0] / det);
  const z = zCrit(conf);
  const ll = sum(x.map((xi, i) => { const p = 1 / (1 + Math.exp(-(b0 + b1 * xi))); return y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p); }));
  const p0 = ones / n;
  const ll0 = ones * Math.log(p0) + (n - ones) * Math.log(1 - p0);
  const lrt = 2 * (ll - ll0);
  return {
    n, intercept: b0, slope: b1, seIntercept: se0, seSlope: se1,
    zSlope: b1 / se1, pSlope: 2 * (1 - normCdf(Math.abs(b1 / se1))),
    oddsRatio: Math.exp(b1), oddsRatioCi: { lower: Math.exp(b1 - z * se1), upper: Math.exp(b1 + z * se1) },
    logLikelihood: ll, lrChi2: lrt, lrP: chi2Sf(lrt, 1),
  };
}

/** Confidence interval for a mean from summary statistics (t-based). */
export function meanCi(m: number, s: number, n: number, conf = 0.95): Interval {
  const c = tPpf(1 - (1 - conf) / 2, n - 1) * (s / Math.sqrt(n));
  return { lower: m - c, upper: m + c };
}

/** Clopper-Pearson exact interval for a proportion. */
export function clopperPearson(x: number, n: number, conf = 0.95): Interval {
  const a = 1 - conf;
  return { lower: x === 0 ? 0 : betaPpf(a / 2, x, n - x + 1), upper: x === n ? 1 : betaPpf(1 - a / 2, x + 1, n - x) };
}

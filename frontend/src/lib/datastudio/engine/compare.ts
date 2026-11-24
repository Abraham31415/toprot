// Numerical routines for comparing groups. Each one states its convention so it can be checked against reference software.

import { chi2Sf, fCdf, normCdf, tukeyCdf, lnGamma } from "@/lib/stats/dist";
import { ranks } from "@/lib/stats/tests";
import { AnalysisError } from "./common";

const sum = (x: number[]) => x.reduce((s, v) => s + v, 0);
const mean = (x: number[]) => sum(x) / x.length;
const vr = (x: number[]) => { const m = mean(x); return sum(x.map((v) => (v - m) ** 2)) / (x.length - 1); };

/** Sum over tie groups of (t^3 - t). */
export function tieSum(x: number[]): number {
  const c = new Map<number, number>();
  for (const v of x) c.set(v, (c.get(v) ?? 0) + 1);
  let s = 0;
  for (const t of c.values()) if (t > 1) s += t ** 3 - t;
  return s;
}

/** Welch's one-way ANOVA (unequal variances). Same as statsmodels anova_oneway(use_var="unequal") and R oneway.test. */
export function welchAnova(groups: number[][]) {
  const k = groups.length;
  const n = groups.map((g) => g.length), m = groups.map(mean), v = groups.map(vr);
  const w = n.map((ni, i) => ni / v[i]);
  if (w.some((x) => !Number.isFinite(x))) throw new AnalysisError("Welch's ANOVA needs variation within every group.");
  const W = sum(w);
  const mw = sum(w.map((wi, i) => wi * m[i])) / W;
  const a = sum(w.map((wi, i) => wi * (m[i] - mw) ** 2)) / (k - 1);
  const lam = sum(w.map((wi, i) => (1 - wi / W) ** 2 / (n[i] - 1)));
  const b = 1 + ((2 * (k - 2)) / (k * k - 1)) * lam;
  const f = a / b;
  const df1 = k - 1, df2 = (k * k - 1) / (3 * lam);
  return { f, df1, df2, p: 1 - fCdf(f, df1, df2) };
}

/** Exact null distribution of the Mann-Whitney U statistic (no ties): counts for u = 0..n1*n2. */
function uDistribution(n1: number, n2: number): number[] {
  // f[i][j][u] by dynamic programming over (i, j); keep only the current table.
  let prev: number[][] = Array.from({ length: n2 + 1 }, () => [1]); // i = 0: one arrangement with u = 0
  for (let i = 1; i <= n1; i++) {
    const cur: number[][] = [];
    for (let j = 0; j <= n2; j++) {
      const size = i * j + 1;
      const arr = new Array<number>(size).fill(0);
      const a = prev[j]; // (i-1, j): adding an x larger than j y's? Recurrence f(i,j,u) = f(i-1,j,u-j) + f(i,j-1,u)
      for (let u = 0; u < a.length; u++) arr[u + j] += a[u];
      if (j > 0) { const b = cur[j - 1]; for (let u = 0; u < b.length; u++) arr[u] += b[u]; }
      cur.push(arr);
    }
    prev = cur;
  }
  return prev[n2];
}

/**
 * Mann-Whitney U test, two-sided. U is reported for the first group. Exact p when there are no ties and both groups have at most 8
 * observations; otherwise the normal approximation with tie correction and continuity correction (SciPy mannwhitneyu defaults).
 */
export function mannWhitney(x: number[], y: number[]) {
  const n1 = x.length, n2 = y.length, N = n1 + n2;
  const r = ranks([...x, ...y]);
  const r1 = sum(r.slice(0, n1));
  const u1 = r1 - (n1 * (n1 + 1)) / 2, u2 = n1 * n2 - u1;
  const ties = tieSum([...x, ...y]);
  const umax = Math.max(u1, u2);
  let p: number, method: string;
  const mu = (n1 * n2) / 2;
  const s = Math.sqrt(((n1 * n2) / 12) * (N + 1 - ties / (N * (N - 1))));
  const z = s > 0 ? (umax - mu - 0.5) / s : 0;
  if (ties === 0 && Math.max(n1, n2) <= 8) {
    const dist = uDistribution(n1, n2);
    const total = sum(dist);
    let tail = 0;
    for (let u = Math.round(umax); u < dist.length; u++) tail += dist[u];
    p = Math.min(1, (2 * tail) / total);
    method = "exact";
  } else {
    p = s > 0 ? Math.min(1, 2 * (1 - normCdf(z))) : 1;
    method = "normal approximation with continuity and tie correction";
  }
  const zSigned = s > 0 ? (u1 - mu) / s : 0;
  return { u1, u2, z: zSigned, p, method, meanRank1: r1 / n1, meanRank2: (sum(r) - r1) / n2, effectR: Math.abs(zSigned) / Math.sqrt(N), commonLanguage: u1 / (n1 * n2) };
}

/** Exact null distribution of the Wilcoxon signed-rank statistic T+ for n untied, non-zero differences. */
function signedRankDistribution(n: number): number[] {
  const max = (n * (n + 1)) / 2;
  let d = new Array<number>(max + 1).fill(0);
  d[0] = 1;
  for (let k = 1; k <= n; k++) { const nd = d.slice(); for (let t = k; t <= max; t++) nd[t] += d[t - k]; d = nd; }
  return d;
}

/**
 * Wilcoxon signed-rank test, two-sided, zero differences dropped (Wilcoxon's method). Exact p when there are no ties and at most 50 non-zero
 * differences; otherwise the normal approximation with tie correction and no continuity correction (SciPy wilcoxon defaults).
 */
export function wilcoxonSignedRank(d0: number[]) {
  const d = d0.filter((v) => v !== 0);
  const zeros = d0.length - d.length;
  const n = d.length;
  if (n === 0) throw new AnalysisError("Every paired difference is zero, so the test cannot be computed.");
  const r = ranks(d.map(Math.abs));
  const wPlus = sum(r.filter((_, i) => d[i] > 0)), wMinus = sum(r.filter((_, i) => d[i] < 0));
  const T = Math.min(wPlus, wMinus);
  const ties = tieSum(d.map(Math.abs));
  const mu = (n * (n + 1)) / 4;
  const se = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - ties / 48);
  const z = se > 0 ? (T - mu) / se : 0;
  let p: number, method: string;
  if (ties === 0 && zeros === 0 && n <= 50) {
    const dist = signedRankDistribution(n);
    const total = 2 ** n;
    let tail = 0;
    for (let t = 0; t <= Math.round(T); t++) tail += dist[t];
    p = Math.min(1, (2 * tail) / total);
    method = "exact";
  } else {
    p = se > 0 ? Math.min(1, 2 * normCdf(z)) : 1;
    method = "normal approximation with tie correction";
  }
  return { wPlus, wMinus, T, z: se > 0 ? (wPlus - mu) / se : 0, p, n, zeros, method, effectR: Math.abs(z) / Math.sqrt(n) };
}

/** Kruskal-Wallis H with tie correction; chi-square p with k - 1 df. Epsilon-squared effect size = H / (N - 1). */
export function kruskalWallis(groups: number[][]) {
  const all = groups.flat(), N = all.length, k = groups.length;
  const r = ranks(all);
  let pos = 0, s = 0;
  const meanRanks: number[] = [];
  for (const g of groups) { const rs = sum(r.slice(pos, pos + g.length)); s += (rs * rs) / g.length; meanRanks.push(rs / g.length); pos += g.length; }
  let h = (12 / (N * (N + 1))) * s - 3 * (N + 1);
  const c = 1 - tieSum(all) / (N ** 3 - N);
  if (c <= 0) throw new AnalysisError("All values are identical, so the Kruskal-Wallis test cannot be computed.");
  h /= c;
  return { h, df: k - 1, p: chi2Sf(h, k - 1), meanRanks, epsilon2: h / (N - 1) };
}

/** Friedman test for k related samples (rows are subjects). Tie-corrected, as SciPy friedmanchisquare. Kendall's W = Q / (n (k - 1)). */
export function friedman(rows: number[][]) {
  const n = rows.length, k = rows[0].length;
  const R = new Array<number>(k).fill(0);
  let tieAdj = 0;
  for (const row of rows) { const rr = ranks(row); rr.forEach((v, j) => (R[j] += v)); tieAdj += tieSum(row); }
  let q = (12 / (n * k * (k + 1))) * sum(R.map((x) => x * x)) - 3 * n * (k + 1);
  const c = 1 - tieAdj / (n * k * (k * k - 1));
  if (c <= 0) throw new AnalysisError("Every subject has identical values across conditions, so the Friedman test cannot be computed.");
  q /= c;
  return { q, df: k - 1, p: chi2Sf(q, k - 1), meanRanks: R.map((x) => x / n), kendallW: q / (n * (k - 1)) };
}

const lnChoose = (n: number, k: number) => lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
/** Two-sided exact binomial test p for x successes in n trials with p = 0.5 (used by the sign test and exact McNemar). */
export function binomTwoSidedHalf(x: number, n: number): number {
  if (n === 0) return 1;
  const k = Math.min(x, n - x);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(lnChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

export function signTest(diffs: number[]) {
  const pos = diffs.filter((d) => d > 0).length, neg = diffs.filter((d) => d < 0).length;
  return { positive: pos, negative: neg, ties: diffs.length - pos - neg, p: binomTwoSidedHalf(pos, pos + neg) };
}

/** Cochran's Q for k binary (0/1) related measurements. */
export function cochranQ(rows: number[][]) {
  const k = rows[0].length;
  const colT = new Array<number>(k).fill(0);
  let rowSq = 0, Nt = 0;
  for (const r of rows) { const t = sum(r); r.forEach((v, j) => (colT[j] += v)); rowSq += t * t; Nt += t; }
  const num = (k - 1) * (k * sum(colT.map((c) => c * c)) - Nt * Nt);
  const den = k * Nt - rowSq;
  if (den === 0) throw new AnalysisError("Cochran's Q cannot be computed: every subject has the same response in every condition.");
  const q = num / den;
  return { q, df: k - 1, p: chi2Sf(q, k - 1), proportions: colT.map((c) => c / rows.length) };
}

/** Games-Howell pairwise comparisons (unequal variances), studentized-range p-values with Welch df. */
export function gamesHowell(groups: number[][]) {
  const k = groups.length;
  const n = groups.map((g) => g.length), m = groups.map(mean), v = groups.map(vr);
  const out: { i: number; j: number; diff: number; se: number; q: number; df: number; p: number }[] = [];
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) {
      const a = v[i] / n[i], b = v[j] / n[j];
      const se = Math.sqrt((a + b) / 2);
      const df = (a + b) ** 2 / (a * a / (n[i] - 1) + b * b / (n[j] - 1));
      const q = Math.abs(m[i] - m[j]) / se;
      out.push({ i, j, diff: m[i] - m[j], se: Math.sqrt(a + b), q, df, p: Math.min(1, Math.max(0, 1 - tukeyCdf(q, k, df))) });
    }
  return out;
}

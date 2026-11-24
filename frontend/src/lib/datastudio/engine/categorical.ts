// Contingency tables and agreement statistics.

import { chi2Sf, normCdf, normPpf, zCrit } from "@/lib/stats/dist";
import { chiSquare } from "@/lib/stats/tests";
import { AnalysisError } from "./common";
import { binomTwoSidedHalf } from "./compare";

/** Likelihood-ratio chi-square (G-test) for an r x c table. */
export function gTest(table: number[][]) {
  const row = table.map((r) => r.reduce((s, v) => s + v, 0));
  const col = table[0].map((_, j) => table.reduce((s, r) => s + r[j], 0));
  const N = row.reduce((s, v) => s + v, 0);
  let g = 0;
  table.forEach((r, i) => r.forEach((o, j) => { if (o > 0) g += 2 * o * Math.log(o / ((row[i] * col[j]) / N)); }));
  const df = (table.length - 1) * (table[0].length - 1);
  return { g, df, p: chi2Sf(g, df) };
}

/** Pearson chi-square, guarded against empty rows or columns (which make expected counts zero). */
export function pearsonChi2(table: number[][], yates = false) {
  if (table.some((r) => r.every((v) => v === 0)) || table[0].some((_, j) => table.every((r) => r[j] === 0))) {
    throw new AnalysisError("A row or column of the table is empty, so expected counts are zero. Remove the empty category first.");
  }
  return chiSquare(table, yates);
}

/** Mantel-Haenszel common odds ratio over K 2x2 strata, Robins-Breslow-Greenland CI, MH chi-square (with continuity correction), Breslow-Day homogeneity. */
export function mantelHaenszel(strata: { a: number; b: number; c: number; d: number }[], conf = 0.95) {
  const s = strata.filter((t) => t.a + t.b + t.c + t.d > 1);
  if (!s.length) throw new AnalysisError("No stratum has enough observations.");
  let R = 0, S = 0, PR = 0, PS_QR = 0, QS = 0;
  let sumA = 0, sumE = 0, sumV = 0;
  for (const { a, b, c, d } of s) {
    const n = a + b + c + d;
    const r = (a * d) / n, sv = (b * c) / n;
    const P = (a + d) / n, Q = (b + c) / n;
    R += r; S += sv; PR += P * r; PS_QR += P * sv + Q * r; QS += Q * sv;
    const n1 = a + b, n0 = c + d, m1 = a + c, m0 = b + d;
    sumA += a; sumE += (n1 * m1) / n;
    if (n > 1) sumV += (n1 * n0 * m1 * m0) / (n * n * (n - 1));
  }
  if (R === 0 || S === 0) throw new AnalysisError("The Mantel-Haenszel odds ratio is not defined: one side of every stratum has a zero cell.");
  const or = R / S;
  const varLog = PR / (2 * R * R) + PS_QR / (2 * R * S) + QS / (2 * S * S);
  const z = zCrit(conf);
  const chi2 = (Math.abs(sumA - sumE) - 0.5) ** 2 / sumV;
  // Breslow-Day test of homogeneity (without Tarone's correction)
  let bd = 0;
  for (const { a, b, c, d } of s) {
    const n1 = a + b, m1 = a + c, n = a + b + c + d;
    // Solve (A (n - n1 - m1 + A)) / ((n1 - A)(m1 - A)) = or for A in [max(0, n1 + m1 - n), min(n1, m1)].
    const lo = Math.max(0, n1 + m1 - n), hi = Math.min(n1, m1);
    let A: number;
    if (Math.abs(or - 1) < 1e-12) A = (n1 * m1) / n;
    else {
      const qa = 1 - or, qb = (n - n1 - m1) + or * (n1 + m1), qc = -or * n1 * m1;
      const disc = Math.sqrt(qb * qb - 4 * qa * qc);
      const r1 = (-qb + disc) / (2 * qa), r2 = (-qb - disc) / (2 * qa);
      A = r1 >= lo - 1e-9 && r1 <= hi + 1e-9 ? r1 : r2;
    }
    const B = n1 - A, C = m1 - A, D = n - n1 - m1 + A;
    const v = 1 / (1 / A + 1 / B + 1 / C + 1 / D);
    if (Number.isFinite(v) && v > 0) bd += (a - A) ** 2 / v;
  }
  const bdDf = s.length - 1;
  return {
    or, ci: { lower: Math.exp(Math.log(or) - z * Math.sqrt(varLog)), upper: Math.exp(Math.log(or) + z * Math.sqrt(varLog)) }, seLog: Math.sqrt(varLog),
    chi2, p: chi2Sf(chi2, 1), breslowDay: bd, bdDf, bdP: bdDf > 0 ? chi2Sf(bd, bdDf) : NaN, strata: s.length,
  };
}

/** McNemar test for paired binary data from the discordant counts b and c. Exact binomial p when b + c < 25, else chi-square with continuity correction. */
export function mcnemar(b: number, c: number) {
  const n = b + c;
  if (n === 0) return { stat: 0, p: 1, exact: true };
  if (n < 25) return { stat: Math.min(b, c), p: binomTwoSidedHalf(b, n), exact: true };
  const stat = (Math.abs(b - c) - 1) ** 2 / n;
  return { stat, p: chi2Sf(stat, 1), exact: false };
}

/**
 * Cohen's kappa for two raters over the same categories, optionally weighted (linear or quadratic weights on ordered categories).
 * SE and CI use the asymptotic variance under the alternative (Fleiss, Cohen & Everitt 1969), as statsmodels cohens_kappa.
 */
export function cohenKappa(table: number[][], weights: "none" | "linear" | "quadratic" = "none", conf = 0.95) {
  const k = table.length;
  const N = table.flat().reduce((s, v) => s + v, 0);
  if (!N) throw new AnalysisError("The agreement table is empty.");
  const p = table.map((r) => r.map((v) => v / N));
  const pr = p.map((r) => r.reduce((s, v) => s + v, 0));
  const pc = p[0].map((_, j) => p.reduce((s, r) => s + r[j], 0));
  const w = (i: number, j: number) => (weights === "none" ? (i === j ? 1 : 0) : weights === "linear" ? 1 - Math.abs(i - j) / (k - 1) : 1 - ((i - j) / (k - 1)) ** 2);
  let po = 0, pe = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { po += w(i, j) * p[i][j]; pe += w(i, j) * pr[i] * pc[j]; }
  if (pe === 1) throw new AnalysisError("Kappa is undefined: both raters used a single category.");
  const kappa = (po - pe) / (1 - pe);
  const wbarR = pr.map((_, i) => pc.reduce((s, c, j) => s + w(i, j) * c, 0));
  const wbarC = pc.map((_, j) => pr.reduce((s, r, i) => s + w(i, j) * r, 0));
  let v = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) v += p[i][j] * (w(i, j) * (1 - pe) - (wbarR[i] + wbarC[j]) * (1 - po)) ** 2;
  v -= (po * pe - 2 * pe + po) ** 2;
  const se = Math.sqrt(v / (N * (1 - pe) ** 4));
  // SE under the null hypothesis kappa = 0, for the z test.
  let v0 = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) v0 += pr[i] * pc[j] * (w(i, j) - (wbarR[i] + wbarC[j])) ** 2;
  v0 -= pe * pe;
  const se0 = Math.sqrt(v0 / (N * (1 - pe) ** 2));
  const z = zCrit(conf);
  return { kappa, se, lo: kappa - z * se, hi: kappa + z * se, z: kappa / se0, p: 2 * (1 - normCdf(Math.abs(kappa / se0))), po, pe, n: N };
}

/** Fleiss' kappa for m raters: counts[i][j] = number of raters who put subject i in category j (same total per subject). */
export function fleissKappa(counts: number[][]) {
  const N = counts.length, m = counts[0].reduce((s, v) => s + v, 0);
  if (counts.some((r) => r.reduce((s, v) => s + v, 0) !== m)) throw new AnalysisError("Fleiss' kappa needs the same number of ratings for every subject.");
  if (m < 2) throw new AnalysisError("Fleiss' kappa needs at least two ratings per subject.");
  const k = counts[0].length;
  const pj = Array.from({ length: k }, (_, j) => counts.reduce((s, r) => s + r[j], 0) / (N * m));
  const Pi = counts.map((r) => (r.reduce((s, v) => s + v * v, 0) - m) / (m * (m - 1)));
  const Pbar = Pi.reduce((s, v) => s + v, 0) / N;
  const Pe = pj.reduce((s, v) => s + v * v, 0);
  const kappa = (Pbar - Pe) / (1 - Pe);
  const sumP = pj.reduce((s, v) => s + v * (1 - v), 0);
  const se0 = Math.sqrt(2 / (N * m * (m - 1))) * Math.sqrt(sumP ** 2 - pj.reduce((s, v) => s + v * (1 - v) * (1 - 2 * v), 0)) / sumP;
  const z = kappa / se0;
  return { kappa, se0, z, p: 2 * (1 - normCdf(Math.abs(z))), subjects: N, raters: m };
}

/** Wilson interval reused for proportions; exported here so categorical results use one definition. */
export function wilsonCi(x: number, n: number, conf = 0.95) {
  const z = normPpf(1 - (1 - conf) / 2), p = x / n, z2 = z * z, den = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / den, h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { lower: Math.max(0, c - h), upper: Math.min(1, c + h) };
}

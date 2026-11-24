// Survival analysis: Kaplan-Meier with Greenwood standard errors, the log-rank test, and Cox proportional hazards (Breslow ties).

import { chi2Sf, normCdf, zCrit } from "@/lib/stats/dist";
import { AnalysisError } from "./common";
import { symInverse, type Mat } from "./linalg";

export type KmRow = { time: number; atRisk: number; events: number; censored: number; surv: number; se: number; lo: number; hi: number };

/** Kaplan-Meier estimate. CI on the log(-log S) scale (Kalbfleisch-Prentice), which stays inside 0 to 1. */
export function kaplanMeier(time: number[], event: number[], conf = 0.95) {
  const idx = time.map((_, i) => i).sort((a, b) => time[a] - time[b]);
  const z = zCrit(conf);
  let atRisk = time.length, s = 1, gw = 0;
  const rows: KmRow[] = [];
  const censorMarks: [number, number][] = [];
  let k = 0;
  while (k < idx.length) {
    const t = time[idx[k]];
    let d = 0, c = 0;
    while (k < idx.length && time[idx[k]] === t) { if (event[idx[k]] === 1) d++; else c++; k++; }
    if (d > 0) {
      s *= 1 - d / atRisk;
      if (atRisk > d) gw += d / (atRisk * (atRisk - d));
      const se = s * Math.sqrt(gw);
      let lo = NaN, hi = NaN;
      if (s > 0 && s < 1) {
        const ll = Math.log(-Math.log(s)), sell = Math.sqrt(gw) / Math.abs(Math.log(s));
        lo = Math.exp(-Math.exp(ll + z * sell)); hi = Math.exp(-Math.exp(ll - z * sell));
      } else if (s === 1) { lo = 1; hi = 1; } else { lo = 0; hi = 0; }
      rows.push({ time: t, atRisk, events: d, censored: c, surv: s, se, lo, hi });
    }
    if (c > 0) censorMarks.push([t, s]);
    atRisk -= d + c;
  }
  // Median: the smallest time at which S(t) <= 0.5. CI: the times at which the lower and upper bands cross 0.5 (Brookmeyer-Crowley style).
  const firstBelow = (f: (r: KmRow) => number) => rows.find((r) => f(r) <= 0.5)?.time ?? null;
  return { rows, censorMarks, median: firstBelow((r) => r.surv), medianLo: firstBelow((r) => r.lo), medianHi: firstBelow((r) => r.hi), n: time.length, events: event.filter((e) => e === 1).length };
}

/** Survival probability at a time (step function). */
export function survAt(rows: KmRow[], t: number): KmRow | null {
  let last: KmRow | null = null;
  for (const r of rows) { if (r.time <= t) last = r; else break; }
  return last;
}

/** Log-rank (Mantel-Cox) test comparing survival across groups. */
export function logRank(time: number[], event: number[], group: number[]) {
  const G = Math.max(...group) + 1;
  const times = [...new Set(time.filter((_, i) => event[i] === 1))].sort((a, b) => a - b);
  const O = new Array<number>(G).fill(0), E = new Array<number>(G).fill(0);
  const V: Mat = Array.from({ length: G }, () => new Array<number>(G).fill(0));
  for (const t of times) {
    const n = new Array<number>(G).fill(0), d = new Array<number>(G).fill(0);
    for (let i = 0; i < time.length; i++) { if (time[i] >= t) n[group[i]]++; if (time[i] === t && event[i] === 1) d[group[i]]++; }
    const N = n.reduce((s, v) => s + v, 0), D = d.reduce((s, v) => s + v, 0);
    for (let g = 0; g < G; g++) {
      O[g] += d[g]; E[g] += (D * n[g]) / N;
      if (N > 1) for (let h = 0; h < G; h++) V[g][h] += ((D * (N - D)) / (N - 1)) * ((n[g] / N) * ((g === h ? 1 : 0) - n[h] / N));
    }
  }
  // Chi-square = (O - E)' V^- (O - E) using the first G - 1 groups.
  const k = G - 1;
  const u = O.slice(0, k).map((o, g) => o - E[g]);
  const Vs = V.slice(0, k).map((r) => r.slice(0, k));
  const { inv, aliased } = symInverse(Vs);
  if (aliased.length) throw new AnalysisError("The log-rank test cannot be computed (a group has no one at risk at any event time).");
  const chi2 = u.reduce((s, ui, i) => s + ui * inv[i].reduce((t, v, j) => t + v * u[j], 0), 0);
  return { chi2, df: k, p: chi2Sf(chi2, k), observed: O, expected: E };
}

/** Cox proportional hazards by Newton-Raphson on the Breslow partial likelihood. Hazard ratios with Wald CIs. */
export function coxPH(time: number[], event: number[], X: Mat, conf = 0.95) {
  const n = time.length, p = X[0]?.length ?? 0;
  if (!p) throw new AnalysisError("Add at least one predictor to the Cox model.");
  const events = event.filter((e) => e === 1).length;
  if (events === 0) throw new AnalysisError("There are no events, so a Cox model cannot be fitted.");
  const order = time.map((_, i) => i).sort((a, b) => time[b] - time[a]); // descending time: risk sets accumulate
  const loglik = (beta: number[]) => {
    let ll = 0;
    let S0 = 0;
    const S1 = new Array<number>(p).fill(0);
    const S2: Mat = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const grad = new Array<number>(p).fill(0);
    const H: Mat = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    let k = 0;
    while (k < n) {
      const t = time[order[k]];
      const tied: number[] = [];
      while (k < n && time[order[k]] === t) { const i = order[k]; const eta = X[i].reduce((s, v, j) => s + v * beta[j], 0); const r = Math.exp(eta); S0 += r; for (let a = 0; a < p; a++) { S1[a] += r * X[i][a]; for (let b = 0; b < p; b++) S2[a][b] += r * X[i][a] * X[i][b]; } tied.push(i); k++; }
      const d = tied.filter((i) => event[i] === 1);
      if (!d.length) continue;
      for (const i of d) { ll += X[i].reduce((s, v, j) => s + v * beta[j], 0); for (let a = 0; a < p; a++) grad[a] += X[i][a]; }
      ll -= d.length * Math.log(S0);
      for (let a = 0; a < p; a++) {
        grad[a] -= (d.length * S1[a]) / S0;
        for (let b = 0; b < p; b++) H[a][b] += d.length * (S2[a][b] / S0 - (S1[a] * S1[b]) / (S0 * S0));
      }
    }
    return { ll, grad, H };
  };
  let beta = new Array<number>(p).fill(0);
  let cur = loglik(beta);
  const ll0 = cur.ll;
  let converged = false, inv: Mat = [];
  for (let it = 0; it < 50; it++) {
    const r = symInverse(cur.H);
    if (r.aliased.length) throw new AnalysisError("The Cox model predictors are collinear or a predictor is constant among subjects at risk.");
    inv = r.inv;
    let step = inv.map((row) => row.reduce((s, v, j) => s + v * cur.grad[j], 0));
    let next = beta.map((b, j) => b + step[j]);
    let nx = loglik(next), h = 0;
    while (nx.ll < cur.ll - 1e-10 && h < 30) { step = step.map((s) => s / 2); next = beta.map((b, j) => b + step[j]); nx = loglik(next); h++; }
    beta = next;
    const dl = nx.ll - cur.ll;
    cur = nx;
    if (Math.max(...step.map(Math.abs)) < 1e-9 || Math.abs(dl) < 1e-11) { converged = true; break; }
  }
  inv = symInverse(cur.H).inv;
  if (!converged) throw new AnalysisError("The Cox model did not converge.");
  if (beta.some((b, j) => !Number.isFinite(Math.sqrt(inv[j][j])) || Math.abs(b) * Math.sqrt(X.reduce((s, r) => s + r[j] ** 2, 0) / n) > 15)) {
    throw new AnalysisError("A hazard ratio is running off to infinity (monotone likelihood): a predictor separates events perfectly, for example a group with no events.");
  }
  const z = zCrit(conf);
  const coefs = beta.map((b, j) => {
    const se = Math.sqrt(inv[j][j]);
    return { b, se, z: b / se, p: 2 * (1 - normCdf(Math.abs(b / se))), hr: Math.exp(b), lo: Math.exp(b - z * se), hi: Math.exp(b + z * se) };
  });
  const lr = 2 * (cur.ll - ll0);
  // Harrell's C-index
  const eta = X.map((r) => r.reduce((s, v, j) => s + v * beta[j], 0));
  let conc = 0, perm = 0;
  for (let i = 0; i < n; i++) if (event[i] === 1) for (let j = 0; j < n; j++) if (time[j] > time[i]) { perm++; conc += eta[i] > eta[j] ? 1 : eta[i] === eta[j] ? 0.5 : 0; }
  return { coefs, logLik: cur.ll, logLik0: ll0, lr, lrDf: p, lrP: chi2Sf(lr, p), events, n, cIndex: perm ? conc / perm : NaN, cov: inv };
}

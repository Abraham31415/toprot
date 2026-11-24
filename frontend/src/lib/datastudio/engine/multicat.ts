// Regression for outcomes with more than two categories: multinomial logistic regression (statsmodels MNLogit parametrisation, first
// category as reference) and the proportional-odds cumulative logit model (statsmodels OrderedModel with distr="logit":
// P(Y <= j) = F(theta_j - x'b), so a positive coefficient shifts the outcome towards higher categories).

import { chi2Sf, normCdf, normPpf } from "@/lib/stats/dist";
import { AnalysisError } from "./common";
import { matvec, symInverse, type Mat } from "./linalg";
import type { Coef } from "./regression";

const dot = (r: number[], b: number[]) => r.reduce((s, v, j) => s + v * b[j], 0);

function coefs(beta: number[], cov: Mat, conf: number, names: string[]): Coef[] {
  const z = normPpf(1 - (1 - conf) / 2);
  return beta.map((b, j) => {
    const se = Math.sqrt(cov[j][j]);
    const zz = b / se;
    return { name: names[j], b, se, stat: zz, p: Math.min(1, 2 * (1 - normCdf(Math.abs(zz)))), lo: b - z * se, hi: b + z * se };
  });
}

/** Log-likelihood of the intercept-only (null) model for a categorical outcome: sum of n_j log(n_j / n). */
function nullLL(y: number[], K: number): number {
  const n = y.length;
  const cnt = new Array<number>(K).fill(0);
  for (const v of y) cnt[v]++;
  return cnt.reduce((s, c) => s + (c > 0 ? c * Math.log(c / n) : 0), 0);
}

/**
 * Multinomial logistic regression. y holds category indices 0..K-1 (0 = reference). X includes the intercept column.
 * Coefficients are returned per non-reference category, each a vector of length p.
 */
export function multinomialLogit(X: Mat, y: number[], K: number, opts: { conf?: number; colNames?: string[] } = {}) {
  const n = X.length, p = X[0].length, m = K - 1, q = m * p;
  const conf = opts.conf ?? 0.95;
  if (K < 3) throw new AnalysisError("Multinomial regression needs an outcome with at least three categories; use binary logistic regression for two.");
  if (n <= q) throw new AnalysisError(`The model has ${q} coefficients but only ${n} complete observations.`);
  const probs = (b: number[]) => X.map((r) => {
    const e = [0];
    for (let k = 0; k < m; k++) e.push(dot(r, b.slice(k * p, (k + 1) * p)));
    const mx = Math.max(...e);
    const ex = e.map((v) => Math.exp(v - mx));
    const s = ex.reduce((a, v) => a + v, 0);
    return ex.map((v) => v / s);
  });
  const loglik = (P: number[][]) => P.reduce((s, pr, i) => s + Math.log(Math.max(pr[y[i]], 1e-300)), 0);
  let beta = new Array<number>(q).fill(0);
  let P = probs(beta), ll = loglik(P), converged = false, iter = 0, inv: Mat = [];
  for (iter = 1; iter <= 100; iter++) {
    const g = new Array<number>(q).fill(0);
    const H: Mat = Array.from({ length: q }, () => new Array<number>(q).fill(0));
    for (let i = 0; i < n; i++) {
      const r = X[i], pr = P[i];
      for (let j = 0; j < m; j++) {
        const resid = (y[i] === j + 1 ? 1 : 0) - pr[j + 1];
        for (let a = 0; a < p; a++) g[j * p + a] += r[a] * resid;
        for (let k = j; k < m; k++) {
          const w = pr[j + 1] * ((j === k ? 1 : 0) - pr[k + 1]);
          for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) H[j * p + a][k * p + b] += r[a] * r[b] * w;
        }
      }
    }
    for (let a = 0; a < q; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
    const si = symInverse(H);
    if (si.aliased.length) throw new AnalysisError("The predictors are perfectly collinear, or a category has too few observations to estimate its coefficients.");
    inv = si.inv;
    let step = matvec(inv, g), next = beta.map((b, j) => b + step[j]), Pn = probs(next), lln = loglik(Pn), h = 0;
    while (lln < ll - 1e-10 && h++ < 30) { step = step.map((s) => s / 2); next = beta.map((b, j) => b + step[j]); Pn = probs(next); lln = loglik(Pn); }
    const change = Math.max(...step.map(Math.abs));
    beta = next; P = Pn;
    const dll = lln - ll; ll = lln;
    if (change < 1e-10 || Math.abs(dll) < 1e-13) { converged = true; break; }
  }
  // Recompute the information at the solution.
  const H: Mat = Array.from({ length: q }, () => new Array<number>(q).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) for (let k = 0; k < m; k++) {
    const w = P[i][j + 1] * ((j === k ? 1 : 0) - P[i][k + 1]);
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) H[j * p + a][k * p + b] += X[i][a] * X[i][b] * w;
  }
  inv = symInverse(H).inv;
  const sdCol = (j: number) => { const c = X.map((r) => r[j]); const mu = c.reduce((s, v) => s + v, 0) / n; return Math.sqrt(c.reduce((s, v) => s + (v - mu) ** 2, 0) / n); };
  if (beta.some((b, j) => j % p > 0 && Math.abs(b) * sdCol(j % p) > 15) || P.every((pr, i) => pr[y[i]] > 1 - 1e-6))
    throw new AnalysisError("Complete or quasi-complete separation: a predictor (or combination) perfectly predicts one of the outcome categories, so the estimates do not exist. Combine sparse categories or remove the predictor.");
  if (!converged) throw new AnalysisError("The multinomial model did not converge after 100 iterations.");
  const names = opts.colNames ?? Array.from({ length: p }, (_, j) => `x${j}`);
  const cf = coefs(beta, inv, conf, Array.from({ length: q }, (_, j) => names[j % p]));
  const ll0 = nullLL(y, K);
  const lr = 2 * (ll - ll0), lrDf = q - m;
  return {
    n, p, K, coefs: Array.from({ length: m }, (_, k) => cf.slice(k * p, (k + 1) * p)), beta, cov: inv, fitted: P, logLik: ll, logLik0: ll0,
    lr, lrDf, lrP: chi2Sf(lr, lrDf), mcfadden: 1 - ll / ll0, aic: -2 * ll + 2 * q, bic: -2 * ll + Math.log(n) * q, iterations: iter,
  };
}

const F = (x: number) => (x === Infinity ? 1 : x === -Infinity ? 0 : x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
const f = (x: number) => (Number.isFinite(x) ? F(x) * (1 - F(x)) : 0);
const fp = (x: number) => (Number.isFinite(x) ? f(x) * (1 - 2 * F(x)) : 0);

/**
 * Proportional-odds (cumulative logit) model. y holds ordered category indices 0..K-1; X has no intercept column (the K - 1 thresholds
 * play that role). Returns the slope coefficients and the thresholds theta_1 < ... < theta_{K-1}, each with standard errors.
 */
export function ordinalLogit(X: Mat, y: number[], K: number, opts: { conf?: number; colNames?: string[] } = {}) {
  const n = X.length, p = X[0]?.length ?? 0, m = K - 1, q = p + m;
  const conf = opts.conf ?? 0.95;
  if (K < 3) throw new AnalysisError("An ordinal model needs at least three ordered categories; use binary logistic regression for two.");
  if (n <= q) throw new AnalysisError(`The model has ${q} parameters but only ${n} complete observations.`);
  const cnt = new Array<number>(K).fill(0);
  for (const v of y) cnt[v]++;
  if (cnt.some((c) => c === 0)) throw new AnalysisError("Every outcome category needs at least one observation among the complete cases.");
  // Start: no slopes, thresholds at the empirical cumulative logits.
  let cum = 0;
  let theta = cnt.slice(0, m).map((c) => { cum += c; const pr = cum / n; return Math.log(pr / (1 - pr)); });
  let beta = new Array<number>(p).fill(0);
  const th = (t: number[], j: number) => (j < 0 ? -Infinity : j >= m ? Infinity : t[j]);
  const loglik = (b: number[], t: number[]) => {
    for (let j = 1; j < m; j++) if (!(t[j] > t[j - 1])) return -Infinity;
    let s = 0;
    for (let i = 0; i < n; i++) { const eta = dot(X[i], b); const pr = F(th(t, y[i]) - eta) - F(th(t, y[i] - 1) - eta); s += Math.log(Math.max(pr, 1e-300)); }
    return s;
  };
  const derivs = (b: number[], t: number[]) => {
    const g = new Array<number>(q).fill(0);
    const H: Mat = Array.from({ length: q }, () => new Array<number>(q).fill(0));
    for (let i = 0; i < n; i++) {
      const eta = dot(X[i], b), j = y[i];
      const A = th(t, j) - eta, B = th(t, j - 1) - eta;
      const D = F(A) - F(B), fa = f(A), fb = f(B), fpa = fp(A), fpb = fp(B);
      const r = X[i];
      const gb = -(fa - fb) / D;
      const hbb = (fpa - fpb) / D - ((fa - fb) / D) ** 2;
      for (let a = 0; a < p; a++) { g[a] += r[a] * gb; for (let c = a; c < p; c++) H[a][c] += r[a] * r[c] * hbb; }
      if (j < m) { // theta_j (index j) is the upper bound
        const ia = p + j;
        g[ia] += fa / D;
        H[ia][ia] += fpa / D - (fa / D) ** 2;
        const hbt = -fpa / D + (fa * (fa - fb)) / (D * D);
        for (let a = 0; a < p; a++) H[a][ia] += r[a] * hbt;
      }
      if (j > 0) { // theta_{j-1} is the lower bound
        const ib = p + j - 1;
        g[ib] -= fb / D;
        H[ib][ib] += -fpb / D - (fb / D) ** 2;
        const hbt = fpb / D - (fb * (fa - fb)) / (D * D);
        for (let a = 0; a < p; a++) H[a][ib] += r[a] * hbt;
        if (j < m) H[Math.min(ib, p + j)][Math.max(ib, p + j)] += (fa * fb) / (D * D);
      }
    }
    for (let a = 0; a < q; a++) for (let c = 0; c < a; c++) H[a][c] = H[c][a];
    return { g, H };
  };
  let ll = loglik(beta, theta), converged = false, iter = 0;
  for (iter = 1; iter <= 100; iter++) {
    const { g, H } = derivs(beta, theta);
    const si = symInverse(H.map((r) => r.map((v) => -v)));
    if (si.aliased.length) throw new AnalysisError("The predictors are perfectly collinear.");
    let step = matvec(si.inv, g);
    const tryStep = (s: number[]) => { const b = beta.map((v, k) => v + s[k]); const t = theta.map((v, k) => v + s[p + k]); return { b, t, ll: loglik(b, t) }; };
    let c = tryStep(step), h = 0;
    while (c.ll < ll - 1e-10 && h++ < 40) { step = step.map((v) => v / 2); c = tryStep(step); }
    const change = Math.max(...step.map(Math.abs));
    beta = c.b; theta = c.t;
    const dll = c.ll - ll; ll = c.ll;
    if (change < 1e-10 || Math.abs(dll) < 1e-13) { converged = true; break; }
  }
  const { H } = derivs(beta, theta);
  const inv = symInverse(H.map((r) => r.map((v) => -v))).inv;
  const sdCol = (j: number) => { const c = X.map((r) => r[j]); const mu = c.reduce((s, v) => s + v, 0) / n; return Math.sqrt(c.reduce((s, v) => s + (v - mu) ** 2, 0) / n); };
  if (beta.some((b, j) => Math.abs(b) * sdCol(j) > 15)) throw new AnalysisError("Complete or quasi-complete separation: a predictor perfectly orders the outcome, so the estimates do not exist. Combine categories or remove the predictor.");
  if (!converged || !Number.isFinite(ll)) throw new AnalysisError("The ordinal model did not converge after 100 iterations.");
  const names = opts.colNames ?? Array.from({ length: p }, (_, j) => `x${j}`);
  const all = coefs([...beta, ...theta], inv, conf, [...names, ...theta.map((_, j) => `threshold ${j + 1}`)]);
  const ll0 = nullLL(y, K);
  const lr = 2 * (ll - ll0);
  return {
    n, p, K, coefs: all.slice(0, p), thresholds: all.slice(p), beta, theta, cov: inv, logLik: ll, logLik0: ll0, lr, lrDf: p, lrP: chi2Sf(lr, p),
    mcfadden: 1 - ll / ll0, aic: -2 * ll + 2 * q, bic: -2 * ll + Math.log(n) * q, iterations: iter,
  };
}

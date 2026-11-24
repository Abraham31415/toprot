// Generalized linear models with a log link: Poisson, negative binomial (NB2, dispersion estimated by maximum likelihood) and gamma.
// Fitting is IRLS on a QR solve (Poisson, gamma) and a joint Newton-Raphson on (coefficients, alpha) for NB2. Definitions follow
// statsmodels (GLM for Poisson and gamma, discrete NegativeBinomial for NB2) so the reference suite can compare like with like.

import { lnGamma, normCdf, normPpf } from "@/lib/stats/dist";
import { AnalysisError } from "./common";
import { crossprod, matvec, qrLeastSquares, symInverse, type Mat } from "./linalg";
import type { Coef } from "./regression";

export type GlmFamily = "poisson" | "negbin" | "gamma";

/** Digamma by recurrence to x >= 10 and the asymptotic series (absolute error below 1e-14). */
export function digamma(x: number): number {
  let r = 0;
  while (x < 10) { r -= 1 / x; x += 1; }
  const f = 1 / (x * x);
  return r + Math.log(x) - 0.5 / x - f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f * (1 / 132)))));
}
/** Trigamma by recurrence and the asymptotic series. */
export function trigamma(x: number): number {
  let r = 0;
  while (x < 10) { r += 1 / (x * x); x += 1; }
  const f = 1 / (x * x);
  return r + 1 / x + f / 2 + (f / x) * (1 / 6 - f * (1 / 30 - f * (1 / 42 - f * (1 / 30 - f * (5 / 66)))));
}

/** log Gamma(y + r) - log Gamma(r), summed exactly for whole-number y (stable when r is large). */
function lgDiff(y: number, r: number): number {
  if (Number.isInteger(y) && y <= 5000) { let s = 0; for (let k = 0; k < y; k++) s += Math.log(r + k); return s; }
  return lnGamma(y + r) - lnGamma(r);
}
function psiDiff(y: number, r: number): number {
  if (Number.isInteger(y) && y <= 5000) { let s = 0; for (let k = 0; k < y; k++) s += 1 / (r + k); return s; }
  return digamma(y + r) - digamma(r);
}
function triDiff(y: number, r: number): number {
  if (Number.isInteger(y) && y <= 5000) { let s = 0; for (let k = 0; k < y; k++) s -= 1 / ((r + k) * (r + k)); return s; }
  return trigamma(y + r) - trigamma(r);
}

const dot = (r: number[], b: number[]) => r.reduce((s, v, j) => s + v * b[j], 0);
const lgFact = (y: number) => lnGamma(y + 1);

export type GlmFit = {
  family: GlmFamily; n: number; p: number; coefs: Coef[]; beta: number[]; cov: Mat; mu: number[];
  logLik: number; aic: number; bic: number; deviance: number; pearsonChi2: number; dfResid: number; scale: number;
  alpha?: number; alphaSe?: number; iterations: number; robust: boolean;
};

/** Weighted least-squares step of IRLS with working weights w and working response z (offset removed). */
function wls(X: Mat, z: number[], w: number[]): number[] | null {
  const sw = w.map(Math.sqrt);
  const r = qrLeastSquares(X.map((row, i) => row.map((v) => v * sw[i])), z.map((v, i) => v * sw[i]));
  return r ? r.beta : null;
}

function poissonLL(y: number[], mu: number[]) { return y.reduce((s, v, i) => s + (v === 0 ? 0 : v * Math.log(mu[i])) - mu[i] - lgFact(v), 0); }
function nbLL(y: number[], mu: number[], a: number) {
  const r = 1 / a;
  return y.reduce((s, v, i) => s + lgDiff(v, r) - lgFact(v) - (r + v) * Math.log1p(a * mu[i]) + (v === 0 ? 0 : v * Math.log(a * mu[i])), 0);
}
function gammaLL(y: number[], mu: number[], scale: number) {
  const ws = 1 / scale;
  return y.reduce((s, v, i) => { const ym = v / mu[i]; return s + ws * Math.log(ws * ym) - ws * ym - lnGamma(ws) - Math.log(v); }, 0);
}

/** IRLS for a log-link GLM with variance mu (Poisson), mu^2 (gamma) or mu + a mu^2 (NB2 with a fixed). */
function irls(X: Mat, y: number[], off: number[], variance: (m: number) => number, colNames: string[] | undefined, beta0?: number[]) {
  const n = X.length;
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  let mu = beta0 ? X.map((r, i) => Math.exp(dot(r, beta0) + off[i])) : y.map((v) => (v + ybar) / 2);
  let eta = mu.map(Math.log);
  let beta: number[] = beta0 ?? [];
  let dev = Infinity, it = 0, converged = false;
  for (it = 1; it <= 200; it++) {
    const w = mu.map((m) => (m * m) / variance(m));
    const z = eta.map((e, i) => e - off[i] + (y[i] - mu[i]) / mu[i]);
    const b = wls(X, z, w);
    if (!b) throw new AnalysisError(`The predictors are perfectly collinear${colNames ? ` (check ${colNames.slice(1).join(", ")})` : ""}.`);
    beta = b;
    eta = X.map((r, i) => dot(r, beta) + off[i]);
    if (eta.some((e) => e > 700)) throw new AnalysisError("The model did not converge: fitted means grew without bound. Check for a predictor that separates zero from non-zero counts, or rescale predictors.");
    mu = eta.map(Math.exp);
    const d = mu.reduce((s, m, i) => s + ((y[i] - m) ** 2) / variance(m), 0);
    if (Math.abs(d - dev) <= 1e-13 * Math.max(1, Math.abs(d))) { converged = true; break; }
    dev = d;
  }
  if (!converged) throw new AnalysisError("The model did not converge after 200 iterations.");
  return { beta, mu, iterations: it };
}

function coefTable(beta: number[], cov: Mat, conf: number, colNames?: string[]): Coef[] {
  const z = normPpf(1 - (1 - conf) / 2);
  return beta.map((b, j) => {
    const se = Math.sqrt(cov[j][j]);
    const zz = b / se;
    return { name: colNames?.[j] ?? `x${j}`, b, se, stat: zz, p: Math.min(1, 2 * (1 - normCdf(Math.abs(zz)))), lo: b - z * se, hi: b + z * se };
  });
}

/** Sandwich covariance H^-1 (sum s_i s_i') H^-1 (HC0, no small-sample factor), given the inverse Hessian and per-observation scores. */
function sandwich(Hinv: Mat, scores: number[][]): Mat {
  const k = Hinv.length;
  const meat: Mat = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (const s of scores) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) meat[a][b] += s[a] * s[b];
  const t = Hinv.map((r) => meat[0].map((_, j) => r.reduce((acc, v, q) => acc + v * meat[q][j], 0)));
  return t.map((r) => Hinv[0].map((_, j) => r.reduce((acc, v, q) => acc + v * Hinv[q][j], 0)));
}

export function fitGlm(X: Mat, y: number[], opts: { family: GlmFamily; offset?: number[]; conf?: number; robust?: boolean; colNames?: string[] }): GlmFit {
  const n = X.length, p = X[0]?.length ?? 0;
  const conf = opts.conf ?? 0.95;
  const off = opts.offset ?? new Array<number>(n).fill(0);
  if (n <= p) throw new AnalysisError(`The model has ${p} coefficients but only ${n} complete observations.`);
  const fam = opts.family;
  if (fam === "gamma") {
    if (y.some((v) => !(v > 0))) throw new AnalysisError("A gamma model needs a strictly positive outcome; zero or negative values are present.");
  } else {
    if (y.some((v) => v < 0 || !Number.isInteger(v))) throw new AnalysisError("A count model needs whole numbers of zero or more; the outcome has negative or fractional values.");
    if (y.every((v) => v === 0)) throw new AnalysisError("Every count is zero, so a count model cannot be fitted.");
  }
  if (fam === "negbin") return fitNegBin(X, y, off, conf, !!opts.robust, opts.colNames);
  const V = fam === "poisson" ? (m: number) => m : (m: number) => m * m;
  const { beta, mu, iterations } = irls(X, y, off, V, opts.colNames);
  const pearson = mu.reduce((s, m, i) => s + ((y[i] - m) ** 2) / V(m), 0);
  const dfResid = n - p;
  const scale = fam === "poisson" ? 1 : pearson / dfResid;
  const w = mu.map((m) => (m * m) / V(m));
  const info = crossprod(X, w);
  const inv = symInverse(info);
  if (inv.aliased.length) throw new AnalysisError("The predictors are perfectly collinear.");
  let cov = inv.inv.map((r) => r.map((v) => v * scale));
  if (opts.robust) {
    // statsmodels evaluates the bread with the observed Hessian; for the gamma log link it differs from the expected one.
    const hw = fam === "poisson" ? mu : y.map((v, i) => v / mu[i]);
    const Hinv = symInverse(crossprod(X, hw)).inv;
    const scores = X.map((r, i) => { const u = fam === "poisson" ? y[i] - mu[i] : y[i] / mu[i] - 1; return r.map((v) => v * u); });
    cov = sandwich(Hinv, scores);
  }
  const deviance = fam === "poisson"
    ? 2 * y.reduce((s, v, i) => s + (v === 0 ? 0 : v * Math.log(v / mu[i])) - (v - mu[i]), 0)
    : 2 * y.reduce((s, v, i) => s - Math.log(v / mu[i]) + (v - mu[i]) / mu[i], 0);
  const logLik = fam === "poisson" ? poissonLL(y, mu) : gammaLL(y, mu, scale);
  return {
    family: fam, n, p, coefs: coefTable(beta, cov, conf, opts.colNames), beta, cov, mu, logLik, aic: -2 * logLik + 2 * p, bic: -2 * logLik + Math.log(n) * p,
    deviance, pearsonChi2: pearson, dfResid, scale, iterations, robust: !!opts.robust,
  };
}

/** Gradient and Hessian of the NB2 log-likelihood in (beta, alpha). */
function nbDerivs(X: Mat, y: number[], off: number[], beta: number[], a: number) {
  const n = X.length, p = beta.length, k = p + 1;
  const g = new Array<number>(k).fill(0);
  const H: Mat = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const r = 1 / a;
  const scores: number[][] = [];
  for (let i = 0; i < n; i++) {
    const mu = Math.exp(dot(X[i], beta) + off[i]), yi = y[i], q = 1 + a * mu;
    const sEta = (yi - mu) / q;
    const hEta = -(mu * (1 + a * yi)) / (q * q);
    const A = psiDiff(yi, r) - Math.log(q);
    const sA = -r * r * A + (yi - mu) / (a * q);
    const hAA = 2 * r * r * r * A + r ** 4 * triDiff(yi, r) + (r * r * mu) / q - ((yi - mu) * (1 + 2 * a * mu)) / ((a + a * a * mu) ** 2);
    const hAEta = (mu * (mu - yi)) / (q * q);
    const xi = X[i];
    const si = new Array<number>(k);
    for (let j = 0; j < p; j++) { g[j] += xi[j] * sEta; si[j] = xi[j] * sEta; for (let l = j; l < p; l++) H[j][l] += xi[j] * xi[l] * hEta; H[j][p] += xi[j] * hAEta; }
    g[p] += sA; si[p] = sA; H[p][p] += hAA;
    scores.push(si);
  }
  for (let j = 0; j < k; j++) for (let l = 0; l < j; l++) H[j][l] = H[l][j];
  return { g, H, scores };
}

function fitNegBin(X: Mat, y: number[], off: number[], conf: number, robust: boolean, colNames?: string[]): GlmFit {
  const n = X.length, p = X[0].length;
  // Start from the Poisson fit and a moment estimate of alpha, alternate a few times, then polish jointly with Newton-Raphson.
  const pois = irls(X, y, off, (m) => m, colNames);
  let beta = pois.beta;
  let a = Math.max(0.05, pois.mu.reduce((s, m, i) => s + ((y[i] - m) ** 2 - y[i]) / (m * m), 0) / (n - p));
  let ll = nbLL(y, pois.mu, a);
  let iterations = pois.iterations, converged = false;
  for (let outer = 0; outer < 50; outer++) {
    beta = irls(X, y, off, (m) => m + a * m * m, colNames, beta).beta;
    const mu = X.map((r, i) => Math.exp(dot(r, beta) + off[i]));
    // Newton on log(alpha) with step halving.
    for (let t = 0; t < 50; t++) {
      const { g, H } = nbDerivs(X, y, off, beta, a);
      const gl = g[p] * a, hl = H[p][p] * a * a + g[p] * a;
      let step = hl < 0 ? -gl / hl : Math.sign(gl) * 0.5;
      step = Math.max(-3, Math.min(3, step));
      let next = a * Math.exp(step), lln = nbLL(y, mu, next), h = 0;
      while (lln < nbLL(y, mu, a) - 1e-12 && h++ < 40) { step /= 2; next = a * Math.exp(step); lln = nbLL(y, mu, next); }
      a = next;
      if (Math.abs(step) < 1e-10) break;
      if (a < 1e-10) break;
    }
    const lln = nbLL(y, mu, a);
    iterations++;
    if (Math.abs(lln - ll) < 1e-12 * Math.max(1, Math.abs(lln))) { ll = lln; converged = true; break; }
    ll = lln;
  }
  if (a < 1e-6) throw new AnalysisError("The estimated dispersion is effectively zero: the counts are not overdispersed, so the negative binomial model reduces to the Poisson model. Use the Poisson model instead.");
  // Joint Newton polish on (beta, alpha).
  for (let t = 0; t < 50; t++) {
    const { g, H } = nbDerivs(X, y, off, beta, a);
    const inv = symInverse(H.map((r) => r.map((v) => -v)));
    if (inv.aliased.length) throw new AnalysisError("The predictors are perfectly collinear.");
    let step = matvec(inv.inv, g);
    const cur = nbLL(y, X.map((r, i) => Math.exp(dot(r, beta) + off[i])), a);
    let h = 0;
    const tryAt = (s: number[]) => { const b = beta.map((v, j) => v + s[j]); const aa = a + s[p]; return aa > 0 ? { b, aa, ll: nbLL(y, X.map((r, i) => Math.exp(dot(r, b) + off[i])), aa) } : null; };
    let cand = tryAt(step);
    while ((!cand || cand.ll < cur - 1e-12) && h++ < 40) { step = step.map((v) => v / 2); cand = tryAt(step); }
    if (!cand) break;
    beta = cand.b; a = cand.aa; ll = cand.ll;
    if (Math.max(...step.map(Math.abs)) < 1e-11) { converged = true; break; }
  }
  if (!converged) throw new AnalysisError("The negative binomial model did not converge.");
  const { H, scores } = nbDerivs(X, y, off, beta, a);
  const Hinv = symInverse(H.map((r) => r.map((v) => -v))).inv;
  const covFull = robust ? sandwich(Hinv, scores) : Hinv;
  const cov = covFull.slice(0, p).map((r) => r.slice(0, p));
  const mu = X.map((r, i) => Math.exp(dot(r, beta) + off[i]));
  const V = (m: number) => m + a * m * m;
  const pearson = mu.reduce((s, m, i) => s + ((y[i] - m) ** 2) / V(m), 0);
  const deviance = 2 * y.reduce((s, v, i) => s + (v === 0 ? 0 : v * Math.log(v / mu[i])) - (v + 1 / a) * Math.log((1 + a * v) / (1 + a * mu[i])), 0);
  return {
    family: "negbin", n, p, coefs: coefTable(beta, cov, conf, colNames), beta, cov, mu, logLik: ll, aic: -2 * ll + 2 * (p + 1), bic: -2 * ll + Math.log(n) * (p + 1),
    deviance, pearsonChi2: pearson, dfResid: n - p, scale: 1, alpha: a, alphaSe: Math.sqrt(covFull[p][p]), iterations, robust,
  };
}

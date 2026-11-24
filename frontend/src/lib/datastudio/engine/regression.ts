// Linear and logistic regression with explicit design matrices. Categorical predictors are dummy-coded against a documented reference
// level; interactions and polynomial terms are built here so the coefficient names say exactly what each column is.

import { chi2Sf, fCdf, normCdf, normPpf, tCdf, tPpf } from "@/lib/stats/dist";
import { AnalysisError, levelLabel, levels } from "./common";
import { aliasedColumns, crossprod, crossvec, matvec, qrLeastSquares, symInverse, type Mat } from "./linalg";
import { isMissing, type Dataset, type Variable } from "../types";

/** coding: "treatment" (dummy, default) or "sum" (effect coding against the last level, as statsmodels C(x, Sum); needed for Type III tests). */
export type PredictorSpec = { name: string; categorical?: boolean; reference?: string; coding?: "treatment" | "sum" };
export type TermInfo = { label: string; columns: number[]; variable?: string };

export type Design = {
  X: Mat; colNames: string[]; terms: TermInfo[]; rows: number[];
  references: { variable: string; reference: string; levels: string[] }[];
};

const isCategorical = (v: Variable, spec?: PredictorSpec) => spec?.categorical ?? (v.type !== "numeric" || v.measure === "nominal");

/**
 * Builds the design matrix with an intercept, listwise deletion over every variable used, dummy coding (reference = chosen level, else the
 * first level in sorted order), polynomial terms (x^2, x^3, raw, not orthogonal) and two-way interactions.
 */
export function buildDesign(d: Dataset, outcome: string | null, preds: PredictorSpec[], interactions: [string, string][] = [], poly: { name: string; degree: number }[] = [], extra: string[] = []): Design {
  const names = [...new Set([...(outcome ? [outcome] : []), ...preds.map((p) => p.name), ...extra])];
  const idx = names.map((n) => { const j = d.variables.findIndex((v) => v.name === n); if (j < 0) throw new AnalysisError(`Variable "${n}" does not exist.`); return j; });
  const rows: number[] = [];
  for (let i = 0; i < (d.columns[0]?.length ?? 0); i++) if (idx.every((j) => !isMissing(d.variables[j], d.columns[j][i]))) rows.push(i);

  type Block = { name: string; cols: number[][]; colNames: string[] };
  const blocks = new Map<string, Block>();
  const references: Design["references"] = [];
  for (const p of preds) {
    const j = d.variables.findIndex((v) => v.name === p.name);
    const v = d.variables[j];
    if (isCategorical(v, p)) {
      const lv = levels(d, j, rows);
      if (lv.length < 2) throw new AnalysisError(`"${p.name}" has only one category among the complete cases, so it cannot be a predictor.`);
      if (lv.length > 50) throw new AnalysisError(`"${p.name}" has ${lv.length} categories; that is too many for a categorical predictor.`);
      if (p.coding === "sum") {
        const last = lv[lv.length - 1];
        references.push({ variable: p.name, reference: `${levelLabel(v, last)} (effect coding: each level is compared with the unweighted mean of all levels)`, levels: lv.map((l) => levelLabel(v, l)) });
        const others = lv.slice(0, -1);
        blocks.set(p.name, { name: p.name, cols: others.map((l) => rows.map((i) => { const c = String(d.columns[j][i]); return c === l ? 1 : c === last ? -1 : 0; })), colNames: others.map((l) => `${p.name}: ${levelLabel(v, l)} (effect)`) });
        continue;
      }
      const ref = p.reference !== undefined && lv.includes(p.reference) ? p.reference : lv[0];
      references.push({ variable: p.name, reference: levelLabel(v, ref), levels: lv.map((l) => levelLabel(v, l)) });
      const others = lv.filter((l) => l !== ref);
      blocks.set(p.name, { name: p.name, cols: others.map((l) => rows.map((i) => (String(d.columns[j][i]) === l ? 1 : 0))), colNames: others.map((l) => `${p.name}: ${levelLabel(v, l)} (vs ${levelLabel(v, ref)})`) });
    } else {
      if (v.type !== "numeric") throw new AnalysisError(`"${p.name}" is not numeric; mark it as categorical.`);
      blocks.set(p.name, { name: p.name, cols: [rows.map((i) => d.columns[j][i] as number)], colNames: [p.name] });
    }
  }
  const X: number[][] = rows.map(() => [1]);
  const colNames = ["(Intercept)"];
  const terms: TermInfo[] = [{ label: "(Intercept)", columns: [0] }];
  const addBlock = (label: string, cols: number[][], cn: string[], variable?: string) => {
    const start = colNames.length;
    cols.forEach((c) => c.forEach((v, r) => X[r].push(v)));
    colNames.push(...cn);
    terms.push({ label, columns: cn.map((_, k) => start + k), variable });
  };
  for (const p of preds) { const b = blocks.get(p.name)!; addBlock(p.name, b.cols, b.colNames, p.name); }
  for (const pt of poly) {
    const b = blocks.get(pt.name);
    if (!b || b.cols.length !== 1 || b.colNames[0] !== pt.name) throw new AnalysisError(`A polynomial term needs "${pt.name}" to be a continuous predictor in the model.`);
    for (let k = 2; k <= pt.degree; k++) addBlock(`${pt.name}^${k}`, [b.cols[0].map((x) => x ** k)], [`${pt.name}^${k}`]);
  }
  for (const [a, b] of interactions) {
    const A = blocks.get(a), B = blocks.get(b);
    if (!A || !B) throw new AnalysisError(`An interaction needs both "${a}" and "${b}" as predictors in the model.`);
    const cols: number[][] = [], cn: string[] = [];
    A.cols.forEach((ca, x) => B.cols.forEach((cb, y) => { cols.push(ca.map((v, r) => v * cb[r])); cn.push(`${A.colNames[x]} × ${B.colNames[y]}`); }));
    addBlock(`${a} × ${b}`, cols, cn);
  }
  const des = { X, colNames, terms, rows, references };
  if (rows.length > 0) checkAliased(des);
  return des;
}

function checkAliased(des: Design): void {
  const al = aliasedColumns(des.X);
  if (al.length) throw new AnalysisError(`Perfect multicollinearity: ${al.map((j) => `"${des.colNames[j]}"`).join(", ")} ${al.length === 1 ? "is an exact linear combination" : "are exact linear combinations"} of other predictors (or constant). Remove ${al.length === 1 ? "it" : "them"} or one of the variables ${al.length === 1 ? "it depends" : "they depend"} on.`);
}

export type Coef = { name: string; b: number; se: number; stat: number; p: number; lo: number; hi: number };

export function ols(X: Mat, y: number[], opts: { conf?: number; robust?: "none" | "HC3"; colNames?: string[] } = {}) {
  const n = X.length, p = X[0].length;
  const conf = opts.conf ?? 0.95;
  if (n <= p) throw new AnalysisError(`The model has ${p} coefficients but only ${n} complete observations. Use fewer predictors or more data.`);
  const qr = qrLeastSquares(X, y);
  if (!qr) {
    const al = aliasedColumns(X);
    throw new AnalysisError(`The predictors are perfectly collinear (${(al.length ? al : [0]).map((j) => opts.colNames?.[j] ?? `column ${j}`).join(", ")}).`);
  }
  const { beta, xtxInv: inv } = qr;
  const fitted = X.map((r) => r.reduce((s, v, j) => s + v * beta[j], 0));
  const resid = y.map((v, i) => v - fitted[i]);
  const sse = resid.reduce((s, e) => s + e * e, 0);
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  const sst = y.reduce((s, v) => s + (v - ybar) ** 2, 0);
  const df = n - p, s2 = sse / df;
  const lev = X.map((r) => { const t = matvec(inv, r); return r.reduce((s, v, j) => s + v * t[j], 0); });
  let cov: Mat;
  if (opts.robust === "HC3") {
    // (X'X)^-1 X' diag(e^2 / (1 - h)^2) X (X'X)^-1
    const w = resid.map((e, i) => (e / (1 - lev[i])) ** 2);
    const meat = crossprod(X, w);
    const tmp = inv.map((r) => meat[0].map((_, j) => r.reduce((s, v, k) => s + v * meat[k][j], 0)));
    cov = tmp.map((r) => inv[0].map((_, j) => r.reduce((s, v, k) => s + v * inv[k][j], 0)));
  } else cov = inv.map((r) => r.map((v) => v * s2));
  const tc = tPpf(1 - (1 - conf) / 2, df);
  const coefs: Coef[] = beta.map((b, j) => {
    const se = Math.sqrt(cov[j][j]);
    const t = b / se;
    return { name: opts.colNames?.[j] ?? `x${j}`, b, se, stat: t, p: Math.min(1, 2 * tCdf(-Math.abs(t), df)), lo: b - tc * se, hi: b + tc * se };
  });
  const hasIntercept = X.every((r) => r[0] === 1);
  const dfModel = p - (hasIntercept ? 1 : 0);
  const r2 = hasIntercept ? 1 - sse / sst : NaN;
  const adjR2 = hasIntercept ? 1 - (1 - r2) * ((n - 1) / df) : NaN;
  const f = dfModel > 0 ? ((sst - sse) / dfModel) / s2 : NaN;
  const ll = -0.5 * n * (Math.log(2 * Math.PI) + Math.log(sse / n) + 1);
  return {
    n, p, df, coefs, beta, cov, fitted, resid, leverage: lev, sse, sst, s2, sigma: Math.sqrt(s2), r2, adjR2,
    f, dfModel, fP: dfModel > 0 ? 1 - fCdf(f, dfModel, df) : NaN, // AIC and BIC count the p regression coefficients only, as statsmodels and Stata do (R also counts the residual variance, adding 2).
    logLik: ll, aic: -2 * ll + 2 * p, bic: -2 * ll + Math.log(n) * p, inv,
  };
}

/** Wald F test that a set of coefficients are all zero (classical covariance). Used for multi-column terms (categorical predictors). */
export function waldF(beta: number[], cov: Mat, cols: number[], dfResid: number): { f: number; df1: number; p: number } {
  const b = cols.map((j) => beta[j]);
  const V = cols.map((a) => cols.map((c) => cov[a][c]));
  const { inv, aliased } = symInverse(V);
  if (aliased.length) return { f: NaN, df1: cols.length, p: NaN };
  const q = b.reduce((s, bi, i) => s + bi * inv[i].reduce((t, v, j) => t + v * b[j], 0), 0);
  const f = q / cols.length;
  return { f, df1: cols.length, p: 1 - fCdf(f, cols.length, dfResid) };
}

/** Variance inflation factors for each non-intercept column: 1 / (1 - R^2) regressing it on the other columns. */
export function vif(X: Mat): number[] {
  const p = X[0].length;
  const out: number[] = [];
  for (let j = 1; j < p; j++) {
    const y = X.map((r) => r[j]);
    const Z = X.map((r) => r.filter((_, k) => k !== j));
    try { const m = ols(Z, y); out.push(1 / (1 - m.r2)); } catch { out.push(Infinity); }
  }
  return out;
}

/** Breusch-Pagan test (Koenker's studentised version, as statsmodels het_breuschpagan): n R^2 of e^2 on X, chi-square with p - 1 df. */
export function breuschPagan(X: Mat, resid: number[]) {
  const e2 = resid.map((e) => e * e);
  const aux = ols(X, e2);
  const lm = X.length * aux.r2;
  const df = X[0].length - 1;
  return { lm, df, p: chi2Sf(lm, df) };
}

export function durbinWatson(resid: number[]): number {
  let num = 0;
  for (let i = 1; i < resid.length; i++) num += (resid[i] - resid[i - 1]) ** 2;
  return num / resid.reduce((s, e) => s + e * e, 0);
}

export function cooksDistance(resid: number[], lev: number[], s2: number, p: number): number[] {
  return resid.map((e, i) => (e * e / (p * s2)) * (lev[i] / (1 - lev[i]) ** 2));
}

/** Logistic regression by iteratively reweighted least squares, with separation detection. y must be 0/1. */
export function logistic(X: Mat, y: number[], opts: { conf?: number; colNames?: string[] } = {}) {
  const n = X.length, p = X[0].length;
  const conf = opts.conf ?? 0.95;
  const events = y.filter((v) => v === 1).length;
  if (events === 0 || events === n) throw new AnalysisError("The outcome has only one value among the complete cases, so a model cannot be fitted.");
  if (n <= p) throw new AnalysisError(`The model has ${p} coefficients but only ${n} complete observations.`);
  let beta = new Array<number>(p).fill(0);
  beta[0] = Math.log(events / (n - events));
  let converged = false, iter = 0, ll = -Infinity, inv: Mat = [];
  const loglik = (b: number[]) => {
    let s = 0;
    for (let i = 0; i < n; i++) { const eta = X[i].reduce((t, v, j) => t + v * b[j], 0); s += y[i] * eta - (eta > 0 ? eta + Math.log1p(Math.exp(-eta)) : Math.log1p(Math.exp(eta))); }
    return s;
  };
  ll = loglik(beta);
  for (iter = 1; iter <= 100; iter++) {
    const mu = X.map((r) => 1 / (1 + Math.exp(-r.reduce((t, v, j) => t + v * beta[j], 0))));
    const w = mu.map((m) => Math.max(m * (1 - m), 1e-12));
    const info = crossprod(X, w);
    const r = symInverse(info);
    if (r.aliased.length) throw new AnalysisError(`The predictors are perfectly collinear (${r.aliased.map((j) => opts.colNames?.[j] ?? `column ${j}`).join(", ")}).`);
    inv = r.inv;
    const grad = crossvec(X, y.map((v, i) => v - mu[i]));
    let step = matvec(inv, grad);
    // Step halving keeps the likelihood increasing.
    let next = beta.map((b, j) => b + step[j]), llNext = loglik(next), halvings = 0;
    while (llNext < ll - 1e-10 && halvings < 30) { step = step.map((s) => s / 2); next = beta.map((b, j) => b + step[j]); llNext = loglik(next); halvings++; }
    const change = Math.max(...step.map(Math.abs));
    beta = next;
    const dll = llNext - ll;
    ll = llNext;
    if (change < 1e-9 || Math.abs(dll) < 1e-12) { converged = true; break; }
  }
  const mu = X.map((r) => 1 / (1 + Math.exp(-r.reduce((t, v, j) => t + v * beta[j], 0))));
  const info = crossprod(X, mu.map((m) => m * (1 - m)));
  inv = symInverse(info).inv;
  // Scale-free check: a coefficient whose effect over one SD of its column exceeds 15 on the log-odds scale (an odds ratio above 3 million)
  // only happens when the fit is running off to infinity, i.e. complete or quasi-complete separation.
  const sdCol = (j: number) => { const c = X.map((r) => r[j]); const m = c.reduce((s, v) => s + v, 0) / n; return Math.sqrt(c.reduce((s, v) => s + (v - m) ** 2, 0) / n); };
  const separated = mu.every((m, i) => (y[i] === 1 ? m > 1 - 1e-6 : m < 1e-6)) || beta.some((b, j) => j > 0 && Math.abs(b) * sdCol(j) > 15);
  if (separated) throw new AnalysisError("Complete or quasi-complete separation: a predictor (or combination) predicts the outcome perfectly, so the maximum-likelihood estimates do not exist. Check sparse categories, combine levels, or use a penalised (Firth) model.");
  if (!converged) throw new AnalysisError("The logistic model did not converge after 100 iterations.");
  const z = normPpf(1 - (1 - conf) / 2);
  const coefs: Coef[] = beta.map((b, j) => {
    const se = Math.sqrt(inv[j][j]);
    const zz = b / se;
    return { name: opts.colNames?.[j] ?? `x${j}`, b, se, stat: zz, p: Math.min(1, 2 * (1 - normCdf(Math.abs(zz)))), lo: b - z * se, hi: b + z * se };
  });
  const p0 = events / n;
  const ll0 = events * Math.log(p0) + (n - events) * Math.log(1 - p0);
  const lr = 2 * (ll - ll0);
  const mcfadden = 1 - ll / ll0;
  const coxSnell = 1 - Math.exp((2 * (ll0 - ll)) / n);
  const nagelkerke = coxSnell / (1 - Math.exp((2 * ll0) / n));
  return {
    n, p, events, coefs, beta, cov: inv, fitted: mu, logLik: ll, logLik0: ll0, lr, lrDf: p - 1, lrP: chi2Sf(lr, p - 1),
    aic: -2 * ll + 2 * p, bic: -2 * ll + Math.log(n) * p, mcfadden, coxSnell, nagelkerke, iterations: iter,
  };
}

/** Area under the ROC curve (Mann-Whitney form) with the DeLong standard error. */
export function rocAuc(score: number[], y: number[]) {
  const pos = score.filter((_, i) => y[i] === 1), neg = score.filter((_, i) => y[i] === 0);
  const m = pos.length, n = neg.length;
  if (!m || !n) throw new AnalysisError("ROC analysis needs both positive and negative cases.");
  const psi = (a: number, b: number) => (a > b ? 1 : a === b ? 0.5 : 0);
  const v10 = pos.map((a) => neg.reduce((s, b) => s + psi(a, b), 0) / n);
  const v01 = neg.map((b) => pos.reduce((s, a) => s + psi(a, b), 0) / m);
  const auc = v10.reduce((s, v) => s + v, 0) / m;
  const varOf = (v: number[]) => { const mm = v.reduce((s, x) => s + x, 0) / v.length; return v.reduce((s, x) => s + (x - mm) ** 2, 0) / (v.length - 1); };
  const se = Math.sqrt((m > 1 ? varOf(v10) / m : 0) + (n > 1 ? varOf(v01) / n : 0));
  // ROC curve points over distinct thresholds (descending).
  const th = [...new Set(score)].sort((a, b) => b - a);
  const pts: [number, number][] = [[0, 0]];
  for (const t of th) pts.push([neg.filter((s) => s >= t).length / n, pos.filter((s) => s >= t).length / m]);
  return { auc, se, m, n, points: pts, thresholds: th };
}

/** Hosmer-Lemeshow goodness-of-fit with g groups by deciles of risk (chi-square with g - 2 df). */
export function hosmerLemeshow(p: number[], y: number[], g = 10) {
  const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  const n = p.length;
  let chi = 0, groups = 0;
  const rows: { n: number; observed: number; expected: number }[] = [];
  for (let k = 0; k < g; k++) {
    const part = idx.slice(Math.floor((k * n) / g), Math.floor(((k + 1) * n) / g));
    if (!part.length) continue;
    const o = part.reduce((s, i) => s + y[i], 0), e = part.reduce((s, i) => s + p[i], 0), nk = part.length;
    rows.push({ n: nk, observed: o, expected: e });
    const pbar = e / nk;
    if (pbar > 0 && pbar < 1) chi += (o - e) ** 2 / (nk * pbar * (1 - pbar));
    groups++;
  }
  return { chi2: chi, df: groups - 2, p: groups > 2 ? chi2Sf(chi, groups - 2) : NaN, rows };
}

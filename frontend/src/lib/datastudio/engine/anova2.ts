// Factorial ANOVA and ANCOVA as linear models. Factors are effect-coded (sum-to-zero, as statsmodels C(x, Sum)) so that Type III sums
// of squares test meaningful hypotheses; Type II sums of squares do not depend on the coding. Each sum of squares is the increase in
// the residual sum of squares when the term's columns are removed from the relevant model, which equals statsmodels anova_lm.

import { fCdf } from "@/lib/stats/dist";
import { AnalysisError } from "./common";
import { aliasedColumns, qrLeastSquares, type Mat } from "./linalg";
import { buildDesign, type Design } from "./regression";
import type { Dataset } from "../types";

export type AnovaTerm = { label: string; vars: string[]; columns: number[] };
export type AnovaRow = { label: string; ss: number; df: number; ms: number; f: number; p: number; partialEta2: number };

function sseOf(X: Mat, y: number[], cols: number[]): number {
  const Z = X.map((r) => cols.map((j) => r[j]));
  const r = qrLeastSquares(Z, y);
  if (!r) throw new AnalysisError("A sub-model could not be fitted because its columns are collinear.");
  return y.reduce((s, v, i) => { const f = Z[i].reduce((t, z, j) => t + z * r.beta[j], 0); return s + (v - f) ** 2; }, 0);
}

function subsets<T>(a: T[], minSize: number): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << a.length; mask++) { const s = a.filter((_, i) => mask & (1 << i)); if (s.length >= minSize) out.push(s); }
  return out.sort((x, y) => x.length - y.length);
}

/** Appends product columns for an interaction of existing terms to X (in place) and returns the new term. */
function addInteraction(X: Mat, colNames: string[], parts: AnovaTerm[]): AnovaTerm {
  let combos: { cols: number[]; name: string[] }[] = [{ cols: [], name: [] }];
  for (const t of parts) combos = combos.flatMap((c) => t.columns.map((j) => ({ cols: [...c.cols, j], name: [...c.name, colNames[j]] })));
  const start = X[0].length;
  for (const r of X) for (const c of combos) r.push(c.cols.reduce((s, j) => s * r[j], 1));
  colNames.push(...combos.map((c) => c.name.join(" × ")));
  return { label: parts.map((t) => t.label).join(" × "), vars: parts.flatMap((t) => t.vars), columns: combos.map((_, k) => start + k) };
}

export function factorialAnova(d: Dataset, outcome: string, factors: string[], covariates: string[], opts: { interactions: boolean; ssType: 2 | 3; slopes?: boolean }) {
  if (!factors.length) throw new AnalysisError("Choose at least one factor.");
  if (factors.length > 4) throw new AnalysisError("At most four factors can be analysed together.");
  const overlap = factors.find((f) => covariates.includes(f));
  if (overlap) throw new AnalysisError(`"${overlap}" cannot be both a factor and a covariate.`);
  const des: Design = buildDesign(d, outcome, [...factors.map((name) => ({ name, categorical: true, coding: "sum" as const })), ...covariates.map((name) => ({ name, categorical: false }))]);
  const yj = d.variables.findIndex((v) => v.name === outcome);
  const y = des.rows.map((i) => d.columns[yj][i] as number);
  const X = des.X.map((r) => r.slice());
  const colNames = des.colNames.slice();
  const main: AnovaTerm[] = des.terms.slice(1).map((t) => ({ label: t.label, vars: [t.label], columns: t.columns }));
  const factorTerms = main.filter((t) => factors.includes(t.label));
  const terms: AnovaTerm[] = [...main];
  if (opts.interactions && factors.length > 1) for (const s of subsets(factorTerms, 2)) terms.push(addInteraction(X, colNames, s));
  const n = X.length, p = X[0].length;
  if (n <= p) throw new AnalysisError(`The model has ${p} coefficients but only ${n} complete observations. Use fewer factors or turn off interactions.`);
  const al = aliasedColumns(X);
  if (al.length) {
    const inInteraction = al.some((j) => terms.some((t) => t.vars.length > 1 && t.columns.includes(j)));
    throw new AnalysisError(inInteraction
      ? "Some combinations of factor levels have no observations (empty cells), so the interaction cannot be estimated. Turn off interactions, or combine levels."
      : `Perfect multicollinearity: ${al.map((j) => `"${colNames[j]}"`).join(", ")} is an exact linear combination of other terms.`);
  }
  const all = Array.from({ length: p }, (_, j) => j);
  const sseFull = sseOf(X, y, all);
  const dfE = n - p, mse = sseFull / dfE;
  if (!(mse > 0)) throw new AnalysisError("The model fits the data exactly (no residual variation), so F tests are undefined.");
  const contains = (big: AnovaTerm, small: AnovaTerm) => big !== small && small.vars.every((v) => big.vars.includes(v));
  const rows: AnovaRow[] = terms.map((t) => {
    let ss: number;
    if (opts.ssType === 3) ss = sseOf(X, y, all.filter((j) => !t.columns.includes(j))) - sseFull;
    else {
      const base = [0, ...terms.filter((u) => u !== t && !contains(u, t)).flatMap((u) => u.columns)];
      ss = sseOf(X, y, base) - sseOf(X, y, [...base, ...t.columns]);
    }
    ss = Math.max(0, ss);
    const df = t.columns.length, f = ss / df / mse;
    return { label: t.label, ss, df, ms: ss / df, f, p: 1 - fCdf(f, df, dfE), partialEta2: ss / (ss + sseFull) };
  });
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  const sst = y.reduce((s, v) => s + (v - ybar) ** 2, 0);
  const resid = (() => { const r = qrLeastSquares(X, y)!; return y.map((v, i) => v - X[i].reduce((s, x, j) => s + x * r.beta[j], 0)); })();
  // Homogeneity of regression slopes (ANCOVA): add factor x covariate products to the model and test each one.
  const slopes: { label: string; f: number; df1: number; df2: number; p: number }[] = [];
  if (opts.slopes !== false && covariates.length) {
    const Xs = X.map((r) => r.slice()), cn = colNames.slice();
    const covTerms = main.filter((t) => covariates.includes(t.label));
    const added = factorTerms.flatMap((ft) => covTerms.map((ct) => addInteraction(Xs, cn, [ft, ct])));
    const ps = Xs[0].length;
    if (n > ps && !aliasedColumns(Xs).length) {
      const allS = Array.from({ length: ps }, (_, j) => j);
      const sseS = sseOf(Xs, y, allS), dfS = n - ps;
      for (const t of added) {
        const ss = Math.max(0, sseOf(Xs, y, allS.filter((j) => !t.columns.includes(j))) - sseS);
        const f = ss / t.columns.length / (sseS / dfS);
        slopes.push({ label: t.label, f, df1: t.columns.length, df2: dfS, p: 1 - fCdf(f, t.columns.length, dfS) });
      }
    }
  }
  return { rows, error: { ss: sseFull, df: dfE, ms: mse }, total: { ss: sst, df: n - 1 }, r2: 1 - sseFull / sst, n, p, y, X, colNames, design: des, resid, slopes };
}

// Runners for Table 1, factorial ANOVA/ANCOVA, generalized linear models, multinomial and ordinal logistic regression, PCA, the
// bootstrap, permutation tests and rate standardisation. Same contract as run.ts: fill the context, return the title and methods text,
// throw AnalysisError instead of returning anything partial.

import { chi2Sf } from "@/lib/stats/dist";
import { fisherExact, twoSampleT } from "@/lib/stats/tests";
import { colIndex, isMissing, nRows } from "../types";
import { histogram } from "../profile";
import { AnalysisError, assertMinN, completeRows, excludedNote, fmt, fmtP, groupRows, levelLabel, levels, type TableCell } from "./common";
import { kruskalWallis, mannWhitney, welchAnova } from "./compare";
import { pearsonChi2 } from "./categorical";
import { summarize } from "./describe";
import { brownForsythe, qqPoints } from "./normality";
import { factorialAnova } from "./anova2";
import { fitGlm, type GlmFamily } from "./glm";
import { multinomialLogit, ordinalLogit } from "./multicat";
import { buildDesign, logistic, ols, waldF } from "./regression";
import { bootstrapCi, pca, permutationTest, type BootStat } from "./resample";
import { directStandardize, indirectStandardize, type Stratum } from "./standardize";
import { label, normalityAssumption, s, type Ctx, type Out } from "./kit";

const cl = (conf: number) => `${Math.round(conf * 100)}%`;
const predSpecs = (p: Ctx["p"]) => ((p.predictors as string[]) ?? []).map((name) => ({ name }));
function seedOf(v: unknown): number {
  const n = Math.round(Number(v ?? 20261124));
  if (!Number.isFinite(n) || n < 0 || n > 2147483647) throw new AnalysisError("The random seed must be a whole number between 0 and 2147483647.");
  return n;
}

// --- Table 1 ------------------------------------------------------------------------------------------------------------------------

function runTable1(c: Ctx): Out {
  const { d, p } = c;
  const names = p.variables as string[], by = p.by as string | undefined;
  const medianSet = new Set((p.medianVars as string[]) ?? []), catSet = new Set((p.asCategorical as string[]) ?? []);
  const dp = Math.round((p.decimals as number) ?? 1), wantP = !!p.pvalues && !!by;
  if (by && names.includes(by)) throw new AnalysisError(`"${by}" is the grouping variable, so it cannot also be a row of the table.`);
  const both = [...medianSet].find((n) => catSet.has(n));
  if (both) throw new AnalysisError(`"${both}" cannot be both summarised as a median and treated as categorical.`);
  const all = Array.from({ length: nRows(d) }, (_, i) => i);
  const rows = by ? completeRows(d, [by]) : all;
  if (!rows.length) throw new AnalysisError(by ? `No rows have a value for ${by}.` : "The dataset has no rows.");
  const gj = by ? colIndex(d, by) : -1;
  const groups = by ? groupRows(d, gj, rows) : [];
  if (by && groups.length < 2) throw new AnalysisError(`${by} has only one category, so there is nothing to compare.`);
  if (by && groups.length > 12) throw new AnalysisError(`${by} has ${groups.length} categories; a Table 1 is readable with at most 12 groups.`);
  const cols = [{ label: "Overall", rows }, ...groups.map((g) => ({ label: levelLabel(d.variables[gj], g.level), rows: g.rows }))];
  const f = (x: number) => (Number.isFinite(x) ? x.toFixed(dp) : "-");
  const body: TableCell[][] = [];
  const tail = (pv: number | null, test: string | null): TableCell[] => (wantP ? [pv, test] : []);
  const blank = cols.map(() => "");
  const testsUsed = new Set<string>();
  let smallExpected = false;
  for (const name of names) {
    const j = colIndex(d, name), v = d.variables[j];
    const present = (r: number[]) => r.filter((i) => !isMissing(v, d.columns[j][i]));
    const distinct = levels(d, j, present(rows));
    const isCat = catSet.has(name) || v.type !== "numeric" || (!medianSet.has(name) && (v.measure === "nominal" || v.measure === "ordinal" || distinct.length <= 2));
    const lab = v.label ? `${v.label} (${name})` : name;
    if (!isCat) {
      const useMedian = medianSet.has(name);
      const data = cols.map((col) => present(col.rows).map((i) => d.columns[j][i] as number));
      const cells = data.map((x) => { if (!x.length) return "-"; const sm = summarize(x); return useMedian ? `${f(sm.median)} [${f(sm.q1)}, ${f(sm.q3)}]` : `${f(sm.mean)} (${f(sm.sd)})`; });
      let pv: number | null = null, test: string | null = null;
      if (wantP) {
        const g = data.slice(1);
        if (useMedian) {
          test = g.length === 2 ? "Mann-Whitney U" : "Kruskal-Wallis";
          if (g.every((x) => x.length >= 1)) pv = g.length === 2 ? mannWhitney(g[0], g[1]).p : kruskalWallis(g).p;
        } else {
          test = g.length === 2 ? "Welch t-test" : "Welch ANOVA";
          if (g.every((x) => x.length >= 2)) pv = g.length === 2 ? twoSampleT(g[0], g[1], false).p : welchAnova(g).p;
        }
        testsUsed.add(test);
      }
      if (pv !== null) c.key[`p_${name}`] = pv;
      body.push([`${lab}, ${useMedian ? "median [Q1, Q3]" : "mean (SD)"}`, ...cells, ...tail(pv, test)]);
      c.key[`${name}_${useMedian ? "median" : "mean"}`] = useMedian ? summarize(data[0]).median : summarize(data[0]).mean;
    } else {
      if (distinct.length > 50) throw new AnalysisError(`"${name}" has ${distinct.length} distinct values, too many to tabulate. Summarise it as a mean or median, or group it into bands.`);
      let pv: number | null = null, test: string | null = null;
      const counts = cols.map((col) => { const pr = present(col.rows); return { valid: pr.length, n: distinct.map((l) => pr.filter((i) => String(d.columns[j][i]) === l).length) }; });
      if (wantP && distinct.length >= 2) {
        const t = counts.slice(1).map((x) => x.n).filter((r) => r.some((v2) => v2 > 0));
        if (t.length >= 2) {
          const chi = pearsonChi2(t);
          if (t.length === 2 && distinct.length === 2 && chi.minExpected < 5) { pv = fisherExact(t[0][0], t[0][1], t[1][0], t[1][1]).pTwoSided; test = "Fisher's exact"; }
          else { pv = chi.p; test = "Chi-square"; if (chi.cellsBelow5 / (t.length * distinct.length) > 0.2) smallExpected = true; }
          testsUsed.add(test);
        }
      }
      if (pv !== null) c.key[`p_${name}`] = pv;
      body.push([`${lab}, n (%)`, ...blank, ...tail(pv, test)]);
      distinct.forEach((l, k) => body.push([`   ${levelLabel(v, l)}`, ...counts.map((x) => (x.valid ? `${x.n[k]} (${f((100 * x.n[k]) / x.valid)}%)` : "-")), ...tail(null, null)]));
    }
    const miss = cols.map((col) => col.rows.length - present(col.rows).length);
    if (miss[0] > 0) body.push(["   Missing, n", ...miss.map(String), ...tail(null, null)]);
  }
  const notes = ["Continuous variables: mean (SD) or median [Q1, Q3] as chosen for each variable. Categorical variables: n (%); percentages exclude missing values, which are counted separately."];
  if (wantP) notes.push(`p-values: ${[...testsUsed].join(", ")} as shown for each row. They are descriptive and unadjusted for multiple testing; in a randomised trial, baseline p-values are not recommended (CONSORT).`);
  c.tables.push({ title: by ? `Characteristics by ${label(d, by)}` : "Characteristics of the sample", columns: ["Characteristic", ...cols.map((col) => `${col.label} (N = ${col.rows.length})`), ...(wantP ? ["p", "Test"] : [])], rows: body, kinds: ["text", ...cols.map(() => "text" as const), ...(wantP ? (["p", "text"] as const) : [])], notes });
  if (smallExpected) c.warnings.push({ level: "warning", text: "Some chi-square tests have more than 20% of expected counts below 5, so their p-values may be inaccurate. Combine sparse categories." });
  if (by) c.warnings.push(...excludedNote(nRows(d), rows.length, [by]));
  c.assumptions.push({ name: "Summary choice", detail: "Mean (SD) suits roughly symmetric variables; use median [Q1, Q3] for skewed ones (check with the normality check).", status: "check" });
  if (wantP) c.assumptions.push({ name: "Independence", detail: "The tests assume each subject is counted once and groups are independent.", status: "check" });
  c.key.n = rows.length;
  groups.forEach((g, k) => { c.key[`n_${cols[k + 1].label}`] = g.rows.length; });
  return { title: by ? `Table 1 by ${by}` : "Table 1", methodsText: `Characteristics are summarised as mean (standard deviation) or median [interquartile range] for continuous variables and as counts and percentages for categorical variables${by ? `, overall and by ${by}` : ""}; missing values are reported separately.${wantP ? ` Groups were compared with ${[...testsUsed].join(", ")} tests as appropriate for each variable (Fisher's exact test for 2x2 tables with expected counts below 5).` : ""}`, used: rows.length, total: nRows(d) };
}

// --- Factorial ANOVA and ANCOVA -----------------------------------------------------------------------------------------------------

function runFactorial(c: Ctx): Out {
  const { d, p } = c;
  const y = s(p.outcome), factors = p.factors as string[], covs = (p.covariates as string[]) ?? [];
  if (factors.includes(y) || covs.includes(y)) throw new AnalysisError("The outcome cannot also be a factor or covariate.");
  const ssType = p.ssType === "2" ? 2 : 3;
  const a = factorialAnova(d, y, factors, covs, { interactions: p.interactions !== false, ssType });
  const rowsOut: TableCell[][] = a.rows.map((r) => [r.label, r.ss, r.df, r.ms, r.f, r.p, r.partialEta2]);
  rowsOut.push(["Residual", a.error.ss, a.error.df, a.error.ms, null, null, null], ["Total (corrected)", a.total.ss, a.total.df, null, null, null, null]);
  c.tables.push({ title: `${covs.length ? "ANCOVA" : "Factorial ANOVA"} (Type ${ssType === 3 ? "III" : "II"} sums of squares)`, columns: ["Source", "Sum of squares", "df", "Mean square", "F", "p", "Partial eta-squared"], rows: rowsOut, kinds: ["text", "num", "int", "num", "num", "p", "num"],
    notes: [ssType === 3 ? "Type III: each term is tested after every other term, including interactions that contain it. Factors use effect (sum-to-zero) coding, which Type III requires." : "Type II: each term is tested after all other terms that do not contain it (main effects are tested ignoring their interactions). Preferred when interactions are absent.", `R-squared = ${fmt(a.r2, 3)}. Partial eta-squared = SS(effect) / (SS(effect) + SS(residual)).`] });
  // Cell statistics
  const fj = factors.map((f) => colIndex(d, f)), yj = colIndex(d, y);
  const cells = new Map<string, { labels: string[]; x: number[] }>();
  for (const i of a.design.rows) {
    const key = fj.map((j) => String(d.columns[j][i])).join("\u0001");
    if (!cells.has(key)) cells.set(key, { labels: fj.map((j, k) => levelLabel(d.variables[j], String(d.columns[j][i])) || factors[k]), x: [] });
    cells.get(key)!.x.push(d.columns[yj][i] as number);
  }
  const cellList = [...cells.values()].sort((u, v) => u.labels.join().localeCompare(v.labels.join(), undefined, { numeric: true }));
  c.tables.push({ title: "Cell statistics (observed)", columns: [...factors, "N", "Mean", "SD"], rows: cellList.map((cc) => { const sm = summarize(cc.x); return [...cc.labels, sm.n, sm.mean, sm.sd]; }), kinds: [...factors.map(() => "text" as const), "int", "num", "num"] });
  if (covs.length) {
    const fit = buildDesign(d, y, [...factors.map((name) => ({ name, categorical: true, coding: "sum" as const })), ...covs.map((name) => ({ name, categorical: false }))]);
    const idx = covs.map((cv) => fit.colNames.indexOf(cv));
    const m = (() => { const yy = fit.rows.map((i) => d.columns[yj][i] as number); return ols(fit.X, yy, { conf: c.conf, colNames: fit.colNames }); })();
    c.tables.push({ title: "Covariate slopes", columns: ["Covariate", "B", "SE", `${cl(c.conf)} CI lower`, `${cl(c.conf)} CI upper`, "t", "p"], rows: idx.map((j, k) => { const cf = m.coefs[j]; return [covs[k], cf.b, cf.se, cf.lo, cf.hi, cf.stat, cf.p]; }), kinds: ["text", "num", "num", "num", "num", "num", "p"], notes: ["Common slope within all cells (main-effects covariate model)."] });
    if (a.slopes.length) {
      const bad = a.slopes.filter((x) => x.p < 0.05);
      c.tables.push({ title: "Homogeneity of regression slopes", columns: ["Factor × covariate", "F", "df1", "df2", "p"], rows: a.slopes.map((x) => [x.label, x.f, x.df1, x.df2, x.p]), kinds: ["text", "num", "int", "int", "p"], notes: ["Each interaction is tested in a model that adds every factor × covariate product to the ANCOVA model."] });
      c.assumptions.push({ name: "Homogeneity of regression slopes", detail: bad.length ? `The covariate slope differs across levels of ${bad.map((x) => x.label).join(", ")} (p < 0.05). ANCOVA adjusted means are then misleading; report the interaction model instead.` : "No evidence that the covariate slopes differ between groups (all p ≥ 0.05).", status: bad.length ? "violated" : "met" });
    } else c.assumptions.push({ name: "Homogeneity of regression slopes", detail: "Could not be tested: too few observations for the model with factor × covariate interactions.", status: "check" });
    c.assumptions.push({ name: "Linearity of the covariate", detail: "The outcome should change linearly with each covariate within each group; check scatter plots.", status: "check" });
  }
  const cellKeys = a.design.rows.map((i) => fj.map((j) => String(d.columns[j][i])).join("\u0001"));
  const byCell = new Map<string, number[]>();
  a.resid.forEach((r, k) => { const key = cellKeys[k]; if (!byCell.has(key)) byCell.set(key, []); byCell.get(key)!.push(r); });
  const resGroups = [...byCell.values()].filter((g) => g.length >= 2);
  if (resGroups.length >= 2) {
    const lev = brownForsythe(resGroups);
    c.assumptions.push({ name: "Equal variances across cells", detail: `Levene's test (median) on residuals: F(${lev.df1}, ${lev.df2}) = ${fmt(lev.f)}, p = ${fmtP(lev.p)}.${lev.p < 0.05 ? " Variances differ; F tests can be misleading, especially with unequal cell sizes." : ""}`, status: lev.p < 0.05 ? "violated" : "met" });
  }
  c.assumptions.push(normalityAssumption("residuals", a.resid), { name: "Independence", detail: "Each subject contributes one observation. Repeated measures need a repeated-measures or mixed model.", status: "check" });
  const sizes = [...byCell.values()].map((g) => g.length);
  if (Math.min(...sizes) * 2 < Math.max(...sizes)) c.warnings.push({ level: "note", text: `Cell sizes are unbalanced (${Math.min(...sizes)} to ${Math.max(...sizes)}), so Type II and Type III results can differ. ${ssType === 3 ? "Type III" : "Type II"} was used as chosen.` });
  c.charts.push({ kind: "means", title: `Mean of ${y} by cell (${cl(c.conf)} CI)`, groups: cellList.slice(0, 40).map((cc) => { const sm = summarize(cc.x, c.conf); return { label: cc.labels.join(" / "), mean: sm.mean, lo: sm.ciLower, hi: sm.ciUpper, n: sm.n }; }), yLabel: y });
  c.charts.push({ kind: "qq", title: "Normal Q-Q plot of residuals", points: qqPoints(a.resid) });
  a.rows.forEach((r) => { c.key[`f_${r.label}`] = r.f; c.key[`p_${r.label}`] = r.p; c.key[`partial_eta2_${r.label}`] = r.partialEta2; });
  Object.assign(c.key, { n: a.n, r2: a.r2, ss_type: ssType === 3 ? "III" : "II" });
  c.warnings.push(...excludedNote(nRows(d), a.n, [y, ...factors, ...covs]));
  return { title: `${covs.length ? "ANCOVA" : "Factorial ANOVA"}: ${y} by ${factors.join(", ")}`, methodsText: `${y} was analysed with ${covs.length ? `analysis of covariance (factors ${factors.join(", ")}; covariates ${covs.join(", ")})` : `a ${factors.length}-way factorial ANOVA (${factors.join(", ")})`}${p.interactions !== false && factors.length > 1 ? " including all interactions between factors" : ""}, fitted as a linear model with effect-coded factors. Type ${ssType === 3 ? "III" : "II"} sums of squares were used; effect sizes are partial eta-squared.${covs.length ? " The homogeneity of regression slopes was checked by testing factor × covariate interactions." : ""} Residual normality and equality of variances across cells (Levene's test) were checked. Complete-case analysis was used.`, used: a.n, total: nRows(d) };
}

// --- Generalized linear models ------------------------------------------------------------------------------------------------------

const FAMILY_LABEL: Record<GlmFamily, string> = { poisson: "Poisson", negbin: "negative binomial (NB2)", gamma: "gamma" };

function runGlm(c: Ctx): Out {
  const { d, p, conf } = c;
  const y = s(p.outcome), fam = p.family as GlmFamily, exposure = p.exposure as string | undefined;
  if (exposure && (exposure === y || (p.predictors as string[]).includes(exposure))) throw new AnalysisError("The exposure (offset) variable cannot also be the outcome or a predictor.");
  const des = buildDesign(d, y, predSpecs(p), (p.interactions as [string, string][]) ?? [], [], exposure ? [exposure] : []);
  const yj = colIndex(d, y);
  const yv = des.rows.map((i) => d.columns[yj][i] as number);
  let off: number[] | undefined;
  if (exposure) {
    const ej = colIndex(d, exposure);
    off = des.rows.map((i) => { const e = d.columns[ej][i] as number; if (!(e > 0)) throw new AnalysisError(`${exposure} must be positive on every row (it is the exposure time or population at risk).`); return Math.log(e); });
  }
  const m = fitGlm(des.X, yv, { family: fam, offset: off, conf, robust: !!p.robust, colNames: des.colNames });
  const ratio = fam === "gamma" ? "Ratio of means" : exposure ? "Incidence rate ratio" : "Rate ratio";
  c.tables.push({ title: `Coefficients${p.robust ? " (robust sandwich standard errors)" : ""}`, columns: ["Term", "B", "SE", "z", "p", ratio, `${cl(conf)} CI lower`, `${cl(conf)} CI upper`],
    rows: m.coefs.map((cf, j) => [cf.name, cf.b, cf.se, cf.stat, cf.p, j === 0 ? null : Math.exp(cf.b), j === 0 ? null : Math.exp(cf.lo), j === 0 ? null : Math.exp(cf.hi)]), kinds: ["text", "num", "num", "num", "p", "num", "num", "num"],
    notes: [`Log link. ${ratio}s are exp(B): the multiplicative change in the expected ${fam === "gamma" ? "value" : "count or rate"} for a one-unit increase (or versus the reference category), adjusted for the other terms.`, ...(exposure ? [`log(${exposure}) is an offset, so the model describes rates per unit of ${exposure}. exp(intercept) = ${fmt(Math.exp(m.beta[0]), 4)} is the rate at the reference values.`] : []), ...(p.robust ? ["Robust (HC0 sandwich) standard errors remain valid when the variance function is misspecified."] : []), ...des.references.map((r) => `${r.variable}: reference category is "${r.reference}".`)] });
  let lr: { chi2: number; df: number; p: number } | null = null;
  if (fam !== "gamma" && m.p > 1) {
    try { const m0 = fitGlm(des.X.map(() => [1]), yv, { family: fam, offset: off }); const chi = 2 * (m.logLik - m0.logLik); lr = { chi2: chi, df: m.p - 1, p: chi2Sf(chi, m.p - 1) }; } catch { lr = null; }
  }
  const disp = m.pearsonChi2 / m.dfResid;
  c.tables.push({ title: "Model fit", columns: ["N", "Log-likelihood", "Deviance", "Residual df", "Pearson chi-square / df", "AIC", "BIC", ...(lr ? ["LR chi-square", "df", "p"] : []), ...(fam === "negbin" ? ["Alpha (dispersion)", "Alpha SE"] : []), ...(fam === "gamma" ? ["Scale (dispersion)"] : [])],
    rows: [[m.n, m.logLik, m.deviance, m.dfResid, disp, m.aic, m.bic, ...(lr ? [lr.chi2, lr.df, lr.p] : []), ...(fam === "negbin" ? [m.alpha!, m.alphaSe!] : []), ...(fam === "gamma" ? [m.scale] : [])]],
    kinds: ["int", "num", "num", "int", "num", "num", "num", ...(lr ? (["num", "int", "p"] as const) : []), ...(fam === "negbin" ? (["num", "num"] as const) : []), ...(fam === "gamma" ? (["num"] as const) : [])],
    notes: [fam === "negbin" ? "NB2: variance = mu + alpha mu^2, alpha estimated by maximum likelihood. AIC counts alpha as a parameter." : fam === "gamma" ? "Gamma: variance = scale × mu^2; the scale is estimated from the Pearson chi-square, as statsmodels does." : "Poisson: variance = mean.", "The likelihood-ratio test compares the model with an intercept-only model."] });
  if (fam === "poisson") {
    const zerosObs = yv.filter((v) => v === 0).length, zerosExp = m.mu.reduce((s2, mu) => s2 + Math.exp(-mu), 0);
    c.assumptions.push({ name: "Overdispersion", detail: `Pearson chi-square / df = ${fmt(disp, 2)}.${disp > 1.5 ? " The variance exceeds the mean, so Poisson standard errors are too small: use the negative binomial model or robust standard errors." : " Close to 1, as the Poisson model assumes."}`, status: disp > 1.5 ? (p.robust ? "info" : "violated") : "met" });
    c.assumptions.push({ name: "Excess zeros", detail: `${zerosObs} zero counts observed; the model expects ${fmt(zerosExp, 1)}.${zerosObs > 1.5 * zerosExp + 3 ? " Many more zeros than expected: consider a negative binomial or zero-inflated model." : ""}`, status: zerosObs > 1.5 * zerosExp + 3 ? "violated" : "met" });
    Object.assign(c.key, { dispersion: disp });
  } else if (fam === "negbin") {
    let pois: number | null = null;
    try { pois = fitGlm(des.X, yv, { family: "poisson", offset: off }).logLik; } catch { pois = null; }
    if (pois !== null) {
      const lrA = Math.max(0, 2 * (m.logLik - pois)), pA = 0.5 * chi2Sf(lrA, 1);
      c.assumptions.push({ name: "Overdispersion (negative binomial vs Poisson)", detail: `Likelihood-ratio test of alpha = 0: chi-square = ${fmt(lrA)}, p = ${fmtP(pA)} (half the chi-square(1) tail, because alpha = 0 is on the boundary). ${pA < 0.05 ? "The counts are overdispersed, supporting the negative binomial model." : "No clear overdispersion; the Poisson model may be adequate."}`, status: pA < 0.05 ? "met" : "info" });
      Object.assign(c.key, { alpha: m.alpha!, lr_alpha_p: pA });
    }
  } else c.assumptions.push({ name: "Variance proportional to the mean squared", detail: `Estimated scale ${fmt(m.scale, 4)} (coefficient of variation about ${fmt(Math.sqrt(m.scale), 3)}). Check that residual spread grows with the fitted value.`, status: "check" });
  c.assumptions.push({ name: "Log-linearity", detail: "The log of the expected outcome changes linearly with each continuous predictor; consider categories or splines if not.", status: "check" }, { name: "Independence", detail: "Each row is an independent unit. Clustered or repeated counts need GEE or a mixed model.", status: "check" });
  const epv = m.n / Math.max(1, m.p - 1);
  if (epv < 10) c.warnings.push({ level: "warning", text: `Only ${fmt(epv, 1)} observations per coefficient; estimates may be unstable.` });
  const pres = m.mu.map((mu, i) => (yv[i] - mu) / Math.sqrt(fam === "poisson" ? mu : fam === "gamma" ? m.scale * mu * mu : mu + m.alpha! * mu * mu));
  c.charts.push({ kind: "scatter", title: "Pearson residuals against fitted values", xLabel: "Fitted value", yLabel: "Pearson residual", points: m.mu.slice(0, 5000).map((mu, i) => [mu, pres[i]]), refY: 0 });
  c.charts.push({ kind: "forest", title: `${ratio}s`, rows: m.coefs.slice(1).map((cf) => ({ label: cf.name, est: Math.exp(cf.b), lo: Math.exp(cf.lo), hi: Math.exp(cf.hi) })), ref: 1, log: true, xLabel: `${ratio} (${cl(conf)} CI, log scale)` });
  m.coefs.slice(1).forEach((cf) => { c.key[`ratio_${cf.name}`] = Math.exp(cf.b); c.key[`p_${cf.name}`] = cf.p; c.key[`lo_${cf.name}`] = Math.exp(cf.lo); c.key[`hi_${cf.name}`] = Math.exp(cf.hi); });
  Object.assign(c.key, { n: m.n, aic: m.aic, deviance: m.deviance, family: fam });
  c.warnings.push(...excludedNote(nRows(d), m.n, [y, ...(p.predictors as string[]), ...(exposure ? [exposure] : [])]));
  return { title: `${fam === "poisson" ? "Poisson" : fam === "negbin" ? "Negative binomial" : "Gamma"} regression: ${y}`, methodsText: `${y} was modelled with ${FAMILY_LABEL[fam]} regression with a log link (maximum likelihood${fam === "negbin" ? ", dispersion parameter estimated" : ""}) on ${(p.predictors as string[]).join(", ")}${exposure ? `, with log(${exposure}) as an offset` : ""}. Results are reported as ${ratio.toLowerCase()}s with Wald ${cl(conf)} confidence intervals${p.robust ? " based on robust (sandwich) standard errors" : ""}. ${fam === "poisson" ? "Overdispersion was assessed with the Pearson chi-square / df ratio." : fam === "negbin" ? "Overdispersion relative to the Poisson model was assessed with a likelihood-ratio test." : ""} Complete-case analysis was used.`, used: m.n, total: nRows(d) };
}

// --- Multinomial and ordinal logistic regression ------------------------------------------------------------------------------------

function runMultinomial(c: Ctx): Out {
  const { d, p, conf } = c;
  const y = s(p.outcome);
  const des = buildDesign(d, y, predSpecs(p));
  const yj = colIndex(d, y), yv = d.variables[yj];
  const lv = levels(d, yj, des.rows);
  if (lv.length < 3) throw new AnalysisError(`${y} has ${lv.length} categories among the complete cases; multinomial regression needs at least three (use binary logistic regression for two).`);
  if (lv.length > 20) throw new AnalysisError(`${y} has ${lv.length} categories; at most 20 can be modelled.`);
  const ref = (p.reference as string) ?? lv[0];
  const order = [ref, ...lv.filter((l) => l !== ref)];
  const yi = des.rows.map((i) => order.indexOf(String(d.columns[yj][i])));
  const m = multinomialLogit(des.X, yi, order.length, { conf, colNames: des.colNames });
  const rows: TableCell[][] = [];
  m.coefs.forEach((cfs, k) => cfs.forEach((cf, j) => rows.push([levelLabel(yv, order[k + 1]), cf.name, cf.b, cf.se, cf.stat, cf.p, j === 0 ? null : Math.exp(cf.b), j === 0 ? null : Math.exp(cf.lo), j === 0 ? null : Math.exp(cf.hi)])));
  c.tables.push({ title: "Coefficients and relative risk ratios", columns: ["Outcome category", "Term", "B", "SE", "z", "p", "Relative risk ratio", `${cl(conf)} CI lower`, `${cl(conf)} CI upper`], rows, kinds: ["text", "text", "num", "num", "num", "p", "num", "num", "num"],
    notes: [`Each block compares that category of ${y} with the reference category "${levelLabel(yv, ref)}". The relative risk ratio exp(B) is the multiplicative change in P(category) / P(reference) per unit of the term.`, ...des.references.map((r) => `${r.variable}: reference category is "${r.reference}".`)] });
  const p0 = des.X[0].length, K1 = order.length - 1;
  const termRows = des.terms.slice(1).map((t) => {
    const cols = Array.from({ length: K1 }, (_, k) => t.columns.map((j) => k * p0 + j)).flat();
    const w = waldF(m.beta, m.cov, cols, 1);
    const chi = w.f * w.df1;
    return [t.label, chi, w.df1, chi2Sf(chi, w.df1)] as TableCell[];
  });
  c.tables.push({ title: "Wald tests of each term (all categories jointly)", columns: ["Term", "Chi-square", "df", "p"], rows: termRows, kinds: ["text", "num", "int", "p"] });
  c.tables.push({ title: "Model fit", columns: ["N", "Categories", "Log-likelihood", "Null log-likelihood", "LR chi-square", "df", "p", "McFadden R²", "AIC", "BIC"], rows: [[m.n, m.K, m.logLik, m.logLik0, m.lr, m.lrDf, m.lrP, m.mcfadden, m.aic, m.bic]], kinds: ["int", "int", "num", "num", "num", "int", "p", "num", "num", "num"] });
  const counts = order.map((l) => yi.filter((v) => v === order.indexOf(l)).length);
  const epv = Math.min(...counts) / (p0 - 1 || 1);
  c.assumptions.push({ name: "Observations per category", detail: `Smallest category has ${Math.min(...counts)} observations (${fmt(epv, 1)} per predictor column).${epv < 10 ? " Fewer than 10: estimates for that category are unstable; combine categories or reduce predictors." : ""}`, status: epv < 10 ? "violated" : "met" });
  c.assumptions.push({ name: "Independence of irrelevant alternatives", detail: "The odds between two categories do not depend on the other categories being available. It cannot be fully tested here; consider whether categories are close substitutes.", status: "check" });
  c.assumptions.push({ name: "Linearity in the log-odds", detail: "Each continuous predictor should relate linearly to each log-odds.", status: "check" });
  m.coefs.forEach((cfs, k) => cfs.slice(1).forEach((cf) => { c.key[`rrr_${order[k + 1]}_${cf.name}`] = Math.exp(cf.b); c.key[`p_${order[k + 1]}_${cf.name}`] = cf.p; }));
  Object.assign(c.key, { n: m.n, lr_chi2: m.lr, lr_p: m.lrP, mcfadden_r2: m.mcfadden, reference: levelLabel(yv, ref) });
  c.warnings.push(...excludedNote(nRows(d), m.n, [y, ...(p.predictors as string[])]));
  return { title: `Multinomial logistic regression: ${y}`, methodsText: `The ${order.length} categories of ${y} were modelled with multinomial logistic regression (maximum likelihood) on ${(p.predictors as string[]).join(", ")}, with "${levelLabel(yv, ref)}" as the reference category. Results are relative risk ratios with Wald ${cl(conf)} confidence intervals; overall fit was assessed with the likelihood-ratio test. Complete-case analysis was used.`, used: m.n, total: nRows(d) };
}

function runOrdinal(c: Ctx): Out {
  const { d, p, conf } = c;
  const y = s(p.outcome);
  const des = buildDesign(d, y, predSpecs(p));
  const yj = colIndex(d, y), yv = d.variables[yj];
  const lv = levels(d, yj, des.rows);
  if (lv.length < 3) throw new AnalysisError(`${y} has ${lv.length} categories among the complete cases; an ordinal model needs at least three (use binary logistic regression for two).`);
  if (lv.length > 20) throw new AnalysisError(`${y} has ${lv.length} categories; for that many ordered values a linear model is usually more suitable.`);
  const yi = des.rows.map((i) => lv.indexOf(String(d.columns[yj][i])));
  const X = des.X.map((r) => r.slice(1)), names = des.colNames.slice(1);
  const m = ordinalLogit(X, yi, lv.length, { conf, colNames: names });
  c.tables.push({ title: "Coefficients and cumulative odds ratios", columns: ["Term", "B", "SE", "z", "p", "Odds ratio", `${cl(conf)} CI lower`, `${cl(conf)} CI upper`], rows: m.coefs.map((cf) => [cf.name, cf.b, cf.se, cf.stat, cf.p, Math.exp(cf.b), Math.exp(cf.lo), Math.exp(cf.hi)]), kinds: ["text", "num", "num", "num", "p", "num", "num", "num"],
    notes: [`The odds ratio is the multiplicative change in the odds of being in a higher category of ${y} (at any cut point) per unit of the term; above 1 means higher categories are more likely.`, ...des.references.map((r) => `${r.variable}: reference category is "${r.reference}".`)] });
  c.tables.push({ title: "Thresholds (cut points on the log-odds scale)", columns: ["Cut point", "Estimate", "SE"], rows: m.thresholds.map((t, k) => [`${levelLabel(yv, lv[k])} | ${levelLabel(yv, lv[k + 1])}`, t.b, t.se]), kinds: ["text", "num", "num"] });
  c.tables.push({ title: "Model fit", columns: ["N", "Categories", "Log-likelihood", "Null log-likelihood", "LR chi-square", "df", "p", "McFadden R²", "AIC", "BIC"], rows: [[m.n, m.K, m.logLik, m.logLik0, m.lr, m.lrDf, m.lrP, m.mcfadden, m.aic, m.bic]], kinds: ["int", "int", "num", "num", "num", "int", "p", "num", "num", "num"] });
  // Informal proportional-odds check: separate binary logits at each cut point should give similar slopes.
  const split: TableCell[][] = names.map((n, j) => [n, m.coefs[j].b]);
  const flags = new Set<string>();
  const used: string[] = [];
  for (let k = 0; k < lv.length - 1; k++) {
    const yb = yi.map((v) => (v > k ? 1 : 0));
    try {
      const b = logistic(des.X, yb, { conf });
      used.push(`> ${levelLabel(yv, lv[k])}`);
      names.forEach((n, j) => { const cf = b.coefs[j + 1]; split[j].push(cf.b); if (Math.abs(cf.b - m.coefs[j].b) > 1.96 * Math.hypot(cf.se, m.coefs[j].se)) flags.add(n); });
    } catch { names.forEach((_, j) => split[j].push(null)); used.push(`> ${levelLabel(yv, lv[k])} (not estimable)`); }
  }
  c.tables.push({ title: "Proportional-odds check: separate binary logits", columns: ["Term", "Ordinal model B", ...used.map((u) => `B for ${y} ${u}`)], rows: split, kinds: ["text", "num", ...used.map(() => "num" as const)], notes: ["Under proportional odds, each column estimates the same slope. Large, systematic differences suggest the assumption fails. This is an informal check; a formal Brant test is not computed."] });
  c.assumptions.push({ name: "Proportional odds", detail: flags.size ? `Slopes for ${[...flags].join(", ")} differ notably between cut points (more than 1.96 combined SEs from the ordinal estimate). Consider a partial proportional-odds or multinomial model.` : "Slopes from separate binary logits are compatible with a common slope (informal check).", status: flags.size ? "violated" : "met" });
  if (yv.type !== "numeric") c.warnings.push({ level: "note", text: `${y} is text, so its categories were ordered alphabetically (${lv.join(" < ")}). If that is not the real order, recode it to numbers first.` });
  const counts = lv.map((_, k) => yi.filter((v) => v === k).length);
  if (Math.min(...counts) < 5) c.warnings.push({ level: "warning", text: `A category of ${y} has fewer than 5 observations; consider combining adjacent categories.` });
  c.assumptions.push({ name: "Independence", detail: "Each row is a different subject.", status: "check" });
  m.coefs.forEach((cf) => { c.key[`or_${cf.name}`] = Math.exp(cf.b); c.key[`p_${cf.name}`] = cf.p; });
  Object.assign(c.key, { n: m.n, lr_chi2: m.lr, lr_p: m.lrP, mcfadden_r2: m.mcfadden });
  c.charts.push({ kind: "forest", title: "Cumulative odds ratios", rows: m.coefs.map((cf) => ({ label: cf.name, est: Math.exp(cf.b), lo: Math.exp(cf.lo), hi: Math.exp(cf.hi) })), ref: 1, log: true, xLabel: `Odds ratio (${cl(conf)} CI, log scale)` });
  c.warnings.push(...excludedNote(nRows(d), m.n, [y, ...(p.predictors as string[])]));
  return { title: `Ordinal logistic regression: ${y}`, methodsText: `The ordered categories of ${y} (${lv.map((l) => levelLabel(yv, l)).join(" < ")}) were modelled with a proportional-odds cumulative logit model (maximum likelihood) on ${(p.predictors as string[]).join(", ")}. Results are cumulative odds ratios with Wald ${cl(conf)} confidence intervals. The proportional-odds assumption was examined informally by comparing slopes from separate binary logistic regressions at each cut point. Complete-case analysis was used.`, used: m.n, total: nRows(d) };
}

// --- PCA ----------------------------------------------------------------------------------------------------------------------------

function runPca(c: Ctx): Out {
  const { d, p } = c;
  const names = p.variables as string[];
  const rows = completeRows(d, names);
  assertMinN(rows.length, names.length + 1, "PCA");
  const data = rows.map((i) => names.map((n) => d.columns[colIndex(d, n)][i] as number));
  let r: ReturnType<typeof pca>;
  try { r = pca(data); } catch (e) { const msg = (e as Error).message.replace(/Variable (\d+)/, (_, k) => `"${names[Number(k) - 1]}"`); throw new AnalysisError(msg); }
  const kaiser = r.eigenvalues.filter((v) => v > 1).length;
  const show = Math.min(names.length, Math.max(1, Math.round((p.components as number) ?? Math.max(2, kaiser))));
  let cum = 0;
  c.tables.push({ title: "Eigenvalues and explained variance", columns: ["Component", "Eigenvalue", "% of variance", "Cumulative %"], rows: r.eigenvalues.map((ev, k) => { cum += r.explained[k]; return [`PC${k + 1}`, ev, 100 * r.explained[k], 100 * cum]; }), kinds: ["text", "num", "pct", "pct"], notes: [`${kaiser} component(s) have an eigenvalue above 1 (Kaiser criterion). Use the scree plot and interpretability as well; the Kaiser rule alone often keeps too many.`] });
  c.tables.push({ title: `Component loadings (first ${show})`, columns: ["Variable", ...Array.from({ length: show }, (_, k) => `PC${k + 1}`), "Communality"], rows: names.map((n, j) => [n, ...r.loadings[j].slice(0, show), r.loadings[j].slice(0, show).reduce((s2, v) => s2 + v * v, 0)]), kinds: ["text", ...Array.from({ length: show }, () => "num" as const), "num"], notes: ["Loadings are correlations between each standardized variable and each component (eigenvector × √eigenvalue); the sign of each component is set so its largest loading is positive. Components are not rotated."] });
  c.assumptions.push({ name: "Bartlett's test of sphericity", detail: `Chi-square = ${fmt(r.bartlett)}, df = ${r.bartlettDf}, p = ${fmtP(r.bartlettP)}.${r.bartlettP >= 0.05 ? " The variables are barely correlated, so PCA will not summarise them usefully." : ""}`, status: r.bartlettP < 0.05 ? "met" : "violated" });
  c.assumptions.push({ name: "Sampling adequacy (KMO)", detail: Number.isFinite(r.kmo) ? `Kaiser-Meyer-Olkin = ${fmt(r.kmo, 3)} (0.6 or more is usually considered adequate).` : "Not computable because the correlation matrix is singular.", status: Number.isFinite(r.kmo) ? (r.kmo >= 0.6 ? "met" : "violated") : "check" });
  c.assumptions.push({ name: "Sample size", detail: `${rows.length} observations for ${names.length} variables (${fmt(rows.length / names.length, 1)} per variable). At least 5 to 10 per variable is a common guide.`, status: rows.length / names.length >= 5 ? "met" : "check" });
  if (r.singular) c.warnings.push({ level: "warning", text: "The correlation matrix is singular: at least one variable is an exact linear combination of others. The last eigenvalue is zero." });
  c.charts.push({ kind: "bar", title: "Scree plot (eigenvalues; Kaiser criterion = 1)", categories: r.eigenvalues.map((_, k) => `PC${k + 1}`), series: [{ name: "Eigenvalue", values: r.eigenvalues }], yLabel: "Eigenvalue" });
  c.charts.push({ kind: "heatmap", title: "Correlation matrix", labels: names, values: r.R });
  r.eigenvalues.slice(0, show).forEach((ev, k) => { c.key[`eigenvalue_pc${k + 1}`] = ev; c.key[`explained_pc${k + 1}`] = r.explained[k]; });
  Object.assign(c.key, { n: rows.length, kaiser_components: kaiser, kmo: r.kmo, bartlett_p: r.bartlettP });
  c.warnings.push(...excludedNote(nRows(d), rows.length, names));
  return { title: `Principal component analysis: ${names.length} variables`, methodsText: `Principal component analysis was performed on the correlation matrix of ${names.join(", ")} (variables standardized to mean 0 and SD 1). Components were retained by inspection of the scree plot and the Kaiser criterion (eigenvalue > 1); loadings are unrotated. Suitability was checked with Bartlett's test of sphericity and the Kaiser-Meyer-Olkin measure. Complete-case analysis was used.`, used: rows.length, total: nRows(d) };
}

// --- Bootstrap and permutation ------------------------------------------------------------------------------------------------------

function runBootstrap(c: Ctx): Out {
  const { d, p, conf } = c;
  const name = s(p.variable);
  const rows = completeRows(d, [name]);
  assertMinN(rows.length, 3, "The bootstrap");
  const x = rows.map((i) => d.columns[colIndex(d, name)][i] as number);
  const B = Math.round((p.replicates as number) ?? 2000), seed = seedOf(p.seed);
  const stats: BootStat[] = p.statistic === "mean" ? ["mean"] : p.statistic === "median" ? ["median"] : ["mean", "median"];
  const out: TableCell[][] = [];
  let firstReps: number[] | null = null;
  for (const st of stats) {
    const r = bootstrapCi(x, st, B, seed, conf);
    out.push([st === "mean" ? "Mean" : "Median", r.estimate, r.se, r.bias, r.percentile[0], r.percentile[1], r.bca?.[0] ?? null, r.bca?.[1] ?? null]);
    if (!firstReps) firstReps = r.reps;
    c.key[`${st}`] = r.estimate; c.key[`${st}_bca_lower`] = r.bca?.[0] ?? null; c.key[`${st}_bca_upper`] = r.bca?.[1] ?? null; c.key[`${st}_pct_lower`] = r.percentile[0]; c.key[`${st}_pct_upper`] = r.percentile[1];
    if (st === "median" && new Set(x).size < x.length / 2) c.warnings.push({ level: "note", text: "Many tied values: the bootstrap distribution of the median is lumpy, so its intervals are approximate." });
  }
  c.tables.push({ title: `Bootstrap ${cl(conf)} confidence intervals (${B} resamples, seed ${seed})`, columns: ["Statistic", "Estimate", "Bootstrap SE", "Bias", "Percentile lower", "Percentile upper", "BCa lower", "BCa upper"], rows: out, kinds: ["text", "num", "num", "num", "num", "num", "num", "num"], notes: [`Resamples were drawn with replacement using the mulberry32 generator with seed ${seed}; rerunning with the same data, number of resamples and seed reproduces these numbers exactly.`, "BCa (bias-corrected and accelerated) intervals are usually preferred; the percentile interval is shown for comparison."] });
  const sm = summarize(x, conf);
  if (stats.includes("mean")) c.tables.push({ title: "Classical interval for comparison", columns: ["Statistic", "Estimate", `t-based ${cl(conf)} CI lower`, `t-based ${cl(conf)} CI upper`], rows: [["Mean", sm.mean, sm.ciLower, sm.ciUpper]], kinds: ["text", "num", "num", "num"] });
  if (B < 1000) c.warnings.push({ level: "note", text: "Fewer than 1000 resamples: interval endpoints carry noticeable Monte Carlo error. Use 2000 or more for reporting." });
  if (x.length < 15) c.warnings.push({ level: "warning", text: `Only ${x.length} observations: bootstrap intervals can be too narrow in very small samples.` });
  c.assumptions.push({ name: "Representative sample", detail: "The bootstrap treats the sample as a stand-in for the population; observations must be independent.", status: "check" });
  if (firstReps) c.charts.push({ kind: "histogram", title: `Bootstrap distribution of the ${stats[0]}`, variable: stats[0], bins: histogram(firstReps) });
  Object.assign(c.key, { n: x.length, replicates: B, seed });
  c.warnings.push(...excludedNote(nRows(d), rows.length, [name]));
  return { title: `Bootstrap CI: ${name}`, methodsText: `${cl(conf)} confidence intervals for the ${stats.join(" and ")} of ${name} were estimated with the nonparametric bootstrap (${B} resamples; bias-corrected and accelerated [BCa] and percentile intervals). Resampling used a fixed random seed (${seed}, mulberry32 generator), recorded so the results can be reproduced exactly.`, used: x.length, total: nRows(d) };
}

function runPermutation(c: Ctx): Out {
  const { d, p } = c;
  const y = s(p.outcome), g = s(p.group);
  const all = completeRows(d, [y, g]);
  const gj = colIndex(d, g), yj = colIndex(d, y), gv = d.variables[gj];
  const lv = levels(d, gj, all);
  const la = (p.levelA as string) ?? lv[0], lb = (p.levelB as string) ?? lv.find((l) => l !== la);
  if (!p.levelA && lv.length !== 2) throw new AnalysisError(`"${g}" has ${lv.length} groups. Choose which two to compare.`);
  if (!lb) throw new AnalysisError("Two groups are needed.");
  const [ga, gb] = groupRows(d, gj, all, [la, lb]);
  const a = ga.rows.map((i) => d.columns[yj][i] as number), b = gb.rows.map((i) => d.columns[yj][i] as number);
  const B = Math.round((p.permutations as number) ?? 10000), seed = seedOf(p.seed);
  const r = permutationTest(a, b, B, seed);
  const A = levelLabel(gv, la), Bl = levelLabel(gv, lb);
  const sa = summarize(a), sb = summarize(b);
  c.tables.push({ title: "Group statistics", columns: [g, "N", "Mean", "SD", "Median"], rows: [[A, sa.n, sa.mean, sa.sd, sa.median], [Bl, sb.n, sb.mean, sb.sd, sb.median]], kinds: ["text", "int", "num", "num", "num"] });
  const mcse = r.exact ? null : Math.sqrt((r.p * (1 - r.p)) / B);
  const welch = twoSampleT(a, b, false);
  c.tables.push({ title: "Permutation test of the difference in means", columns: ["Mean difference", "p (two-sided)", "Method", "Relabellings", "Monte Carlo SE of p", "Welch t-test p (for comparison)"], rows: [[r.observed, r.p, r.exact ? "Exact (all relabellings)" : `Monte Carlo, seed ${seed}`, r.permutations, mcse, welch.p]], kinds: ["num", "p", "text", "int", "num", "p"], notes: [`Difference = ${A} minus ${Bl}. p is the proportion of relabellings with an absolute difference at least as large as observed${r.exact ? "" : ", computed as (count + 1) / (relabellings + 1)"}.`, ...(r.exact ? [] : [`Random relabellings use the mulberry32 generator with seed ${seed}; the same data, number of relabellings and seed reproduce this p-value exactly.`])] });
  c.assumptions.push({ name: "Exchangeability", detail: "Under the null hypothesis the group labels are exchangeable: the two groups have the same distribution (not only the same mean). Very different spreads can inflate the false-positive rate.", status: "check" }, { name: "Independence", detail: "Each subject is in one group only.", status: "check" });
  c.charts.push({ kind: "box", title: `${y} by ${g}`, groups: [a, b].map((x, k) => { const sm = summarize(x); const lo = sm.q1 - 1.5 * sm.iqr, hi = sm.q3 + 1.5 * sm.iqr; const inside = x.filter((v) => v >= lo && v <= hi); return { label: k ? Bl : A, min: sm.min, q1: sm.q1, median: sm.median, q3: sm.q3, max: sm.max, whiskerLo: Math.min(...inside), whiskerHi: Math.max(...inside), outliers: x.filter((v) => v < lo || v > hi).slice(0, 200), n: x.length, mean: sm.mean }; }), yLabel: y });
  Object.assign(c.key, { mean_diff: r.observed, p: r.p, exact: r.exact ? "yes" : "no", permutations: r.permutations, seed, group_a: A, group_b: Bl });
  c.warnings.push(...excludedNote(nRows(d), all.length, [y, g]));
  return { title: `Permutation test: ${y} by ${g}`, methodsText: `The difference in mean ${y} between ${A} and ${Bl} was tested with a two-sided permutation test (${r.exact ? `exact, all ${r.permutations} relabellings` : `${B} random relabellings, fixed seed ${seed} with the mulberry32 generator, recorded so the result can be reproduced exactly`}).`, used: a.length + b.length, total: nRows(d) };
}

// --- Standardisation ----------------------------------------------------------------------------------------------------------------

function runStandardization(c: Ctx): Out {
  const { d, p, conf } = c;
  const ev = s(p.events), pop = p.population as string | undefined, st = s(p.stratum), grp = p.group as string | undefined;
  const stdPopV = p.stdPop as string | undefined, stdRateV = p.stdRate as string | undefined;
  const mult = Number(p.multiplier ?? 100000);
  const used = [ev, st, ...(pop ? [pop] : []), ...(grp ? [grp] : [])];
  const rows = completeRows(d, used);
  assertMinN(rows.length, 1, "Standardisation");
  const ej = colIndex(d, ev), sj = colIndex(d, st), pj = pop ? colIndex(d, pop) : -1, gj = grp ? colIndex(d, grp) : -1;
  for (const i of rows) {
    if (!((d.columns[ej][i] as number) >= 0)) throw new AnalysisError(`${ev} must be zero or more (number of events).`);
    if (pop && !((d.columns[pj][i] as number) >= 0)) throw new AnalysisError(`${pop} must be zero or more (population or person-time).`);
  }
  const strata = levels(d, sj, rows);
  if (strata.length < 2) throw new AnalysisError(`${st} has only one stratum; standardisation needs at least two.`);
  if (strata.length > 100) throw new AnalysisError(`${st} has ${strata.length} strata; at most 100 are supported.`);
  const sumOver = (rr: number[]): Stratum[] => strata.map((l) => { const inS = rr.filter((i) => String(d.columns[sj][i]) === l); return { events: inS.reduce((a, i) => a + (d.columns[ej][i] as number), 0), pop: inS.reduce((a, i) => a + (pop ? (d.columns[pj][i] as number) : 1), 0) }; });
  // One value per stratum from a stratum-level variable (it must not vary within a stratum).
  const perStratum = (v: string) => strata.map((l) => {
    const j = colIndex(d, v);
    const vals = [...new Set(rows.filter((i) => String(d.columns[sj][i]) === l && !isMissing(d.variables[j], d.columns[j][i])).map((i) => d.columns[j][i] as number))];
    if (vals.length !== 1) throw new AnalysisError(`${v} must have exactly one value within each stratum of ${st}; stratum "${l}" has ${vals.length ? "several" : "none"}.`);
    return vals[0];
  });
  const pooled = sumOver(rows);
  const groups = grp ? groupRows(d, gj, rows) : [{ level: "All", rows }];
  const gl = (g: { level: string }) => (grp ? levelLabel(d.variables[gj], g.level) : "All");
  const refLevel = (p.refGroup as string | undefined) ?? undefined;
  const stdW = stdPopV ? perStratum(stdPopV) : grp ? pooled.map((x) => x.pop) : null;
  const refRows = grp && refLevel ? groups.find((g) => g.level === refLevel)?.rows : undefined;
  const stdR = stdRateV ? perStratum(stdRateV) : grp ? (refRows ? sumOver(refRows) : pooled).map((x) => (x.pop > 0 ? x.events / x.pop : 0)) : null;
  if (!stdW && !stdR) throw new AnalysisError("Choose a standard: a standard population variable (direct method), a standard rate variable (indirect method), or a group variable so the pooled data can serve as the standard.");
  const stdLabelW = stdPopV ? `standard population in ${stdPopV}` : "pooled population of all groups";
  const stdLabelR = stdRateV ? `standard rates in ${stdRateV}` : refRows ? `rates in ${grp} = ${levelLabel(d.variables[gj], refLevel!)}` : "pooled rates of all groups";
  c.tables.push({ title: "Stratum-specific data", columns: [st, ...groups.flatMap((g) => [`${gl(g)}: events`, `${gl(g)}: population`, `${gl(g)}: rate per ${mult.toLocaleString("en-GB")}`]), ...(stdW ? ["Standard population"] : []), ...(stdR ? [`Standard rate per ${mult.toLocaleString("en-GB")}`] : [])],
    rows: strata.map((l, k) => [levelLabel(d.variables[sj], l), ...groups.flatMap((g) => { const x = sumOver(g.rows)[k]; return [x.events, x.pop, x.pop > 0 ? (mult * x.events) / x.pop : null]; }), ...(stdW ? [stdW[k]] : []), ...(stdR ? [mult * stdR[k]] : [])]),
    kinds: ["text", ...groups.flatMap(() => ["num", "num", "num"] as const), ...(stdW ? (["num"] as const) : []), ...(stdR ? (["num"] as const) : [])] });
  if (stdW) {
    const res = groups.map((g) => ({ g, r: directStandardize(sumOver(g.rows), stdW, conf) }));
    c.tables.push({ title: `Directly standardized rates (per ${mult.toLocaleString("en-GB")})`, columns: ["Group", "Events", "Population", "Crude rate", "Standardized rate", `${cl(conf)} CI lower (gamma)`, `${cl(conf)} CI upper (gamma)`], rows: res.map(({ g, r }) => [gl(g), r.events, r.pop, mult * r.crude, mult * r.rate, mult * r.lo, mult * r.hi]), kinds: ["text", "num", "num", "num", "num", "num", "num"], notes: [`Standard: ${stdLabelW}. CIs use the Fay-Feuer gamma method, which stays valid with few events.`] });
    res.forEach(({ g, r }) => { c.key[`dsr_${gl(g)}`] = mult * r.rate; c.key[`dsr_lo_${gl(g)}`] = mult * r.lo; c.key[`dsr_hi_${gl(g)}`] = mult * r.hi; });
  }
  if (stdR) {
    const res = groups.map((g) => ({ g, r: indirectStandardize(sumOver(g.rows), stdR, conf) }));
    c.tables.push({ title: "Indirect standardisation: standardized mortality (morbidity) ratios", columns: ["Group", "Observed", "Expected", "SMR", `${cl(conf)} CI lower`, `${cl(conf)} CI upper`, "p (SMR = 1)"], rows: res.map(({ g, r }) => [gl(g), r.observed, r.expected, r.smr, r.lo, r.hi, r.p]), kinds: ["text", "num", "num", "num", "num", "num", "p"], notes: [`Expected events use the ${stdLabelR}. CIs and p-values are exact Poisson.`] });
    if (res.some(({ r }) => !r.integerEvents)) c.warnings.push({ level: "note", text: "Event counts are not whole numbers; the exact Poisson intervals use the continuous (chi-square) form." });
    res.forEach(({ g, r }) => { c.key[`smr_${gl(g)}`] = r.smr; c.key[`smr_lo_${gl(g)}`] = r.lo; c.key[`smr_hi_${gl(g)}`] = r.hi; });
    c.assumptions.push({ name: "Comparing SMRs", detail: "Each SMR compares a group with the standard using that group's own age structure, so SMRs of different groups are not directly comparable with each other.", status: "info" });
  }
  const few = pooled.filter((x) => x.events < 5).length;
  if (few) c.warnings.push({ level: "note", text: `${few} stratum/strata have fewer than 5 events; stratum rates are imprecise.` });
  c.assumptions.push({ name: "Same strata definitions", detail: `The study data and the standard must use the same ${st} bands.`, status: "check" });
  c.warnings.push(...excludedNote(nRows(d), rows.length, used));
  return { title: `Standardisation by ${st}`, methodsText: `Rates were standardised by ${st}.${stdW ? ` Direct standardisation applied stratum-specific rates to the ${stdLabelW}; confidence intervals use the Fay-Feuer gamma method.` : ""}${stdR ? ` Indirect standardisation compared observed events with those expected from the ${stdLabelR}, giving standardized mortality (morbidity) ratios with exact Poisson confidence intervals.` : ""} Rates are expressed per ${mult.toLocaleString("en-GB")}${pop ? ` units of ${pop}` : " people"}.`, used: rows.length, total: nRows(d) };
}

export const MORE_RUNNERS: Record<string, (c: Ctx) => Out> = {
  table1: runTable1, anova_factorial: runFactorial, glm: runGlm, multinomial_logistic: runMultinomial, ordinal_logistic: runOrdinal,
  pca: runPca, bootstrap_ci: runBootstrap, permutation_test: runPermutation, standardization: runStandardization,
};


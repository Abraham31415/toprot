// Turns a validated analysis request into a complete, structured result. Every number comes from the deterministic routines in this
// folder; nothing here (or anywhere in the engine) calls an AI model.

import { chi2Sf, normPpf, zCrit } from "@/lib/stats/dist";
import { analyzeDiagnostic, analyzeExposure } from "@/lib/stats/epi";
import { fisherExact, oneSampleT, oneWayAnova, pairedT, pearson, spearman, tukeyHsd, twoSampleT } from "@/lib/stats/tests";
import { colIndex, isMissing, nRows, type Dataset } from "../types";
import { histogram } from "../profile";
import {
  ADJUST_LABEL, AnalysisError, adjustP, assertMinN, completeRows, excludedNote, fmt, fmtP, groupRows, levelLabel, levels,
  type Adjust, type AnalysisResult, type ChartData, type TableCell,
} from "./common";
import { cochranQ, friedman, gamesHowell, kruskalWallis, mannWhitney, signTest, welchAnova, wilcoxonSignedRank } from "./compare";
import { cohenKappa, gTest, mantelHaenszel, mcnemar, pearsonChi2, wilsonCi } from "./categorical";
import { kendallTauB, partialCorrelation } from "./correlation";
import { summarize, weightedSummary } from "./describe";
import { brownForsythe, qqPoints, shapiroWilk } from "./normality";
import { validateParams, type Params } from "./params";
import { boxOf, label, normalityAssumption, pct, s, type Ctx, type Out } from "./kit";
import { breuschPagan, buildDesign, cooksDistance, durbinWatson, hosmerLemeshow, logistic, ols, rocAuc, vif, waldF } from "./regression";
import { blandAltman, cronbachAlpha, icc } from "./reliability";
import { coxPH, kaplanMeier, logRank, survAt } from "./survival";
import { MORE_RUNNERS } from "./run-more";

export type { Ctx, Out } from "./kit";

function twoGroups(c: Ctx): { gj: number; yj: number; rows: number[]; total: number; a: { level: string; rows: number[] }; b: { level: string; rows: number[] } } {
  const { d, p } = c;
  const yj = colIndex(d, s(p.outcome)), gj = colIndex(d, s(p.group));
  const all = completeRows(d, [s(p.outcome), s(p.group)]);
  const lv = levels(d, gj, all);
  const la = (p.levelA as string) ?? lv[0], lb = (p.levelB as string) ?? lv.find((l) => l !== la);
  if (!p.levelA && lv.length !== 2) throw new AnalysisError(`"${p.group}" has ${lv.length} groups. Choose which two to compare, or use ${lv.length > 2 ? "one-way ANOVA or Kruskal-Wallis" : "another variable"}.`);
  if (!lb) throw new AnalysisError("Two groups are needed.");
  const [a, b] = groupRows(d, gj, all, [la, lb]);
  const rows = [...a.rows, ...b.rows];
  return { gj, yj, rows, total: nRows(d), a, b };
}

// --- Describe -----------------------------------------------------------------------------------------------------------------

function runDescribe(c: Ctx): Out {
  const { d, p, conf } = c;
  const names = p.variables as string[];
  const by = p.by as string | undefined, weight = p.weight as string | undefined;
  const cl = `${Math.round(conf * 100)}% CI`;
  const cols = ["Variable", ...(by ? ["Group"] : []), "N", "Missing", "Mean", "SD", "SE", `${cl} lower`, `${cl} upper`, "Median", "Q1", "Q3", "IQR", "Min", "Max", "Skewness", "Kurtosis", "CV"];
  const rows: TableCell[][] = [];
  const boxes: ReturnType<typeof boxOf>[] = [];
  let used = 0;
  for (const name of names) {
    const j = colIndex(d, name);
    const base = completeRows(d, by ? [by] : [], undefined);
    const groups = by ? groupRows(d, colIndex(d, by), base) : [{ level: "", rows: Array.from({ length: nRows(d) }, (_, i) => i) }];
    for (const g of groups) {
      const present = g.rows.filter((i) => !isMissing(d.variables[j], d.columns[j][i]));
      const x = present.map((i) => d.columns[j][i] as number);
      const sm = summarize(x, conf);
      used = Math.max(used, x.length);
      const gl = by ? levelLabel(d.variables[colIndex(d, by)], g.level) : "";
      rows.push([name, ...(by ? [gl] : []), sm.n, g.rows.length - x.length, sm.mean, sm.sd, sm.se, sm.ciLower, sm.ciUpper, sm.median, sm.q1, sm.q3, sm.iqr, sm.min, sm.max, sm.skewness, sm.kurtosis, sm.cv]);
      if (x.length) boxes.push(boxOf(by ? `${name}: ${gl}` : name, x));
      if (!by) { c.key[`${name}_mean`] = sm.mean; c.key[`${name}_sd`] = sm.sd; c.key[`${name}_median`] = sm.median; c.key[`${name}_n`] = sm.n; }
      if (x.length && Math.abs(sm.skewness) > 1) c.warnings.push({ level: "note", text: `${name}${gl ? ` (${gl})` : ""} is skewed (skewness ${fmt(sm.skewness)}); the median and IQR describe it better than the mean and SD.` });
    }
  }
  c.tables.push({ title: "Descriptive statistics", columns: cols, rows, kinds: ["text", ...(by ? ["text" as const] : []), "int", "int", ...Array(14).fill("num")] });
  if (weight) {
    const wj = colIndex(d, weight);
    const wrows: TableCell[][] = [];
    for (const name of names) {
      const j = colIndex(d, name);
      const r = completeRows(d, [name, weight]).filter((i) => (d.columns[wj][i] as number) >= 0);
      const w = weightedSummary(r.map((i) => d.columns[j][i] as number), r.map((i) => d.columns[wj][i] as number));
      wrows.push([name, r.length, w.sumWeights, w.mean, w.sd]);
    }
    c.tables.push({ title: `Weighted by ${weight} (frequency weights)`, columns: ["Variable", "Rows", "Sum of weights", "Weighted mean", "Weighted SD"], rows: wrows, kinds: ["text", "int", "num", "num", "num"] });
  }
  if (boxes.length) c.charts.push({ kind: "box", title: by ? `${names.join(", ")} by ${by}` : "Distribution", groups: boxes.slice(0, 40), yLabel: names.length === 1 ? names[0] : "Value" });
  if (names.length === 1 && !by) {
    const j = colIndex(d, names[0]);
    const x = d.columns[j].filter((v) => !isMissing(d.variables[j], v)) as number[];
    const sm = summarize(x);
    c.charts.push({ kind: "histogram", title: `Histogram of ${names[0]}`, variable: names[0], bins: histogram(x), normal: { mean: sm.mean, sd: sm.sd, n: x.length } });
  }
  return { title: `Descriptive statistics${by ? ` by ${by}` : ""}`, methodsText: `Continuous variables were summarised as mean and standard deviation (SD) and as median and interquartile range (IQR)${by ? `, separately for each category of ${by}` : ""}. Quartiles use linear interpolation; skewness and kurtosis are the bias-adjusted sample estimates (excess kurtosis). The ${cl} for the mean is t-based.`, used, total: nRows(d) };
}

function runFrequencies(c: Ctx): Out {
  const { d, p } = c;
  for (const name of p.variables as string[]) {
    const j = colIndex(d, name), v = d.variables[j];
    const n = nRows(d);
    const counts = new Map<string, number>();
    let miss = 0;
    for (const cell of d.columns[j]) { if (isMissing(v, cell)) miss++; else counts.set(String(cell), (counts.get(String(cell)) ?? 0) + 1); }
    const valid = n - miss;
    const order = levels(d, j, Array.from({ length: n }, (_, i) => i).filter((i) => !isMissing(v, d.columns[j][i])));
    if (order.length > 200) throw new AnalysisError(`"${name}" has ${order.length} distinct values; a frequency table is not useful. Use descriptive statistics or group it into bands.`);
    let cum = 0;
    const rows: TableCell[][] = order.map((k) => {
      const f = counts.get(k)!; cum += f;
      const ci = p.ci ? wilsonCi(f, valid) : null;
      return [levelLabel(v, k), k, f, (100 * f) / n, (100 * f) / valid, (100 * cum) / valid, ...(ci ? [100 * ci.lower, 100 * ci.upper] : [])];
    });
    if (miss) rows.push(["Missing", "", miss, (100 * miss) / n, null, null, ...(p.ci ? [null, null] : [])]);
    rows.push(["Total", "", n, 100, null, null, ...(p.ci ? [null, null] : [])]);
    c.tables.push({ title: `Frequencies: ${label(d, name)}`, columns: ["Category", "Code", "Frequency", "Percent", "Valid percent", "Cumulative percent", ...(p.ci ? ["95% CI lower (%)", "95% CI upper (%)"] : [])], rows, kinds: ["text", "text", "int", "pct", "pct", "pct", "pct", "pct"] });
    c.charts.push({ kind: "bar", title: name, categories: order.map((k) => levelLabel(v, k)), series: [{ name: "Count", values: order.map((k) => counts.get(k)!) }], yLabel: "Count" });
  }
  return { title: "Frequency tables", methodsText: "Categorical variables were summarised as counts and percentages; valid percentages exclude missing values." + (p.ci ? " Confidence intervals for percentages use the Wilson score method." : ""), used: nRows(d), total: nRows(d) };
}

function runNormality(c: Ctx): Out {
  const { d, p } = c;
  const name = s(p.variable), by = p.by as string | undefined;
  const rows = completeRows(d, by ? [name, by] : [name]);
  const j = colIndex(d, name);
  const groups = by ? groupRows(d, colIndex(d, by), rows) : [{ level: "All", rows }];
  const t: TableCell[][] = [];
  for (const g of groups) {
    const x = g.rows.map((i) => d.columns[j][i] as number);
    const sm = summarize(x);
    let w: number | null = null, pv: number | null = null;
    try { const r = shapiroWilk(x); w = r.w; pv = r.p; } catch (e) { c.warnings.push({ level: "note", text: `${g.level}: ${(e as Error).message}` }); }
    const gl = by ? levelLabel(d.variables[colIndex(d, by)], g.level) : "All";
    t.push([gl, x.length, sm.skewness, sm.seSkewness, sm.kurtosis, sm.seKurtosis, w, pv]);
    if (x.length >= 3) c.charts.push({ kind: "qq", title: `Normal Q-Q plot: ${name}${by ? ` (${gl})` : ""}`, points: qqPoints(x) });
    if (!by) { c.charts.push({ kind: "histogram", title: `Histogram of ${name}`, variable: name, bins: histogram(x), normal: { mean: sm.mean, sd: sm.sd, n: x.length } }); c.key.shapiro_w = w; c.key.shapiro_p = pv; }
  }
  c.tables.push({ title: `Normality of ${name}`, columns: ["Group", "N", "Skewness", "SE skewness", "Excess kurtosis", "SE kurtosis", "Shapiro-Wilk W", "p"], rows: t, kinds: ["text", "int", "num", "num", "num", "num", "num", "p"], notes: ["A small p-value suggests departure from normality. In large samples trivial departures are significant; use the Q-Q plot to judge whether they matter."] });
  c.warnings.push(...excludedNote(nRows(d), rows.length, by ? [name, by] : [name]));
  return { title: `Normality check: ${name}`, methodsText: `Normality of ${name} was assessed with the Shapiro-Wilk test (Royston's algorithm), skewness and kurtosis, and normal Q-Q plots${by ? ` within each category of ${by}` : ""}.`, used: rows.length, total: nRows(d) };
}

// --- Categorical ------------------------------------------------------------------------------------------------------------------

function crossCounts(d: Dataset, rv: string, cv: string, rows: number[]) {
  const rj = colIndex(d, rv), cj = colIndex(d, cv);
  const rl = levels(d, rj, rows), cl = levels(d, cj, rows);
  const t = rl.map(() => cl.map(() => 0));
  for (const i of rows) t[rl.indexOf(String(d.columns[rj][i]))][cl.indexOf(String(d.columns[cj][i]))]++;
  return { rl, cl, t, rj, cj };
}

function runCrosstab(c: Ctx): Out {
  const { d, p, conf } = c;
  const rv = s(p.row), cv = s(p.col);
  const rows = completeRows(d, [rv, cv]);
  assertMinN(rows.length, 2, "A cross-tabulation");
  const { rl, cl, t, rj, cj } = crossCounts(d, rv, cv, rows);
  if (rl.length < 2 || cl.length < 2) throw new AnalysisError("Both variables need at least two categories among the complete cases.");
  const N = rows.length;
  const rowT = t.map((r) => r.reduce((a, b) => a + b, 0)), colT = cl.map((_, k) => t.reduce((a, r) => a + r[k], 0));
  const chi = pearsonChi2(t, !!p.yates);
  const body: TableCell[][] = [];
  rl.forEach((r, i) => {
    const lab = levelLabel(d.variables[rj], r);
    body.push([lab, "Count", ...t[i], rowT[i]]);
    body.push(["", "Row %", ...t[i].map((x) => (100 * x) / rowT[i]), 100]);
    body.push(["", "Column %", ...t[i].map((x, k) => (100 * x) / colT[k]), (100 * rowT[i]) / N]);
    body.push(["", "Expected", ...chi.expected[i], null]);
  });
  body.push(["Total", "Count", ...colT, N]);
  body.push(["", "Row %", ...colT.map((x) => (100 * x) / N), 100]);
  c.tables.push({ title: `${label(d, rv)} by ${label(d, cv)}`, columns: [rv, "", ...cl.map((x) => levelLabel(d.variables[cj], x)), "Total"], rows: body, kinds: ["text", "text", ...cl.map(() => "num" as const), "num"] });
  const g = gTest(t);
  const tests: TableCell[][] = [
    [chi.yates ? "Pearson chi-square (Yates corrected)" : "Pearson chi-square", chi.chi2, chi.df, chi.p],
    ["Likelihood-ratio chi-square", g.g, g.df, g.p],
  ];
  if (rl.length === 2 && cl.length === 2) {
    const f = fisherExact(t[0][0], t[0][1], t[1][0], t[1][1]);
    tests.push(["Fisher's exact test (two-sided)", null, null, f.pTwoSided]);
    c.key.fisher_p = f.pTwoSided;
  }
  c.tables.push({ title: "Tests of association", columns: ["Test", "Value", "df", "p"], rows: tests, kinds: ["text", "num", "int", "p"] });
  c.key.chi2 = chi.chi2; c.key.chi2_df = chi.df; c.key.chi2_p = chi.p; c.key.cramers_v = chi.cramersV;
  const eff: TableCell[][] = [["Cramér's V", chi.cramersV, null, null]];
  if (rl.length === 2 && cl.length === 2) {
    const e = analyzeExposure({ a: t[0][1], b: t[0][0], c: t[1][1], d: t[1][0] }, conf);
    eff.push([`Odds ratio (${levelLabel(d.variables[cj], cl[1])}, ${levelLabel(d.variables[rj], rl[0])} vs ${levelLabel(d.variables[rj], rl[1])})`, e.or, e.orCi.lower, e.orCi.upper]);
    eff.push([`Risk ratio (same comparison)`, e.rr, e.rrCi.lower, e.rrCi.upper]);
    c.key.odds_ratio = e.or; c.key.or_lower = e.orCi.lower; c.key.or_upper = e.orCi.upper;
    if (e.corrected) c.warnings.push({ level: "note", text: "A cell is zero, so 0.5 was added to every cell for the odds and risk ratios." });
  }
  c.tables.push({ title: "Effect sizes", columns: ["Measure", "Estimate", `${Math.round(conf * 100)}% CI lower`, `${Math.round(conf * 100)}% CI upper`], rows: eff, kinds: ["text", "num", "num", "num"], notes: rl.length === 2 && cl.length === 2 ? ["Ratios compare the second column category in the first row with the second row. Swap the order of categories by recoding if a different comparison is wanted."] : undefined });
  const small = chi.cellsBelow5, cells = rl.length * cl.length;
  c.assumptions.push({ name: "Expected counts", detail: `${small} of ${cells} cells (${pct(small / cells)}) have expected count below 5; minimum expected ${fmt(chi.minExpected)}.`, status: small / cells > 0.2 || chi.minExpected < 1 ? "violated" : "met" });
  if (small / cells > 0.2 || chi.minExpected < 1) c.warnings.push({ level: "warning", text: rl.length === 2 && cl.length === 2 ? "Expected counts are small: report Fisher's exact test rather than the chi-square test." : "Expected counts are small, so the chi-square p-value may be inaccurate. Combine sparse categories." });
  c.assumptions.push({ name: "Independence", detail: "Each subject must appear in only one cell. For paired data use McNemar's test.", status: "check" });
  c.charts.push({ kind: "bar", title: `${cv} by ${rv} (row %)`, categories: rl.map((r) => levelLabel(d.variables[rj], r)), series: cl.map((cc, k) => ({ name: levelLabel(d.variables[cj], cc), values: t.map((r, i) => (100 * r[k]) / rowT[i]) })), yLabel: "Row %" });
  c.warnings.push(...excludedNote(nRows(d), N, [rv, cv]));
  return { title: `Cross-tabulation: ${rv} by ${cv}`, methodsText: `The association between ${rv} and ${cv} was assessed with Pearson's chi-square test${p.yates ? " with Yates' continuity correction" : ""}${rl.length === 2 && cl.length === 2 ? " and Fisher's exact test" : ""}; strength of association is reported as Cramér's V${rl.length === 2 && cl.length === 2 ? " and odds and risk ratios with Woolf (log) confidence intervals" : ""}.`, used: N, total: nRows(d) };
}

// --- Compare means ------------------------------------------------------------------------------------------------------------------

function runTTestOne(c: Ctx): Out {
  const { d, p, conf } = c;
  const name = s(p.variable), mu = p.mu as number;
  const rows = completeRows(d, [name]);
  assertMinN(rows.length, 2, "A one-sample t-test");
  const x = rows.map((i) => d.columns[colIndex(d, name)][i] as number);
  const sm = summarize(x, conf);
  if (!(sm.sd > 0)) throw new AnalysisError(`${name} has no variation, so a t-test cannot be computed.`);
  const r = oneSampleT(x, mu, conf);
  c.tables.push({ title: "One-sample t-test", columns: ["Variable", "N", "Mean", "SD", "Test value", "Mean difference", `${Math.round(conf * 100)}% CI lower`, `${Math.round(conf * 100)}% CI upper`, "t", "df", "p", "Cohen's d"], rows: [[name, sm.n, sm.mean, sm.sd, mu, r.meanDiff, r.ci.lower, r.ci.upper, r.t, r.df, r.p, r.cohenD]], kinds: ["text", "int", "num", "num", "num", "num", "num", "num", "num", "int", "p", "num"] });
  Object.assign(c.key, { mean: sm.mean, mean_diff: r.meanDiff, ci_lower: r.ci.lower, ci_upper: r.ci.upper, t: r.t, df: r.df, p: r.p, cohen_d: r.cohenD });
  c.assumptions.push(normalityAssumption(name, x), { name: "Independence", detail: "Each value comes from a different subject.", status: "check" });
  c.charts.push({ kind: "histogram", title: `Histogram of ${name}`, variable: name, bins: histogram(x), normal: { mean: sm.mean, sd: sm.sd, n: x.length } });
  c.warnings.push(...excludedNote(nRows(d), rows.length, [name]));
  return { title: `One-sample t-test: ${name}`, methodsText: `The mean of ${name} was compared with ${mu} using a two-sided one-sample t-test.`, used: rows.length, total: nRows(d) };
}

function runTTestInd(c: Ctx): Out {
  const { d, p, conf } = c;
  const g = twoGroups(c);
  const gv = d.variables[g.gj];
  const x = g.a.rows.map((i) => d.columns[g.yj][i] as number), y = g.b.rows.map((i) => d.columns[g.yj][i] as number);
  assertMinN(Math.min(x.length, y.length), 2, "Each group of a t-test");
  const sx = summarize(x, conf), sy = summarize(y, conf);
  if (!(sx.sd > 0 || sy.sd > 0)) throw new AnalysisError("Neither group has any variation, so the t-test is undefined.");
  const welch = twoSampleT(x, y, false, conf), student = twoSampleT(x, y, true, conf);
  const la = levelLabel(gv, g.a.level), lb = levelLabel(gv, g.b.level);
  const cl = Math.round(conf * 100);
  c.tables.push({ title: "Group statistics", columns: [s(p.group), "N", "Mean", "SD", "SE", "Median", "IQR"], rows: [[la, sx.n, sx.mean, sx.sd, sx.se, sx.median, sx.iqr], [lb, sy.n, sy.mean, sy.sd, sy.se, sy.median, sy.iqr]], kinds: ["text", "int", "num", "num", "num", "num", "num"] });
  // Hedges' g and an approximate CI (Hedges & Olkin normal approximation).
  const n1 = x.length, n2 = y.length;
  const dCohen = student.cohenD;
  const J = 1 - 3 / (4 * (n1 + n2) - 9);
  const hg = dCohen * J;
  const seD = Math.sqrt((n1 + n2) / (n1 * n2) + (dCohen * dCohen) / (2 * (n1 + n2)));
  const z = zCrit(conf);
  c.tables.push({ title: "Independent-samples t-test", columns: ["Test", "Mean difference", "SE", `${cl}% CI lower`, `${cl}% CI upper`, "t", "df", "p"], rows: [["Welch (unequal variances)", welch.meanDiff, welch.se, welch.ci.lower, welch.ci.upper, welch.t, welch.df, welch.p], ["Student (equal variances)", student.meanDiff, student.se, student.ci.lower, student.ci.upper, student.t, student.df, student.p]], kinds: ["text", "num", "num", "num", "num", "num", "num", "p"], notes: [`Difference = ${la} minus ${lb}. Welch's test is the recommended default.`] });
  c.tables.push({ title: "Effect size", columns: ["Measure", "Estimate", `${cl}% CI lower`, `${cl}% CI upper`], rows: [["Cohen's d (pooled SD)", dCohen, dCohen - z * seD, dCohen + z * seD], ["Hedges' g (small-sample corrected)", hg, (dCohen - z * seD) * J, (dCohen + z * seD) * J]], kinds: ["text", "num", "num", "num"], notes: ["CIs for d and g use the Hedges-Olkin normal approximation."] });
  const lev = brownForsythe([x, y]);
  c.assumptions.push(normalityAssumption(la, x), normalityAssumption(lb, y),
    { name: "Equal variances", detail: `Levene's test (median): F(${lev.df1}, ${lev.df2}) = ${fmt(lev.f)}, p = ${fmtP(lev.p)}. SD ratio ${fmt(Math.max(sx.sd, sy.sd) / Math.min(sx.sd, sy.sd))}. Welch's test does not need this.`, status: lev.p < 0.05 ? "violated" : "met" },
    { name: "Independence", detail: "The two groups contain different subjects. For before-and-after data use the paired t-test.", status: "check" });
  Object.assign(c.key, { mean_a: sx.mean, mean_b: sy.mean, sd_a: sx.sd, sd_b: sy.sd, n_a: sx.n, n_b: sy.n, mean_diff: welch.meanDiff, ci_lower: welch.ci.lower, ci_upper: welch.ci.upper, t: welch.t, df: welch.df, p: welch.p, cohen_d: dCohen, group_a: la, group_b: lb });
  c.charts.push({ kind: "box", title: `${p.outcome} by ${p.group}`, groups: [boxOf(la, x), boxOf(lb, y)], yLabel: s(p.outcome) });
  c.charts.push({ kind: "means", title: `Mean of ${p.outcome} with ${cl}% CI`, groups: [{ label: la, mean: sx.mean, lo: sx.ciLower, hi: sx.ciUpper, n: sx.n }, { label: lb, mean: sy.mean, lo: sy.ciLower, hi: sy.ciUpper, n: sy.n }], yLabel: s(p.outcome) });
  const allRows = completeRows(d, [s(p.outcome), s(p.group)]);
  c.warnings.push(...excludedNote(nRows(d), allRows.length, [s(p.outcome), s(p.group)]));
  return { title: `Independent-samples t-test: ${p.outcome} by ${p.group}`, methodsText: `Mean ${p.outcome} was compared between ${la} and ${lb} with Welch's two-sided t-test, which does not assume equal variances; Student's t-test is shown for reference. Effect size is reported as Cohen's d and Hedges' g.`, used: g.rows.length, total: nRows(d) };
}

function runTTestPaired(c: Ctx): Out {
  const { d, p, conf } = c;
  const a = s(p.a), b = s(p.b);
  const rows = completeRows(d, [a, b]);
  assertMinN(rows.length, 2, "A paired t-test");
  const x = rows.map((i) => d.columns[colIndex(d, a)][i] as number), y = rows.map((i) => d.columns[colIndex(d, b)][i] as number);
  const diff = x.map((v, i) => v - y[i]);
  const sd = summarize(diff, conf);
  if (!(sd.sd > 0)) throw new AnalysisError("Every paired difference is the same, so the t-test is undefined.");
  const r = pairedT(x, y, conf);
  const sx = summarize(x), sy = summarize(y);
  const cl = Math.round(conf * 100);
  c.tables.push({ title: "Paired samples", columns: ["Variable", "N", "Mean", "SD"], rows: [[a, sx.n, sx.mean, sx.sd], [b, sy.n, sy.mean, sy.sd], [`Difference (${a} - ${b})`, sd.n, sd.mean, sd.sd]], kinds: ["text", "int", "num", "num"] });
  c.tables.push({ title: "Paired t-test", columns: ["Mean difference", "SE", `${cl}% CI lower`, `${cl}% CI upper`, "t", "df", "p", "Cohen's dz", "Correlation between measurements"], rows: [[r.meanDiff, r.se, r.ci.lower, r.ci.upper, r.t, r.df, r.p, r.cohenD, pearson(x, y).r]], kinds: ["num", "num", "num", "num", "num", "int", "p", "num", "num"] });
  Object.assign(c.key, { mean_diff: r.meanDiff, ci_lower: r.ci.lower, ci_upper: r.ci.upper, t: r.t, df: r.df, p: r.p, cohen_dz: r.cohenD, n_pairs: rows.length });
  c.assumptions.push(normalityAssumption("paired differences", diff), { name: "Independent pairs", detail: "Each pair comes from a different subject.", status: "check" });
  c.charts.push({ kind: "histogram", title: "Paired differences", variable: "difference", bins: histogram(diff), normal: { mean: sd.mean, sd: sd.sd, n: diff.length } });
  c.warnings.push(...excludedNote(nRows(d), rows.length, [a, b]));
  return { title: `Paired t-test: ${a} vs ${b}`, methodsText: `${a} and ${b} were compared within subjects with a two-sided paired t-test; effect size is Cohen's dz (mean difference divided by the SD of differences).`, used: rows.length, total: nRows(d) };
}

function runAnova(c: Ctx): Out {
  const { d, p, conf } = c;
  const y = s(p.outcome), gname = s(p.group);
  const rows = completeRows(d, [y, gname]);
  const gj = colIndex(d, gname), yj = colIndex(d, y), gv = d.variables[gj];
  const groups = groupRows(d, gj, rows).filter((g) => g.rows.length > 0);
  if (groups.length < 2) throw new AnalysisError("ANOVA needs at least two groups with data.");
  if (groups.some((g) => g.rows.length < 2)) throw new AnalysisError(`Every group needs at least two observations; ${groups.filter((g) => g.rows.length < 2).map((g) => levelLabel(gv, g.level)).join(", ")} ha${groups.filter((g) => g.rows.length < 2).length === 1 ? "s" : "ve"} fewer.`);
  const data = groups.map((g) => g.rows.map((i) => d.columns[yj][i] as number));
  const a = oneWayAnova(data);
  if (!(a.msWithin > 0)) throw new AnalysisError("There is no variation within groups, so ANOVA is undefined.");
  const w = welchAnova(data);
  const N = rows.length, k = groups.length;
  const omega2 = (a.ssBetween - (k - 1) * a.msWithin) / (a.ssBetween + a.ssWithin + a.msWithin);
  c.tables.push({ title: "Group statistics", columns: [gname, "N", "Mean", "SD", `${Math.round(conf * 100)}% CI lower`, `${Math.round(conf * 100)}% CI upper`, "Median"], rows: data.map((x, i) => { const sm = summarize(x, conf); return [levelLabel(gv, groups[i].level), sm.n, sm.mean, sm.sd, sm.ciLower, sm.ciUpper, sm.median]; }), kinds: ["text", "int", "num", "num", "num", "num", "num"] });
  c.tables.push({ title: "One-way ANOVA", columns: ["Source", "Sum of squares", "df", "Mean square", "F", "p"], rows: [["Between groups", a.ssBetween, a.dfBetween, a.msBetween, a.f, a.p], ["Within groups", a.ssWithin, a.dfWithin, a.msWithin, null, null], ["Total", a.ssBetween + a.ssWithin, N - 1, null, null, null]], kinds: ["text", "num", "int", "num", "num", "p"], notes: [`Eta-squared = ${fmt(a.etaSquared, 3)}; omega-squared = ${fmt(omega2, 3)} (less biased).`] });
  c.tables.push({ title: "Welch's ANOVA (unequal variances)", columns: ["F", "df1", "df2", "p"], rows: [[w.f, w.df1, w.df2, w.p]], kinds: ["num", "int", "num", "p"] });
  const lev = brownForsythe(data);
  c.assumptions.push({ name: "Equal variances", detail: `Levene's test (median): F(${lev.df1}, ${lev.df2}) = ${fmt(lev.f)}, p = ${fmtP(lev.p)}.${lev.p < 0.05 ? " Report Welch's ANOVA and Games-Howell comparisons." : ""}`, status: lev.p < 0.05 ? "violated" : "met" });
  groups.forEach((g, i) => { if (data[i].length >= 3) c.assumptions.push(normalityAssumption(levelLabel(gv, g.level), data[i])); });
  c.assumptions.push({ name: "Independence", detail: "Each subject is in one group only. For repeated measurements use a repeated-measures method.", status: "check" });
  const post = p.posthoc as string;
  if (post === "tukey" && k > 2) {
    const t = tukeyHsd(data, conf);
    c.tables.push({ title: "Tukey HSD post-hoc comparisons", columns: ["Comparison", "Mean difference", `${Math.round(conf * 100)}% CI lower`, `${Math.round(conf * 100)}% CI upper`, "p (adjusted)"], rows: t.pairs.map((x) => [`${levelLabel(gv, groups[x.i].level)} - ${levelLabel(gv, groups[x.j].level)}`, x.diff, x.ci.lower, x.ci.upper, x.p]), kinds: ["text", "num", "num", "num", "p"] });
  } else if (post === "games_howell" && k > 2) {
    const t = gamesHowell(data);
    c.tables.push({ title: "Games-Howell post-hoc comparisons", columns: ["Comparison", "Mean difference", "SE", "df", "p (adjusted)"], rows: t.map((x) => [`${levelLabel(gv, groups[x.i].level)} - ${levelLabel(gv, groups[x.j].level)}`, x.diff, x.se, x.df, x.p]), kinds: ["text", "num", "num", "num", "p"] });
  }
  Object.assign(c.key, { f: a.f, df1: a.dfBetween, df2: a.dfWithin, p: a.p, eta_squared: a.etaSquared, omega_squared: omega2, welch_f: w.f, welch_p: w.p, groups: k });
  c.charts.push({ kind: "box", title: `${y} by ${gname}`, groups: data.map((x, i) => boxOf(levelLabel(gv, groups[i].level), x)), yLabel: y });
  c.warnings.push(...excludedNote(nRows(d), N, [y, gname]));
  return { title: `One-way ANOVA: ${y} by ${gname}`, methodsText: `Mean ${y} was compared across the ${k} categories of ${gname} with one-way ANOVA and, because it does not assume equal variances, Welch's ANOVA.${post !== "none" && k > 2 ? ` Pairwise differences were examined with ${post === "tukey" ? "Tukey's HSD" : "the Games-Howell procedure"}, which controls the family-wise error rate.` : ""} Effect sizes are eta-squared and omega-squared.`, used: N, total: nRows(d) };
}

function runMannWhitney(c: Ctx): Out {
  const { d, p } = c;
  const g = twoGroups(c);
  const gv = d.variables[g.gj];
  const x = g.a.rows.map((i) => d.columns[g.yj][i] as number), y = g.b.rows.map((i) => d.columns[g.yj][i] as number);
  assertMinN(Math.min(x.length, y.length), 1, "Each group");
  const r = mannWhitney(x, y);
  const la = levelLabel(gv, g.a.level), lb = levelLabel(gv, g.b.level);
  const sx = summarize(x), sy = summarize(y);
  c.tables.push({ title: "Group summaries", columns: [s(p.group), "N", "Median", "Q1", "Q3", "Mean rank"], rows: [[la, x.length, sx.median, sx.q1, sx.q3, r.meanRank1], [lb, y.length, sy.median, sy.q1, sy.q3, r.meanRank2]], kinds: ["text", "int", "num", "num", "num", "num"] });
  c.tables.push({ title: "Mann-Whitney U test", columns: ["U", "z", "p", "Effect size r", "P(group 1 > group 2)"], rows: [[r.u1, r.z, r.p, r.effectR, r.commonLanguage]], kinds: ["num", "num", "p", "num", "num"], notes: [`p: ${r.method}. U is for ${la}. r = |z| / sqrt(N).`] });
  Object.assign(c.key, { u: r.u1, z: r.z, p: r.p, effect_r: r.effectR, median_a: sx.median, median_b: sy.median, group_a: la, group_b: lb });
  c.assumptions.push({ name: "Independence", detail: "The groups contain different subjects.", status: "check" }, { name: "Similar shapes", detail: "Interpret as a difference in medians only if the two distributions have a similar shape; otherwise it compares the tendency for larger values.", status: "check" });
  c.charts.push({ kind: "box", title: `${p.outcome} by ${p.group}`, groups: [boxOf(la, x), boxOf(lb, y)], yLabel: s(p.outcome) });
  return { title: `Mann-Whitney U test: ${p.outcome} by ${p.group}`, methodsText: `${p.outcome} was compared between ${la} and ${lb} with the two-sided Mann-Whitney U test (${r.method}); effect size is r = |z|/√N.`, used: g.rows.length, total: nRows(d) };
}

function runWilcoxon(c: Ctx): Out {
  const { d, p } = c;
  const a = s(p.a), b = s(p.b);
  const rows = completeRows(d, [a, b]);
  assertMinN(rows.length, 2, "The Wilcoxon signed-rank test");
  const diff = rows.map((i) => (d.columns[colIndex(d, a)][i] as number) - (d.columns[colIndex(d, b)][i] as number));
  const r = wilcoxonSignedRank(diff);
  const st = signTest(diff);
  const sm = summarize(diff);
  c.tables.push({ title: "Wilcoxon signed-rank test", columns: ["N pairs", "Zero differences (dropped)", "Median difference", "W+", "W-", "z", "p", "Effect size r"], rows: [[rows.length, r.zeros, sm.median, r.wPlus, r.wMinus, r.z, r.p, r.effectR]], kinds: ["int", "int", "num", "num", "num", "num", "p", "num"], notes: [`Difference = ${a} - ${b}. p: ${r.method}.`] });
  c.tables.push({ title: "Sign test", columns: ["Positive", "Negative", "Ties", "p (exact binomial)"], rows: [[st.positive, st.negative, st.ties, st.p]], kinds: ["int", "int", "int", "p"] });
  Object.assign(c.key, { w_plus: r.wPlus, z: r.z, p: r.p, effect_r: r.effectR, median_diff: sm.median, sign_p: st.p });
  c.assumptions.push({ name: "Symmetry of differences", detail: "The signed-rank test assumes differences are symmetric about their median; the sign test does not.", status: "check" });
  c.charts.push({ kind: "histogram", title: "Paired differences", variable: "difference", bins: histogram(diff) });
  c.warnings.push(...excludedNote(nRows(d), rows.length, [a, b]));
  return { title: `Wilcoxon signed-rank test: ${a} vs ${b}`, methodsText: `Paired values of ${a} and ${b} were compared with the two-sided Wilcoxon signed-rank test (zero differences excluded; ${r.method}) and the exact sign test.`, used: rows.length, total: nRows(d) };
}

function runKruskal(c: Ctx): Out {
  const { d, p } = c;
  const y = s(p.outcome), gname = s(p.group);
  const rows = completeRows(d, [y, gname]);
  const gj = colIndex(d, gname), yj = colIndex(d, y), gv = d.variables[gj];
  const groups = groupRows(d, gj, rows).filter((g) => g.rows.length > 0);
  if (groups.length < 2) throw new AnalysisError("At least two groups with data are needed.");
  const data = groups.map((g) => g.rows.map((i) => d.columns[yj][i] as number));
  const r = kruskalWallis(data);
  c.tables.push({ title: "Group summaries", columns: [gname, "N", "Median", "Q1", "Q3", "Mean rank"], rows: data.map((x, i) => { const sm = summarize(x); return [levelLabel(gv, groups[i].level), x.length, sm.median, sm.q1, sm.q3, r.meanRanks[i]]; }), kinds: ["text", "int", "num", "num", "num", "num"] });
  c.tables.push({ title: "Kruskal-Wallis test", columns: ["H", "df", "p", "Epsilon-squared"], rows: [[r.h, r.df, r.p, r.epsilon2]], kinds: ["num", "int", "p", "num"], notes: ["H is corrected for ties; p from the chi-square distribution."] });
  const adj = (p.adjust as Adjust) ?? "holm";
  if (groups.length > 2) {
    const pairs: { lab: string; mw: ReturnType<typeof mannWhitney> }[] = [];
    for (let i = 0; i < data.length; i++) for (let j = i + 1; j < data.length; j++) pairs.push({ lab: `${levelLabel(gv, groups[i].level)} vs ${levelLabel(gv, groups[j].level)}`, mw: mannWhitney(data[i], data[j]) });
    const adjP = adjustP(pairs.map((x) => x.mw.p), adj);
    c.tables.push({ title: `Pairwise Mann-Whitney tests (${ADJUST_LABEL[adj]})`, columns: ["Comparison", "U", "p", "p (adjusted)"], rows: pairs.map((x, k) => [x.lab, x.mw.u1, x.mw.p, adjP[k]]), kinds: ["text", "num", "p", "p"] });
  }
  Object.assign(c.key, { h: r.h, df: r.df, p: r.p, epsilon_squared: r.epsilon2 });
  c.charts.push({ kind: "box", title: `${y} by ${gname}`, groups: data.map((x, i) => boxOf(levelLabel(gv, groups[i].level), x)), yLabel: y });
  c.warnings.push(...excludedNote(nRows(d), rows.length, [y, gname]));
  return { title: `Kruskal-Wallis test: ${y} by ${gname}`, methodsText: `${y} was compared across categories of ${gname} with the Kruskal-Wallis test${groups.length > 2 ? `, followed by pairwise Mann-Whitney tests with ${ADJUST_LABEL[adj]} adjustment` : ""}.`, used: rows.length, total: nRows(d) };
}

function runFriedman(c: Ctx): Out {
  const { d, p } = c;
  const names = p.variables as string[];
  const rows = completeRows(d, names);
  assertMinN(rows.length, 2, "The Friedman test");
  const data = rows.map((i) => names.map((n) => d.columns[colIndex(d, n)][i] as number));
  const r = friedman(data);
  c.tables.push({ title: "Measurements", columns: ["Variable", "Median", "Q1", "Q3", "Mean rank"], rows: names.map((n, j) => { const sm = summarize(data.map((x) => x[j])); return [n, sm.median, sm.q1, sm.q3, r.meanRanks[j]]; }), kinds: ["text", "num", "num", "num", "num"] });
  c.tables.push({ title: "Friedman test", columns: ["N", "Chi-square", "df", "p", "Kendall's W"], rows: [[rows.length, r.q, r.df, r.p, r.kendallW]], kinds: ["int", "num", "int", "p", "num"] });
  Object.assign(c.key, { chi2: r.q, df: r.df, p: r.p, kendall_w: r.kendallW });
  c.warnings.push(...excludedNote(nRows(d), rows.length, names));
  return { title: `Friedman test: ${names.join(", ")}`, methodsText: `The repeated measurements ${names.join(", ")} were compared with the Friedman test (tie-corrected); Kendall's W is reported as the effect size.`, used: rows.length, total: nRows(d) };
}

function binaryPair(d: Dataset, a: string, b: string, rows: number[]) {
  const ja = colIndex(d, a), jb = colIndex(d, b);
  const lv = [...new Set([...levels(d, ja, rows), ...levels(d, jb, rows)])].sort();
  if (lv.length !== 2) throw new AnalysisError(`${a} and ${b} must use the same two categories; together they have ${lv.length}.`);
  return { ja, jb, lv };
}

function runMcNemar(c: Ctx): Out {
  const { d, p } = c;
  const a = s(p.a), b = s(p.b);
  const rows = completeRows(d, [a, b]);
  const { ja, jb, lv } = binaryPair(d, a, b, rows);
  const t = [[0, 0], [0, 0]];
  for (const i of rows) t[lv.indexOf(String(d.columns[ja][i]))][lv.indexOf(String(d.columns[jb][i]))]++;
  const r = mcnemar(t[0][1], t[1][0]);
  const L = (x: string) => levelLabel(d.variables[ja], x);
  c.tables.push({ title: `${a} by ${b}`, columns: [`${a} \\ ${b}`, L(lv[0]), L(lv[1]), "Total"], rows: [[L(lv[0]), t[0][0], t[0][1], t[0][0] + t[0][1]], [L(lv[1]), t[1][0], t[1][1], t[1][0] + t[1][1]]], kinds: ["text", "int", "int", "int"] });
  c.tables.push({ title: "McNemar test", columns: ["Discordant pairs", r.exact ? "Smaller discordant count" : "Chi-square (continuity corrected)", "p", "Method"], rows: [[t[0][1] + t[1][0], r.stat, r.p, r.exact ? "Exact binomial" : "Chi-square, 1 df"]], kinds: ["int", "num", "p", "text"] });
  Object.assign(c.key, { discordant_b: t[0][1], discordant_c: t[1][0], p: r.p });
  return { title: `McNemar test: ${a} vs ${b}`, methodsText: `Paired proportions of ${a} and ${b} were compared with McNemar's test (${r.exact ? "exact binomial, because there were fewer than 25 discordant pairs" : "chi-square with continuity correction"}).`, used: rows.length, total: nRows(d) };
}

function runCochranQ(c: Ctx): Out {
  const { d, p } = c;
  const names = p.variables as string[];
  const rows = completeRows(d, names);
  const data = rows.map((i) => names.map((n) => { const v = d.columns[colIndex(d, n)][i]; if (v !== 0 && v !== 1) throw new AnalysisError(`${n} must be coded 0 and 1.`); return v as number; }));
  const r = cochranQ(data);
  c.tables.push({ title: "Proportion with value 1", columns: ["Variable", "Proportion"], rows: names.map((n, j) => [n, r.proportions[j]]), kinds: ["text", "num"] });
  c.tables.push({ title: "Cochran's Q test", columns: ["N", "Q", "df", "p"], rows: [[rows.length, r.q, r.df, r.p]], kinds: ["int", "num", "int", "p"] });
  Object.assign(c.key, { q: r.q, df: r.df, p: r.p });
  return { title: `Cochran's Q: ${names.join(", ")}`, methodsText: `Proportions across the related binary measurements ${names.join(", ")} were compared with Cochran's Q test.`, used: rows.length, total: nRows(d) };
}

// --- Correlation ------------------------------------------------------------------------------------------------------------------

function runCorrelation(c: Ctx): Out {
  const { d, p, conf } = c;
  const names = p.variables as string[], method = s(p.method), adj = (p.adjust as Adjust) ?? "none";
  const k = names.length;
  const R: (number | null)[][] = names.map(() => names.map(() => null));
  const pairs: { i: number; j: number; r: number; p: number; n: number; lo: number | null; hi: number | null }[] = [];
  let minN = Infinity;
  for (let i = 0; i < k; i++) {
    R[i][i] = 1;
    for (let j = i + 1; j < k; j++) {
      const rows = completeRows(d, [names[i], names[j]]);
      const x = rows.map((t) => d.columns[colIndex(d, names[i])][t] as number), y = rows.map((t) => d.columns[colIndex(d, names[j])][t] as number);
      minN = Math.min(minN, rows.length);
      if (rows.length < 3) { pairs.push({ i, j, r: NaN, p: NaN, n: rows.length, lo: null, hi: null }); continue; }
      let r: number, pv: number, lo: number | null = null, hi: number | null = null;
      if (method === "kendall") { const t = kendallTauB(x, y); r = t.tau; pv = t.p; }
      else if (method === "spearman") { const t = spearman(x, y, conf); r = t.rho; pv = t.p; lo = t.ci?.lower ?? null; hi = t.ci?.upper ?? null; }
      else { const t = pearson(x, y, conf); r = t.r; pv = t.p; lo = t.ci?.lower ?? null; hi = t.ci?.upper ?? null; }
      if (!Number.isFinite(r)) c.warnings.push({ level: "warning", text: `${names[i]} or ${names[j]} is constant among their shared rows, so their correlation is undefined.` });
      R[i][j] = R[j][i] = Number.isFinite(r) ? r : null;
      pairs.push({ i, j, r, p: pv, n: rows.length, lo, hi });
    }
  }
  const adjusted = adjustP(pairs.map((x) => (Number.isFinite(x.p) ? x.p : 1)), adj);
  const coef = method === "pearson" ? "r" : method === "spearman" ? "rho" : "tau-b";
  c.tables.push({ title: `${method === "pearson" ? "Pearson" : method === "spearman" ? "Spearman" : "Kendall"} correlation matrix`, columns: ["", ...names], rows: names.map((n, i) => [n, ...R[i]]), kinds: ["text", ...names.map(() => "num" as const)] });
  c.tables.push({ title: "Pairwise correlations", columns: ["Variable 1", "Variable 2", "N", coef, `${Math.round(conf * 100)}% CI lower`, `${Math.round(conf * 100)}% CI upper`, "p", `p (${ADJUST_LABEL[adj]})`], rows: pairs.map((x, t) => [names[x.i], names[x.j], x.n, x.r, x.lo, x.hi, x.p, adjusted[t]]), kinds: ["text", "text", "int", "num", "num", "num", "p", "p"], notes: [method === "pearson" ? "CIs use Fisher's z transformation." : method === "spearman" ? "CIs use Fisher's z with the Bonett-Wright standard error." : "Kendall's tau-b with the tie-corrected normal approximation for p; no CI is given."] });
  c.charts.push({ kind: "heatmap", title: "Correlation heatmap", labels: names, values: R });
  if (k === 2) {
    const rows = completeRows(d, names);
    c.charts.push({ kind: "scatter", title: `${names[1]} against ${names[0]}`, xLabel: names[0], yLabel: names[1], points: rows.slice(0, 5000).map((t) => [d.columns[colIndex(d, names[0])][t] as number, d.columns[colIndex(d, names[1])][t] as number]) });
    Object.assign(c.key, { r: pairs[0].r, p: pairs[0].p, n: pairs[0].n, ci_lower: pairs[0].lo, ci_upper: pairs[0].hi });
  }
  c.assumptions.push({ name: method === "pearson" ? "Linearity and outliers" : "Monotonic relationship", detail: method === "pearson" ? "Pearson's r measures linear association and is sensitive to outliers; inspect scatter plots." : "Rank correlations measure monotonic association and are robust to outliers.", status: "check" });
  return { title: `Correlation (${method})`, methodsText: `Associations between ${names.join(", ")} were estimated with ${method === "pearson" ? "Pearson's correlation coefficient" : method === "spearman" ? "Spearman's rank correlation" : "Kendall's tau-b"} using pairwise deletion${adj !== "none" ? `; p-values were adjusted for multiple testing with the ${ADJUST_LABEL[adj]} method` : ""}.`, used: Number.isFinite(minN) ? minN : 0, total: nRows(d) };
}

function runPartial(c: Ctx): Out {
  const { d, p } = c;
  const x = s(p.x), y = s(p.y), ctrl = p.controls as string[];
  const rows = completeRows(d, [x, y, ...ctrl]);
  const get = (n: string) => rows.map((i) => d.columns[colIndex(d, n)][i] as number);
  const r = partialCorrelation(get(x), get(y), rows.map((i) => ctrl.map((n) => d.columns[colIndex(d, n)][i] as number)));
  const zero = pearson(get(x), get(y));
  c.tables.push({ title: "Partial correlation", columns: ["Variables", "Controlling for", "N", "Zero-order r", "Partial r", "t", "df", "p"], rows: [[`${x} and ${y}`, ctrl.join(", "), rows.length, zero.r, r.r, r.t, r.df, r.p]], kinds: ["text", "text", "int", "num", "num", "num", "int", "p"] });
  Object.assign(c.key, { partial_r: r.r, zero_order_r: zero.r, p: r.p, df: r.df });
  c.warnings.push(...excludedNote(nRows(d), rows.length, [x, y, ...ctrl]));
  return { title: `Partial correlation: ${x} and ${y}`, methodsText: `The partial Pearson correlation between ${x} and ${y} controlling for ${ctrl.join(", ")} was estimated from the residuals of linear regressions on the control variables.`, used: rows.length, total: nRows(d) };
}

// --- Regression -------------------------------------------------------------------------------------------------------------------

function predSpecs(p: Params) { return (p.predictors as string[]).map((name) => ({ name })); }

function runLinear(c: Ctx): Out {
  const { d, p, conf } = c;
  const y = s(p.outcome);
  const poly = ((p.polynomial as string[]) ?? []).map((name) => ({ name, degree: 2 }));
  const des = buildDesign(d, y, predSpecs(p), (p.interactions as [string, string][]) ?? [], poly);
  const n = des.rows.length, k = des.colNames.length;
  assertMinN(n, k + 1, "This regression model");
  const yv = des.rows.map((i) => d.columns[colIndex(d, y)][i] as number);
  if (new Set(yv).size === 1) throw new AnalysisError(`${y} is constant among the complete cases.`);
  const m = ols(des.X, yv, { conf, robust: p.robust ? "HC3" : "none", colNames: des.colNames });
  // Standardized coefficients: b * sd(x) / sd(y), for every non-intercept column (dummies included, as SPSS does).
  const sdY = Math.sqrt(yv.reduce((s2, v) => s2 + (v - yv.reduce((a, b) => a + b, 0) / n) ** 2, 0) / (n - 1));
  const sdCol = (j: number) => { const col = des.X.map((r) => r[j]); const mu = col.reduce((a, b) => a + b, 0) / n; return Math.sqrt(col.reduce((a, b) => a + (b - mu) ** 2, 0) / (n - 1)); };
  const v = k > 2 ? vif(des.X) : [1];
  const cl = Math.round(conf * 100);
  c.tables.push({ title: `Coefficients${p.robust ? " (HC3 robust standard errors)" : ""}`, columns: ["Term", "B", "SE", `${cl}% CI lower`, `${cl}% CI upper`, "t", "p", "Standardized beta", "VIF"], rows: m.coefs.map((cf, j) => [cf.name, cf.b, cf.se, cf.lo, cf.hi, cf.stat, cf.p, j === 0 ? null : (cf.b * sdCol(j)) / sdY, j === 0 ? null : v[j - 1] ?? null]), kinds: ["text", "num", "num", "num", "num", "num", "p", "num", "num"], notes: des.references.map((r) => `${r.variable}: reference category is "${r.reference}".`) });
  c.tables.push({ title: "Model fit", columns: ["N", "R-squared", "Adjusted R-squared", "Residual SE", "F", "df1", "df2", "p", "AIC", "BIC"], rows: [[n, m.r2, m.adjR2, m.sigma, m.f, m.dfModel, m.df, m.fP, m.aic, m.bic]], kinds: ["int", "num", "num", "num", "num", "int", "int", "p", "num", "num"], notes: ["The F test is from the classical (non-robust) fit. AIC and BIC count the regression coefficients only."] });
  const multi = des.terms.filter((t) => t.columns.length > 1);
  if (multi.length) {
    const classic = p.robust ? ols(des.X, yv, { conf }) : m;
    c.tables.push({ title: "Tests of multi-category terms", columns: ["Term", "F", "df1", "df2", "p"], rows: multi.map((t) => { const w = waldF(classic.beta, classic.cov, t.columns, m.df); return [t.label, w.f, w.df1, m.df, w.p]; }), kinds: ["text", "num", "int", "int", "p"] });
  }
  const bp = breuschPagan(des.X, m.resid);
  const cooks = cooksDistance(m.resid, m.leverage, m.s2, k);
  const highCook = cooks.filter((x) => x > 4 / n).length;
  const highLev = m.leverage.filter((h) => h > (2 * k) / n).length;
  const maxVif = Math.max(...v.filter(Number.isFinite), 1);
  const dw = durbinWatson(m.resid);
  c.assumptions.push({ name: "Constant variance", detail: `Breusch-Pagan LM = ${fmt(bp.lm)}, df = ${bp.df}, p = ${fmtP(bp.p)}.${bp.p < 0.05 && !p.robust ? " Consider robust (HC3) standard errors." : ""}`, status: bp.p < 0.05 ? (p.robust ? "info" : "violated") : "met" });
  c.assumptions.push(normalityAssumption("residuals", m.resid));
  c.assumptions.push({ name: "Multicollinearity", detail: `Largest VIF = ${fmt(maxVif)}.${maxVif > 10 ? " Serious collinearity: coefficients are unstable." : maxVif > 5 ? " Moderate collinearity." : ""}${p.interactions && (p.interactions as unknown[]).length ? " VIFs are naturally high for terms involved in interactions or polynomials." : ""}`, status: maxVif > 10 ? "violated" : maxVif > 5 ? "check" : "met" });
  c.assumptions.push({ name: "Influential observations", detail: `${highCook} observation(s) with Cook's distance > 4/n (max ${fmt(Math.max(...cooks), 3)}); ${highLev} with leverage > 2p/n. Inspect them; do not delete without a substantive reason.`, status: Math.max(...cooks) > 1 ? "violated" : highCook ? "check" : "met" });
  c.assumptions.push({ name: "Independent errors", detail: `Durbin-Watson = ${fmt(dw)} (values near 2 indicate no first-order autocorrelation; relevant when rows are in time order). Clustered or repeated data need a mixed model or GEE.`, status: dw < 1.5 || dw > 2.5 ? "check" : "met" });
  c.assumptions.push({ name: "Linearity", detail: "Check the residuals against fitted values plot for curvature; add a squared term or transform if needed.", status: "check" });
  const epv = n / (k - 1);
  if (epv < 10) c.warnings.push({ level: "warning", text: `Only ${fmt(epv, 1)} observations per predictor term; estimates may be unstable and overfitted.` });
  c.charts.push({ kind: "scatter", title: "Residuals against fitted values", xLabel: "Fitted value", yLabel: "Residual", points: m.fitted.slice(0, 5000).map((f, i) => [f, m.resid[i]]), refY: 0 });
  c.charts.push({ kind: "qq", title: "Normal Q-Q plot of residuals", points: qqPoints(m.resid) });
  c.charts.push({ kind: "forest", title: "Coefficients with CIs", rows: m.coefs.slice(1).map((cf) => ({ label: cf.name, est: cf.b, lo: cf.lo, hi: cf.hi })), ref: 0, log: false, xLabel: `Coefficient (${cl}% CI)` });
  if ((p.predictors as string[]).length === 1 && des.colNames.length === 2) {
    const xj = colIndex(d, (p.predictors as string[])[0]);
    c.charts.push({ kind: "scatter", title: `${y} against ${(p.predictors as string[])[0]}`, xLabel: (p.predictors as string[])[0], yLabel: y, points: des.rows.slice(0, 5000).map((i, t) => [d.columns[xj][i] as number, yv[t]]), line: { intercept: m.beta[0], slope: m.beta[1] } });
  }
  m.coefs.forEach((cf) => { c.key[`b_${cf.name}`] = cf.b; c.key[`p_${cf.name}`] = cf.p; c.key[`lo_${cf.name}`] = cf.lo; c.key[`hi_${cf.name}`] = cf.hi; });
  Object.assign(c.key, { r2: m.r2, adj_r2: m.adjR2, f: m.f, f_p: m.fP, n });
  c.warnings.push(...excludedNote(nRows(d), n, [y, ...(p.predictors as string[])]));
  return { title: `Linear regression: ${y}`, methodsText: `${y} was modelled with multiple linear regression (ordinary least squares) on ${(p.predictors as string[]).join(", ")}${(p.interactions as unknown[] | undefined)?.length ? ", including interaction terms" : ""}${poly.length ? ` and squared terms for ${poly.map((x) => x.name).join(", ")}` : ""}. Categorical predictors were dummy-coded against a reference category.${p.robust ? " Standard errors are heteroscedasticity-consistent (HC3)." : ""} Assumptions were checked with residual plots, the Breusch-Pagan test, variance inflation factors and Cook's distance. Complete-case analysis was used.`, used: n, total: nRows(d) };
}

function runLogistic(c: Ctx): Out {
  const { d, p, conf } = c;
  const y = s(p.outcome);
  const des = buildDesign(d, y, predSpecs(p), (p.interactions as [string, string][]) ?? []);
  const yj = colIndex(d, y);
  const lv = levels(d, yj, des.rows);
  if (lv.length !== 2) throw new AnalysisError(`${y} must have exactly two values among the complete cases; it has ${lv.length}.`);
  const event = (p.event as string) ?? lv[1];
  const yv = des.rows.map((i) => (String(d.columns[yj][i]) === event ? 1 : 0));
  const m = logistic(des.X, yv, { conf, colNames: des.colNames });
  const cl = Math.round(conf * 100);
  const z = normPpf(1 - (1 - conf) / 2);
  c.tables.push({ title: "Coefficients and odds ratios", columns: ["Term", "B", "SE", "z", "p", "Odds ratio", `${cl}% CI lower`, `${cl}% CI upper`], rows: m.coefs.map((cf, j) => [cf.name, cf.b, cf.se, cf.stat, cf.p, j === 0 ? null : Math.exp(cf.b), j === 0 ? null : Math.exp(cf.b - z * cf.se), j === 0 ? null : Math.exp(cf.b + z * cf.se)]), kinds: ["text", "num", "num", "num", "p", "num", "num", "num"], notes: [`Modelled event: ${y} = ${levelLabel(d.variables[yj], event)}. Each odds ratio is adjusted for the other terms in the model. CIs are Wald intervals.`, ...des.references.map((r) => `${r.variable}: reference category is "${r.reference}".`)] });
  const hl = hosmerLemeshow(m.fitted, yv);
  const roc = rocAuc(m.fitted, yv);
  c.tables.push({ title: "Model fit", columns: ["N", "Events", "Log-likelihood", "LR chi-square", "df", "p", "McFadden R²", "Nagelkerke R²", "AIC", "BIC", "AUC", "AUC CI lower", "AUC CI upper"], rows: [[m.n, m.events, m.logLik, m.lr, m.lrDf, m.lrP, m.mcfadden, m.nagelkerke, m.aic, m.bic, roc.auc, Math.max(0, roc.auc - zCrit(conf) * roc.se), Math.min(1, roc.auc + zCrit(conf) * roc.se)]], kinds: ["int", "int", "num", "num", "int", "p", "num", "num", "num", "num", "num", "num", "num"], notes: ["The AUC is measured on the data used to fit the model, so it is optimistic.", "AUC CI uses the DeLong standard error."] });
  const pred = m.fitted.map((q) => (q >= 0.5 ? 1 : 0));
  const tp = pred.filter((q, i) => q === 1 && yv[i] === 1).length, tn = pred.filter((q, i) => q === 0 && yv[i] === 0).length;
  const fp = pred.filter((q, i) => q === 1 && yv[i] === 0).length, fn = pred.filter((q, i) => q === 0 && yv[i] === 1).length;
  c.tables.push({ title: "Classification at predicted probability 0.5", columns: ["", "Predicted no event", "Predicted event", "% correct"], rows: [["Observed no event", tn, fp, (100 * tn) / (tn + fp)], ["Observed event", fn, tp, (100 * tp) / (tp + fn)], ["Overall", null, null, (100 * (tp + tn)) / m.n]], kinds: ["text", "int", "int", "pct"] });
  const multi = des.terms.filter((t) => t.columns.length > 1);
  if (multi.length) c.tables.push({ title: "Wald tests of multi-category terms", columns: ["Term", "Chi-square", "df", "p"], rows: multi.map((t) => { const w = waldF(m.beta, m.cov, t.columns, 1); const chi = w.f * w.df1; return [t.label, chi, w.df1, chi2Sf(chi, w.df1)]; }), kinds: ["text", "num", "int", "p"] });
  const epv = Math.min(m.events, m.n - m.events) / (des.colNames.length - 1);
  c.assumptions.push({ name: "Events per variable", detail: `${fmt(epv, 1)} events (in the smaller outcome group) per coefficient.${epv < 10 ? " Fewer than 10: estimates may be biased and unstable; reduce the number of predictors." : ""}`, status: epv < 10 ? "violated" : "met" });
  c.assumptions.push({ name: "Calibration (Hosmer-Lemeshow)", detail: Number.isFinite(hl.p) ? `Chi-square = ${fmt(hl.chi2)}, df = ${hl.df}, p = ${fmtP(hl.p)}. A small p suggests poor calibration; the test has low power in small samples.` : "Too few distinct risk groups to compute.", status: Number.isFinite(hl.p) ? (hl.p < 0.05 ? "violated" : "met") : "check" });
  c.assumptions.push({ name: "Linearity in the log-odds", detail: "For each continuous predictor, the log-odds should change linearly; consider splines or categories if not.", status: "check" });
  c.assumptions.push({ name: "Independence", detail: "Each row is a different subject. Clustered data need GEE or a mixed model.", status: "check" });
  if (epv < 10) c.warnings.push({ level: "warning", text: "Too few events per predictor for reliable estimates." });
  c.charts.push({ kind: "roc", title: `ROC curve (AUC ${fmt(roc.auc, 3)})`, points: roc.points.length > 1000 ? roc.points.filter((_, i) => i % Math.ceil(roc.points.length / 1000) === 0).concat([roc.points[roc.points.length - 1]]) : roc.points, auc: roc.auc });
  c.charts.push({ kind: "forest", title: "Adjusted odds ratios", rows: m.coefs.slice(1).map((cf) => ({ label: cf.name, est: Math.exp(cf.b), lo: Math.exp(cf.b - z * cf.se), hi: Math.exp(cf.b + z * cf.se) })), ref: 1, log: true, xLabel: `Odds ratio (${cl}% CI, log scale)` });
  m.coefs.slice(1).forEach((cf) => { c.key[`or_${cf.name}`] = Math.exp(cf.b); c.key[`p_${cf.name}`] = cf.p; c.key[`or_lo_${cf.name}`] = Math.exp(cf.b - z * cf.se); c.key[`or_hi_${cf.name}`] = Math.exp(cf.b + z * cf.se); });
  Object.assign(c.key, { n: m.n, events: m.events, lr_chi2: m.lr, lr_p: m.lrP, auc: roc.auc, nagelkerke_r2: m.nagelkerke });
  c.warnings.push(...excludedNote(nRows(d), m.n, [y, ...(p.predictors as string[])]));
  return { title: `Logistic regression: ${y}`, methodsText: `The odds of ${y} = ${levelLabel(d.variables[yj], event)} were modelled with binary logistic regression (maximum likelihood) on ${(p.predictors as string[]).join(", ")}. Results are odds ratios with Wald ${cl}% confidence intervals. Overall fit was assessed with the likelihood-ratio test, discrimination with the area under the ROC curve and calibration with the Hosmer-Lemeshow test. Complete-case analysis was used.`, used: m.n, total: nRows(d) };
}

// --- Epidemiology and diagnostics -------------------------------------------------------------------------------------------------

function table2x2(d: Dataset, rv: string, rPos: string, cv: string, cPos: string, rows: number[]) {
  const rj = colIndex(d, rv), cj = colIndex(d, cv);
  const t = { a: 0, b: 0, c: 0, d: 0 };
  for (const i of rows) {
    const r = String(d.columns[rj][i]) === rPos, cc = String(d.columns[cj][i]) === cPos;
    if (r && cc) t.a++; else if (r) t.b++; else if (cc) t.c++; else t.d++;
  }
  return t;
}

function runRisk(c: Ctx): Out {
  const { d, p, conf } = c;
  const ex = s(p.exposure), oc = s(p.outcome);
  const rows = completeRows(d, [ex, oc]);
  const t = table2x2(d, ex, s(p.exposed), oc, s(p.event), rows);
  if (t.a + t.b === 0 || t.c + t.d === 0) throw new AnalysisError("Both the exposed and unexposed groups need observations.");
  const e = analyzeExposure(t, conf);
  const cl = Math.round(conf * 100);
  const exl = levelLabel(d.variables[colIndex(d, ex)], s(p.exposed)), evl = levelLabel(d.variables[colIndex(d, oc)], s(p.event));
  c.tables.push({ title: "2x2 table", columns: ["", `${oc} = ${evl}`, "Other", "Total", "Risk"], rows: [[`Exposed (${ex} = ${exl})`, t.a, t.b, t.a + t.b, t.a / (t.a + t.b)], ["Unexposed", t.c, t.d, t.c + t.d, t.c / (t.c + t.d)], ["Total", t.a + t.c, t.b + t.d, t.a + t.b + t.c + t.d, (t.a + t.c) / (t.a + t.b + t.c + t.d)]], kinds: ["text", "int", "int", "int", "num"] });
  c.tables.push({ title: "Measures of association", columns: ["Measure", "Estimate", `${cl}% CI lower`, `${cl}% CI upper`], rows: [["Risk ratio", e.rr, e.rrCi.lower, e.rrCi.upper], ["Odds ratio", e.or, e.orCi.lower, e.orCi.upper], ["Risk difference", e.rd, e.rdCi.lower, e.rdCi.upper], ["Attributable fraction in the exposed", e.afe, null, null], ["Population attributable fraction", e.paf, null, null], [e.rd < 0 ? "Number needed to treat" : "Number needed to harm", e.nnt, null, null]], kinds: ["text", "num", "num", "num"], notes: [e.nntNote, "RR and RD CIs: log and Wald methods; OR CI: Woolf (log). The PAF assumes the sample's exposure prevalence represents the population and that the association is causal."] });
  if (e.corrected) c.warnings.push({ level: "note", text: "A cell is zero, so 0.5 was added to every cell (Haldane-Anscombe)." });
  c.warnings.push({ level: "note", text: "Risk ratios and risk differences are valid for cohort and cross-sectional data, not for case-control samples (use the odds ratio)." });
  Object.assign(c.key, { rr: e.rr, rr_lower: e.rrCi.lower, rr_upper: e.rrCi.upper, or: e.or, or_lower: e.orCi.lower, or_upper: e.orCi.upper, rd: e.rd, risk_exposed: e.riskExposed, risk_unexposed: e.riskUnexposed });
  return { title: `Risk analysis: ${oc} by ${ex}`, methodsText: `The association between ${ex} and ${oc} was summarised as the risk ratio, odds ratio and risk difference with ${cl}% confidence intervals (log, Woolf and Wald methods).`, used: rows.length, total: nRows(d) };
}

function runDiagnostic(c: Ctx): Out {
  const { d, p, conf } = c;
  const tv = s(p.test), rv = s(p.reference);
  const rows = completeRows(d, [tv, rv]);
  const t = table2x2(d, tv, s(p.testPositive), rv, s(p.diseased), rows);
  if (t.a + t.c === 0 || t.b + t.d === 0) throw new AnalysisError("The sample needs people both with and without the condition.");
  const r = analyzeDiagnostic(t, conf);
  const cl = Math.round(conf * 100);
  c.tables.push({ title: "Test result by reference standard", columns: ["", "Condition present", "Condition absent", "Total"], rows: [["Test positive", t.a, t.b, t.a + t.b], ["Test negative", t.c, t.d, t.c + t.d], ["Total", t.a + t.c, t.b + t.d, rows.length]], kinds: ["text", "int", "int", "int"] });
  const row = (n: string, v: number, ci: { lower: number; upper: number }): TableCell[] => [n, v, ci.lower, ci.upper];
  c.tables.push({ title: "Diagnostic accuracy", columns: ["Measure", "Estimate", `${cl}% CI lower`, `${cl}% CI upper`], rows: [row("Sensitivity", r.sensitivity, r.sensitivityCi), row("Specificity", r.specificity, r.specificityCi), row("Positive predictive value", r.ppv, r.ppvCi), row("Negative predictive value", r.npv, r.npvCi), row("Accuracy", r.accuracy, r.accuracyCi), row("Positive likelihood ratio", r.lrPositive, r.lrPositiveCi), row("Negative likelihood ratio", r.lrNegative, r.lrNegativeCi), row("Diagnostic odds ratio", r.dor, r.dorCi), row("Prevalence in sample", r.prevalence, r.prevalenceCi)], kinds: ["text", "num", "num", "num"], notes: ["Proportions use Wilson intervals; ratios use log intervals.", "Predictive values depend on the prevalence in this sample."] });
  Object.assign(c.key, { sensitivity: r.sensitivity, specificity: r.specificity, ppv: r.ppv, npv: r.npv, lr_pos: r.lrPositive, lr_neg: r.lrNegative });
  return { title: `Diagnostic accuracy of ${tv}`, methodsText: `Accuracy of ${tv} against ${rv} was described by sensitivity, specificity, predictive values and likelihood ratios with ${cl}% confidence intervals (Wilson for proportions, log method for ratios).`, used: rows.length, total: nRows(d) };
}

function runRoc(c: Ctx): Out {
  const { d, p, conf } = c;
  const sv = s(p.score), rv = s(p.reference);
  const rows = completeRows(d, [sv, rv]);
  const sc = rows.map((i) => (d.columns[colIndex(d, sv)][i] as number) * (p.lowerIsPositive ? -1 : 1));
  const y = rows.map((i) => (String(d.columns[colIndex(d, rv)][i]) === s(p.diseased) ? 1 : 0));
  const r = rocAuc(sc, y);
  const z = zCrit(conf);
  const cuts = r.thresholds.map((th) => {
    const tp = sc.filter((v, i) => v >= th && y[i] === 1).length, fp = sc.filter((v, i) => v >= th && y[i] === 0).length;
    const sens = tp / r.m, spec = 1 - fp / r.n;
    return { th: p.lowerIsPositive ? -th : th, sens, spec, youden: sens + spec - 1 };
  });
  const best = cuts.reduce((a, b) => (b.youden > a.youden ? b : a), cuts[0]);
  c.tables.push({ title: "Area under the ROC curve", columns: ["AUC", "SE (DeLong)", `${Math.round(conf * 100)}% CI lower`, `${Math.round(conf * 100)}% CI upper`, "With condition", "Without condition"], rows: [[r.auc, r.se, Math.max(0, r.auc - z * r.se), Math.min(1, r.auc + z * r.se), r.m, r.n]], kinds: ["num", "num", "num", "num", "int", "int"] });
  const step = Math.max(1, Math.ceil(cuts.length / 60));
  c.tables.push({ title: "Sensitivity and specificity by cutoff", columns: [`Cutoff (positive if ${p.lowerIsPositive ? "≤" : "≥"})`, "Sensitivity", "Specificity", "Youden J"], rows: cuts.filter((_, i) => i % step === 0 || cuts[i] === best).map((x) => [x.th, x.sens, x.spec, x.youden]), kinds: ["num", "num", "num", "num"], notes: [`Youden-optimal cutoff: ${fmt(best.th, 4)} (sensitivity ${fmt(best.sens, 3)}, specificity ${fmt(best.spec, 3)}). A cutoff chosen in the same data is optimistic.`] });
  c.charts.push({ kind: "roc", title: `ROC curve for ${sv} (AUC ${fmt(r.auc, 3)})`, points: r.points, auc: r.auc });
  Object.assign(c.key, { auc: r.auc, auc_lower: Math.max(0, r.auc - z * r.se), auc_upper: Math.min(1, r.auc + z * r.se), best_cutoff: best.th, best_sensitivity: best.sens, best_specificity: best.spec });
  return { title: `ROC analysis: ${sv}`, methodsText: `Discrimination of ${sv} for ${rv} = ${s(p.diseased)} was assessed with the area under the ROC curve (DeLong confidence interval); the cutoff maximising Youden's index is reported.`, used: rows.length, total: nRows(d) };
}

function runKappa(c: Ctx): Out {
  const { d, p, conf } = c;
  const a = s(p.a), b = s(p.b);
  const rows = completeRows(d, [a, b]);
  const ja = colIndex(d, a), jb = colIndex(d, b);
  const lvA = levels(d, ja, rows), lvB = levels(d, jb, rows);
  const allNum = rows.every((i) => typeof d.columns[ja][i] === "number" && typeof d.columns[jb][i] === "number");
  const lv = [...new Set([...lvA, ...lvB])].sort((x, y) => (allNum ? Number(x) - Number(y) : x.localeCompare(y)));
  const t = lv.map(() => lv.map(() => 0));
  for (const i of rows) t[lv.indexOf(String(d.columns[ja][i]))][lv.indexOf(String(d.columns[jb][i]))]++;
  const w = (p.weights as "none" | "linear" | "quadratic") ?? "none";
  if (w !== "none" && lv.length < 3) c.warnings.push({ level: "note", text: "Weighted kappa equals unweighted kappa for two categories." });
  const r = cohenKappa(t, w, conf);
  c.tables.push({ title: `${a} by ${b}`, columns: [`${a} \\ ${b}`, ...lv.map((x) => levelLabel(d.variables[ja], x))], rows: lv.map((x, i) => [levelLabel(d.variables[ja], x), ...t[i]]), kinds: ["text", ...lv.map(() => "int" as const)] });
  c.tables.push({ title: `Cohen's kappa${w !== "none" ? ` (${w} weights)` : ""}`, columns: ["Observed agreement", "Expected agreement", "Kappa", "SE", `${Math.round(conf * 100)}% CI lower`, `${Math.round(conf * 100)}% CI upper`, "z", "p"], rows: [[r.po, r.pe, r.kappa, r.se, r.lo, r.hi, r.z, r.p]], kinds: ["num", "num", "num", "num", "num", "num", "num", "p"], notes: ["Landis and Koch descriptors (arbitrary): <0.20 slight, 0.21-0.40 fair, 0.41-0.60 moderate, 0.61-0.80 substantial, >0.80 almost perfect."] });
  Object.assign(c.key, { kappa: r.kappa, kappa_lower: r.lo, kappa_upper: r.hi, observed_agreement: r.po, p: r.p });
  return { title: `Cohen's kappa: ${a} and ${b}`, methodsText: `Agreement between ${a} and ${b} was quantified with Cohen's ${w !== "none" ? `${w}-weighted ` : ""}kappa with an asymptotic ${Math.round(conf * 100)}% confidence interval.`, used: rows.length, total: nRows(d) };
}

// --- Survival ---------------------------------------------------------------------------------------------------------------------

function survivalData(c: Ctx, extra: string[] = []) {
  const { d, p } = c;
  const tv = s(p.time), ev = s(p.event);
  const rows = completeRows(d, [tv, ev, ...extra]);
  const tj = colIndex(d, tv), ej = colIndex(d, ev);
  const time = rows.map((i) => d.columns[tj][i] as number);
  if (time.some((t) => t < 0)) throw new AnalysisError(`${tv} has negative values; follow-up time must be zero or more.`);
  const evVals = levels(d, ej, rows);
  if (!evVals.every((v) => v === "0" || v === "1")) throw new AnalysisError(`${ev} must be coded 1 = event and 0 = censored.`);
  const event = rows.map((i) => d.columns[ej][i] as number);
  return { rows, time, event };
}

function runKM(c: Ctx): Out {
  const { d, p, conf } = c;
  const group = p.group as string | undefined;
  const { rows, time, event } = survivalData(c, group ? [group] : []);
  assertMinN(rows.length, 2, "Survival analysis");
  const gj = group ? colIndex(d, group) : -1;
  const groups = group ? groupRows(d, gj, rows) : [{ level: "All", rows }];
  const pos = new Map(rows.map((r, k) => [r, k]));
  const summary: TableCell[][] = [];
  const series: Extract<ChartData, { kind: "step" }>["series"] = [];
  for (const g of groups) {
    const idx = g.rows.map((r) => pos.get(r)!);
    const km = kaplanMeier(idx.map((k) => time[k]), idx.map((k) => event[k]), conf);
    const gl = group ? levelLabel(d.variables[gj], g.level) : "All";
    const at = p.at as number | undefined;
    const sAt = at !== undefined ? survAt(km.rows, at) : null;
    summary.push([gl, km.n, km.events, km.median, km.medianLo, km.medianHi, ...(at !== undefined ? [sAt ? sAt.surv : 1, sAt ? sAt.lo : null, sAt ? sAt.hi : null] : [])]);
    const pts: [number, number][] = [[0, 1], ...km.rows.map((r) => [r.time, r.surv] as [number, number])];
    series.push({ name: gl, points: pts, lower: [[0, 1], ...km.rows.map((r) => [r.time, r.lo] as [number, number])], upper: [[0, 1], ...km.rows.map((r) => [r.time, r.hi] as [number, number])], censored: km.censorMarks });
    if (!group) {
      c.tables.push({ title: "Kaplan-Meier life table", columns: ["Time", "At risk", "Events", "Censored", "Survival", "SE", `${Math.round(conf * 100)}% CI lower`, `${Math.round(conf * 100)}% CI upper`], rows: km.rows.slice(0, 300).map((r) => [r.time, r.atRisk, r.events, r.censored, r.surv, r.se, r.lo, r.hi]), kinds: ["num", "int", "int", "int", "num", "num", "num", "num"] });
      Object.assign(c.key, { median_survival: km.median, events: km.events, n: km.n });
    }
  }
  const at = p.at as number | undefined;
  c.tables.unshift({ title: "Survival summary", columns: [group ?? "", "N", "Events", "Median survival", "Median CI lower", "Median CI upper", ...(at !== undefined ? [`S(${at})`, "CI lower", "CI upper"] : [])], rows: summary, kinds: ["text", "int", "int", "num", "num", "num", "num", "num", "num"], notes: ["A dash for the median means survival did not fall to 50% during follow-up. CIs use the log(-log) transformation; the median CI is where the CI bands cross 0.5."] });
  if (group && groups.length > 1) {
    const gi = rows.map((r) => groups.findIndex((g) => g.rows.includes(r)));
    const lr = logRank(time, event, gi);
    c.tables.push({ title: "Log-rank test", columns: ["Group", "Observed events", "Expected events"], rows: groups.map((g, k) => [levelLabel(d.variables[gj], g.level), lr.observed[k], lr.expected[k]]), kinds: ["text", "int", "num"], notes: [`Chi-square = ${fmt(lr.chi2)}, df = ${lr.df}, p = ${fmtP(lr.p)}.`] });
    Object.assign(c.key, { logrank_chi2: lr.chi2, logrank_df: lr.df, logrank_p: lr.p });
  }
  c.charts.push({ kind: "step", title: "Kaplan-Meier survival estimate", xLabel: s(p.time), yLabel: "Survival probability", series });
  c.assumptions.push({ name: "Non-informative censoring", detail: "People censored must have the same outlook as those still followed. This cannot be tested from the data.", status: "check" });
  c.warnings.push(...excludedNote(nRows(d), rows.length, [s(p.time), s(p.event), ...(group ? [group] : [])]));
  return { title: `Kaplan-Meier survival${group ? ` by ${group}` : ""}`, methodsText: `Survival was estimated with the Kaplan-Meier method (Greenwood standard errors, log(-log) confidence intervals)${group ? ` and compared between categories of ${group} with the log-rank test` : ""}.`, used: rows.length, total: nRows(d) };
}

function runCox(c: Ctx): Out {
  const { d, p, conf } = c;
  const des = buildDesign(d, null, predSpecs(p), [], [], [s(p.time), s(p.event)]);
  const { time, event } = (() => { const tj = colIndex(d, s(p.time)), ej = colIndex(d, s(p.event)); return { time: des.rows.map((i) => d.columns[tj][i] as number), event: des.rows.map((i) => d.columns[ej][i] as number) }; })();
  if (time.some((t) => t < 0)) throw new AnalysisError("Follow-up time must be zero or more.");
  if (!event.every((e) => e === 0 || e === 1)) throw new AnalysisError(`${p.event} must be coded 1 = event and 0 = censored.`);
  const X = des.X.map((r) => r.slice(1));
  const m = coxPH(time, event, X, conf);
  const cl = Math.round(conf * 100);
  c.tables.push({ title: "Cox proportional hazards model", columns: ["Term", "B", "SE", "z", "p", "Hazard ratio", `${cl}% CI lower`, `${cl}% CI upper`], rows: m.coefs.map((cf, j) => [des.colNames[j + 1], cf.b, cf.se, cf.z, cf.p, cf.hr, cf.lo, cf.hi]), kinds: ["text", "num", "num", "num", "p", "num", "num", "num"], notes: ["Ties handled with the Breslow method.", ...des.references.map((r) => `${r.variable}: reference category is "${r.reference}".`)] });
  c.tables.push({ title: "Model fit", columns: ["N", "Events", "Log partial likelihood", "LR chi-square", "df", "p", "Harrell's C"], rows: [[m.n, m.events, m.logLik, m.lr, m.lrDf, m.lrP, m.cIndex]], kinds: ["int", "int", "num", "num", "int", "p", "num"] });
  const epv = m.events / X[0].length;
  c.assumptions.push({ name: "Proportional hazards", detail: "Not yet tested automatically. Inspect Kaplan-Meier curves (they should not cross) and consider time interactions.", status: "check" });
  c.assumptions.push({ name: "Events per variable", detail: `${fmt(epv, 1)} events per coefficient.${epv < 10 ? " Fewer than 10: estimates may be unstable." : ""}`, status: epv < 10 ? "violated" : "met" });
  c.charts.push({ kind: "forest", title: "Hazard ratios", rows: m.coefs.map((cf, j) => ({ label: des.colNames[j + 1], est: cf.hr, lo: cf.lo, hi: cf.hi })), ref: 1, log: true, xLabel: `Hazard ratio (${cl}% CI, log scale)` });
  m.coefs.forEach((cf, j) => { c.key[`hr_${des.colNames[j + 1]}`] = cf.hr; c.key[`p_${des.colNames[j + 1]}`] = cf.p; });
  Object.assign(c.key, { n: m.n, events: m.events, c_index: m.cIndex, lr_p: m.lrP });
  return { title: `Cox regression: time to ${p.event}`, methodsText: `Hazard ratios were estimated with Cox proportional hazards regression (Breslow ties) on ${(p.predictors as string[]).join(", ")}, with Wald ${cl}% confidence intervals; discrimination is Harrell's C.`, used: m.n, total: nRows(d) };
}

function runMH(c: Ctx): Out {
  const { d, p, conf } = c;
  const ex = s(p.exposure), oc = s(p.outcome), st = s(p.stratum);
  const rows = completeRows(d, [ex, oc, st]);
  const sj = colIndex(d, st);
  const strata = groupRows(d, sj, rows);
  const tabs = strata.map((g) => ({ level: g.level, t: table2x2(d, ex, s(p.exposed), oc, s(p.event), g.rows) }));
  const crude = analyzeExposure(table2x2(d, ex, s(p.exposed), oc, s(p.event), rows), conf);
  const m = mantelHaenszel(tabs.map((x) => x.t), conf);
  const cl = Math.round(conf * 100);
  c.tables.push({ title: "Stratum-specific odds ratios", columns: [st, "a", "b", "c", "d", "Odds ratio", `${cl}% CI lower`, `${cl}% CI upper`], rows: tabs.map((x) => { const e = analyzeExposure(x.t, conf); return [levelLabel(d.variables[sj], x.level), x.t.a, x.t.b, x.t.c, x.t.d, e.or, e.orCi.lower, e.orCi.upper]; }), kinds: ["text", "int", "int", "int", "int", "num", "num", "num"], notes: ["a = exposed with event, b = exposed without, c = unexposed with event, d = unexposed without. 0.5 is added to every cell of a stratum with a zero cell."] });
  const change = (100 * (crude.or - m.or)) / m.or;
  c.tables.push({ title: "Crude and adjusted", columns: ["Estimate", "Odds ratio", `${cl}% CI lower`, `${cl}% CI upper`], rows: [["Crude", crude.or, crude.orCi.lower, crude.orCi.upper], [`Mantel-Haenszel (adjusted for ${st})`, m.or, m.ci.lower, m.ci.upper]], kinds: ["text", "num", "num", "num"], notes: [`MH chi-square = ${fmt(m.chi2)}, p = ${fmtP(m.p)}. Breslow-Day test of homogeneity: chi-square = ${fmt(m.breslowDay)}, df = ${m.bdDf}, p = ${fmtP(m.bdP)}.`, `The crude OR differs from the adjusted OR by ${fmt(change, 1)}%. A change of more than about 10% is often taken to suggest confounding by ${st}.`] });
  c.assumptions.push({ name: "Homogeneity of odds ratios", detail: `Breslow-Day p = ${fmtP(m.bdP)}.${m.bdP < 0.05 ? ` The odds ratio appears to differ across ${st} (effect modification): report stratum-specific estimates.` : ""}`, status: m.bdP < 0.05 ? "violated" : "met" });
  Object.assign(c.key, { crude_or: crude.or, mh_or: m.or, mh_lower: m.ci.lower, mh_upper: m.ci.upper, mh_p: m.p, breslow_day_p: m.bdP, percent_change: change });
  return { title: `Mantel-Haenszel: ${oc} by ${ex}, stratified by ${st}`, methodsText: `Confounding and effect modification by ${st} were assessed by stratification: the Mantel-Haenszel odds ratio (Robins-Breslow-Greenland CI) was compared with the crude estimate, and homogeneity was tested with the Breslow-Day test.`, used: rows.length, total: nRows(d) };
}

function runReliability(c: Ctx): Out {
  const { d, p, conf } = c;
  const names = p.variables as string[];
  const rows = completeRows(d, names);
  const data = rows.map((i) => names.map((n) => d.columns[colIndex(d, n)][i] as number));
  const a = cronbachAlpha(data, conf);
  const cl = Math.round(conf * 100);
  c.tables.push({ title: "Cronbach's alpha", columns: ["Items", "N", "Alpha", `${cl}% CI lower`, `${cl}% CI upper`, "Standardized alpha", "Mean inter-item r"], rows: [[a.k, a.n, a.alpha, a.lo, a.hi, a.standardized, a.meanInterItemR]], kinds: ["int", "int", "num", "num", "num", "num", "num"], notes: ["CI by Feldt's F-based method."] });
  c.tables.push({ title: "Item statistics", columns: ["Item", "Mean", "SD", "Item-rest correlation", "Alpha if deleted"], rows: names.map((n, j) => [n, a.items[j].mean, a.items[j].sd, a.items[j].itemRest, a.items[j].alphaIfDeleted]), kinds: ["text", "num", "num", "num", "num"] });
  const ic = icc(data, conf);
  c.tables.push({ title: "Intraclass correlation", columns: ["Form", "Model", "Single measure", `${cl}% CI lower`, `${cl}% CI upper`, "Average measures", "Avg CI lower", "Avg CI upper", "F", "df1", "df2", "p"], rows: ic.forms.map((f) => [f.form, f.description, f.single, f.lo, f.hi, f.average, f.loAvg, f.hiAvg, f.f, f.df1, f.df2, f.p]), kinds: ["text", "text", "num", "num", "num", "num", "num", "num", "num", "int", "int", "p"], notes: ["Shrout & Fleiss / McGraw & Wong definitions. ICC2 (random raters, absolute agreement) suits most rater studies; ICC3 measures consistency only."] });
  if (a.items.some((it) => it.itemRest < 0)) c.warnings.push({ level: "warning", text: "An item correlates negatively with the rest of the scale. It may need reverse-scoring." });
  Object.assign(c.key, { alpha: a.alpha, alpha_lower: a.lo, alpha_upper: a.hi, icc2_single: ic.forms[1].single, icc3_single: ic.forms[2].single });
  c.warnings.push(...excludedNote(nRows(d), rows.length, names));
  return { title: `Reliability: ${names.join(", ")}`, methodsText: `Internal consistency was estimated with Cronbach's alpha (Feldt CI); intraclass correlation coefficients were computed from a two-way ANOVA (Shrout and Fleiss forms).`, used: rows.length, total: nRows(d) };
}

function runBlandAltman(c: Ctx): Out {
  const { d, p, conf } = c;
  const a = s(p.a), b = s(p.b);
  const rows = completeRows(d, [a, b]);
  const r = blandAltman(rows.map((i) => d.columns[colIndex(d, a)][i] as number), rows.map((i) => d.columns[colIndex(d, b)][i] as number), conf);
  const cl = Math.round(conf * 100);
  c.tables.push({ title: "Bland-Altman analysis", columns: ["Measure", "Estimate", `${cl}% CI lower`, `${cl}% CI upper`], rows: [["Bias (mean difference)", r.bias, r.biasLo, r.biasHi], ["SD of differences", r.sd, null, null], ["Lower limit of agreement", r.loaLo, r.loaLoCi[0], r.loaLoCi[1]], ["Upper limit of agreement", r.loaHi, r.loaHiCi[0], r.loaHiCi[1]]], kinds: ["text", "num", "num", "num"], notes: [`Difference = ${a} - ${b}. Limits are bias ± 1.96 SD.`, `Proportional bias check: correlation of differences with means r = ${fmt(r.proportionalR, 3)}, p = ${fmtP(r.proportionalP)}.`] });
  c.assumptions.push({ name: "No proportional bias", detail: `Correlation between difference and mean: r = ${fmt(r.proportionalR, 3)}, p = ${fmtP(r.proportionalP)}.`, status: r.proportionalP < 0.05 ? "violated" : "met" });
  c.charts.push({ kind: "bland_altman", title: `Bland-Altman plot: ${a} vs ${b}`, points: r.points.slice(0, 5000), bias: r.bias, loaLo: r.loaLo, loaHi: r.loaHi });
  Object.assign(c.key, { bias: r.bias, loa_lower: r.loaLo, loa_upper: r.loaHi, n: r.n });
  return { title: `Bland-Altman: ${a} vs ${b}`, methodsText: `Agreement between ${a} and ${b} was assessed with a Bland-Altman analysis: bias and 95% limits of agreement with approximate ${cl}% confidence intervals.`, used: rows.length, total: nRows(d) };
}

const RUNNERS: Record<string, (c: Ctx) => Out> = {
  describe: runDescribe, frequencies: runFrequencies, normality: runNormality, crosstab: runCrosstab,
  ttest_one: runTTestOne, ttest_ind: runTTestInd, ttest_paired: runTTestPaired, anova_oneway: runAnova,
  mannwhitney: runMannWhitney, wilcoxon: runWilcoxon, kruskal: runKruskal, friedman: runFriedman, mcnemar: runMcNemar, cochran_q: runCochranQ,
  correlation: runCorrelation, partial_correlation: runPartial, linear_regression: runLinear, logistic_regression: runLogistic,
  risk_2x2: runRisk, diagnostic: runDiagnostic, roc: runRoc, kappa: runKappa,
  kaplan_meier: runKM, cox: runCox, mantel_haenszel: runMH, reliability: runReliability, bland_altman: runBlandAltman,
  ...MORE_RUNNERS,
};

/** Runs one analysis. Throws AnalysisError (a clear, user-facing reason) instead of ever returning a partial or invalid result. */
export function runAnalysis(methodId: string, rawParams: Params, d: Dataset): { result: AnalysisResult; params: Params } {
  const { def, params } = validateParams(methodId, rawParams, d);
  const runner = RUNNERS[methodId];
  if (!runner) throw new AnalysisError(`"${def.label}" is not available yet.`);
  const ctx: Ctx = { d, p: params, conf: (params.conf as number) ?? 0.95, warnings: [], assumptions: [], tables: [], charts: [], key: {} };
  const out = runner(ctx);
  // Final guard: a result must never contain a non-finite number where a number is expected without being marked as missing.
  for (const t of ctx.tables) for (const r of t.rows) for (let k = 0; k < r.length; k++) if (typeof r[k] === "number" && !Number.isFinite(r[k] as number)) r[k] = null;
  for (const k of Object.keys(ctx.key)) { const v = ctx.key[k]; if (typeof v === "number" && !Number.isFinite(v)) ctx.key[k] = null; }
  return {
    params,
    result: {
      method: methodId, title: out.title, methodsText: out.methodsText,
      n: { used: out.used, excluded: Math.max(0, out.total - out.used), total: out.total },
      tables: ctx.tables, assumptions: ctx.assumptions, warnings: ctx.warnings, charts: ctx.charts, keyResults: ctx.key,
    },
  };
}


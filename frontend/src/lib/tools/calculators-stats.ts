import { analyzeDiagnostic, analyzeExposure, incidenceRate, validateTable, wilson } from "../stats/epi";
import {
  chiSquare, clopperPearson, describe as describeData, fisherExact, linearRegression, logisticRegression, meanCi,
  oneSampleT, oneWayAnova, pairedT, pearson, spearman, twoSampleT, type TTestResult,
} from "../stats/tests";
import { CONF_FIELD, ci, confText, fmt, fmtP, parseList, pct, pctCi } from "./helpers";
import type { Calculator, Field, ToolResult } from "./types";

const REF = {
  altman: "Altman DG, Machin D, Bryant TN, Gardner MJ. Statistics with Confidence. 2nd ed. Bristol: BMJ Books; 2000.",
  pagano: "Pagano M, Gauvreau K. Principles of Biostatistics. 2nd ed. Pacific Grove: Duxbury; 2000.",
  welch: "Welch BL. The generalization of 'Student's' problem when several different population variances are involved. Biometrika. 1947;34:28-35.",
  fisher: "Fisher RA. Statistical Methods for Research Workers. Edinburgh: Oliver and Boyd; 1925.",
  agresti: "Agresti A. Categorical Data Analysis. 3rd ed. Hoboken: Wiley; 2013.",
  wilson: "Wilson EB. Probable inference, the law of succession, and statistical inference. J Am Stat Assoc. 1927;22:209-212.",
  cp: "Clopper CJ, Pearson ES. The use of confidence or fiducial limits illustrated in the case of the binomial. Biometrika. 1934;26:404-413.",
  bonett: "Bonett DG, Wright TA. Sample size requirements for estimating Pearson, Kendall and Spearman correlations. Psychometrika. 2000;65:23-28.",
  hosmer: "Hosmer DW, Lemeshow S, Sturdivant RX. Applied Logistic Regression. 3rd ed. Hoboken: Wiley; 2013.",
  little: "Little RJA, Rubin DB. Statistical Analysis with Missing Data. 3rd ed. Hoboken: Wiley; 2019.",
  rothman: "Rothman KJ, Greenland S, Lash TL. Modern Epidemiology. 3rd ed. Philadelphia: Lippincott Williams & Wilkins; 2008.",
  woolf: "Woolf B. On estimating the relation between blood group and disease. Ann Hum Genet. 1955;19:251-253.",
  levin: "Levin ML. The occurrence of lung cancer in man. Acta Unio Int Contra Cancrum. 1953;9:531-541.",
  simel: "Simel DL, Samsa GP, Matchar DB. Likelihood ratios with confidence: sample size estimation for diagnostic test studies. J Clin Epidemiol. 1991;44(8):763-770.",
  garwood: "Garwood F. Fiducial limits for the Poisson distribution. Biometrika. 1936;28:437-442.",
};

const NOTE = "Use these results alongside your study design. They do not replace review by a qualified statistician.";

const dataField = (id: string, label: string, def: string, help?: string): Field => ({
  id, label, kind: "textarea", default: def, placeholder: "Separate values with spaces, commas or new lines", help,
});

const cell = (id: string, label: string, def: string): Field => ({ id, label, kind: "number", default: def, min: 0, step: 1 });

function two(raw: Record<string, string>, a: string, b: string, la: string, lb: string, paired = false): { x: number[]; y: number[] } | string {
  const x = parseList(raw[a] ?? "", la), y = parseList(raw[b] ?? "", lb);
  if (typeof x === "string") return x;
  if (typeof y === "string") return y;
  if (paired && x.length !== y.length) return `Paired data need the same number of values (${x.length} versus ${y.length}).`;
  return { x, y };
}

function ttestResult(r: TTestResult, conf: number, groupNote: string): ToolResult {
  return {
    headline: { label: "p-value", value: fmtP(r.p) },
    rows: [["Test", r.method], ["t statistic", fmt(r.t, 4)], ["Degrees of freedom", fmt(r.df, 2)], ["Mean difference", fmt(r.meanDiff, 4)], [`${confText(conf)} CI for the difference`, ci(r.ci, 4)], ["Standardised effect (Cohen's d)", fmt(r.cohenD, 3)]],
    notes: [groupNote, NOTE],
    methods: `${r.method}: t(${fmt(r.df, 1)}) = ${fmt(r.t, 2)}, p ${r.p < 0.0001 ? "< 0.0001" : "= " + fmtP(r.p)}; mean difference ${fmt(r.meanDiff, 2)} (${confText(conf)} CI ${ci(r.ci, 2)}).`,
  };
}

export const STAT_CALCULATORS: Calculator[] = [
  {
    slug: "descriptive-statistics", name: "Descriptive Statistics", category: "statistical", kind: "calculator",
    summary: "Mean, SD, median, quartiles, range and a confidence interval for a list of values.",
    keywords: ["descriptive", "mean", "standard deviation", "median", "quartile", "IQR", "summary"],
    description: "Paste a single column of numbers to summarise it.",
    fields: [dataField("x", "Values", "5.1 4.9 6.2 5.8 6.0 5.5 4.7 5.3 6.1 5.9"), CONF_FIELD],
    formula: "Mean = sum(x)/n; SD = sqrt(sum((x - mean)^2)/(n - 1)); quartiles by linear interpolation (type 7); CI = mean +/- t x SD/sqrt(n).",
    assumptions: ["Values are numeric and in the same units.", "The confidence interval assumes approximate normality for small samples."],
    limitations: ["Does not detect outliers or data-entry errors. Inspect the data."],
    references: [REF.altman, REF.pagano],
    run: (n, raw) => {
      const x = parseList(raw.x ?? "", "Values", 2);
      if (typeof x === "string") return { error: x };
      const d = describeData(x, n.conf);
      return { headline: { label: "Mean", value: fmt(d.mean, 4) }, rows: [["n", String(d.n)], ["Mean", fmt(d.mean, 4)], ["Standard deviation", fmt(d.sd, 4)], ["Standard error", fmt(d.se, 4)], [`${confText(n.conf)} CI for the mean`, ci(d.meanCi, 4)], ["Median", fmt(d.median, 4)], ["Q1 to Q3", `${fmt(d.q1, 4)} to ${fmt(d.q3, 4)}`], ["Minimum to maximum", `${fmt(d.min, 4)} to ${fmt(d.max, 4)}`]], notes: [NOTE], methods: `Mean ${fmt(d.mean, 2)} (SD ${fmt(d.sd, 2)}), median ${fmt(d.median, 2)} (IQR ${fmt(d.q1, 2)} to ${fmt(d.q3, 2)}), n = ${d.n}.` };
    },
  },
  {
    slug: "confidence-interval-mean", name: "Confidence Interval for a Mean", category: "statistical", kind: "calculator",
    summary: "t-based confidence interval from a mean, SD and sample size.",
    keywords: ["confidence interval", "mean", "t distribution", "CI"],
    description: "Enter summary statistics from your data or from a paper.",
    fields: [{ id: "m", label: "Mean", kind: "number", default: "5.5", step: 0.01 }, { id: "s", label: "Standard deviation", kind: "number", default: "0.5", min: 0, step: 0.01 }, { id: "n", label: "Sample size", kind: "number", default: "10", min: 2, step: 1 }, CONF_FIELD],
    formula: "CI = mean +/- t(1 - a/2, n - 1) x SD / sqrt(n).",
    assumptions: ["Random sample from an approximately normal population, or a large sample."],
    limitations: ["Not valid for skewed data in small samples."],
    references: [REF.altman],
    run: (n) => {
      const r = meanCi(n.m, n.s, n.n, n.conf);
      return { headline: { label: `${confText(n.conf)} CI`, value: ci(r, 4) }, rows: [["Lower", fmt(r.lower, 4)], ["Upper", fmt(r.upper, 4)]], notes: [NOTE], methods: `The mean was ${fmt(n.m, 2)} (${confText(n.conf)} CI ${ci(r, 2)}), n = ${fmt(n.n, 0)}.` };
    },
  },
  {
    slug: "confidence-interval-proportion", name: "Confidence Interval for a Proportion", category: "statistical", kind: "calculator",
    summary: "Wilson score and Clopper-Pearson exact intervals for a proportion.",
    keywords: ["confidence interval", "proportion", "Wilson", "Clopper-Pearson", "exact", "binomial"],
    description: "Enter the number of events and the total. Both a Wilson score interval and an exact interval are shown.",
    fields: [{ id: "x", label: "Number with the outcome", kind: "number", default: "12", min: 0, step: 1 }, { id: "n", label: "Total", kind: "number", default: "40", min: 1, step: 1 }, CONF_FIELD],
    formula: "Wilson: (p + z^2/2n +/- z sqrt(p(1 - p)/n + z^2/4n^2)) / (1 + z^2/n).   Clopper-Pearson: beta-distribution quantiles.",
    assumptions: ["Independent observations with a common probability."],
    limitations: ["Wilson is approximate but accurate. Exact is conservative. Neither accounts for clustering."],
    references: [REF.wilson, REF.cp, REF.altman],
    run: (n) => {
      if (n.x > n.n) return { error: "The number with the outcome cannot exceed the total." };
      if (!Number.isInteger(n.x) || !Number.isInteger(n.n)) return { error: "Counts must be whole numbers." };
      const w = wilson(n.x, n.n, n.conf), e = clopperPearson(n.x, n.n, n.conf);
      return { headline: { label: "Proportion", value: pct(n.x / n.n) }, rows: [["Wilson score interval", pctCi(w)], ["Clopper-Pearson exact interval", pctCi(e)]], notes: [NOTE], methods: `${n.x} of ${n.n} (${pct(n.x / n.n)}; ${confText(n.conf)} Wilson CI ${pctCi(w)}).` };
    },
  },
  {
    slug: "one-sample-t-test", name: "One-Sample t-Test", category: "statistical", kind: "calculator",
    summary: "Test whether a mean differs from a reference value.",
    keywords: ["t-test", "one sample", "mean", "hypothesis test"],
    description: "Compares the mean of one sample with a hypothesised value.",
    fields: [dataField("x", "Values", "5.1 4.9 6.2 5.8 6.0 5.5 4.7 5.3 6.1 5.9"), { id: "mu", label: "Hypothesised mean", kind: "number", default: "5", step: 0.01 }, CONF_FIELD],
    formula: "t = (mean - mu0) / (SD / sqrt(n)),  df = n - 1.",
    assumptions: ["Independent observations.", "Approximately normal data, or a large sample."],
    limitations: ["Sensitive to outliers in small samples."],
    references: [REF.pagano, REF.altman],
    run: (n, raw) => {
      const x = parseList(raw.x ?? "", "Values", 2);
      if (typeof x === "string") return { error: x };
      return ttestResult(oneSampleT(x, n.mu, n.conf), n.conf, "The interval is for the difference between the sample mean and the hypothesised mean.");
    },
  },
  {
    slug: "two-sample-t-test", name: "Two-Sample t-Test", category: "statistical", kind: "calculator",
    summary: "Compare the means of two independent groups (Welch or Student).",
    keywords: ["t-test", "two sample", "independent groups", "Welch", "Student"],
    description: "Welch's test is the safer default because it does not assume equal variances.",
    fields: [dataField("x", "Group 1 values", "5.1 4.9 6.2 5.8 6.0 5.5 4.7 5.3 6.1 5.9"), dataField("y", "Group 2 values", "6.5 7.1 6.8 7.4 6.9 7.2 6.6 7.0"), { id: "eq", label: "Variances", kind: "select", default: "welch", options: [{ value: "welch", label: "Do not assume equal (Welch)" }, { value: "equal", label: "Assume equal (Student)" }] }, CONF_FIELD],
    formula: "Welch: t = (m1 - m2) / sqrt(s1^2/n1 + s2^2/n2) with Satterthwaite df.  Student: pooled variance, df = n1 + n2 - 2.",
    assumptions: ["Independent groups and observations.", "Approximately normal data or reasonable sample sizes."],
    limitations: ["For clearly skewed data consider a rank-based test, which is not covered here."],
    references: [REF.welch, REF.pagano],
    run: (n, raw) => {
      const d = two(raw, "x", "y", "Group 1", "Group 2");
      if (typeof d === "string") return { error: d };
      return ttestResult(twoSampleT(d.x, d.y, raw.eq === "equal", n.conf), n.conf, "The difference is group 1 minus group 2.");
    },
  },
  {
    slug: "paired-t-test", name: "Paired t-Test", category: "statistical", kind: "calculator",
    summary: "Compare two measurements on the same people or matched pairs.",
    keywords: ["paired t-test", "before after", "matched", "dependent"],
    description: "Enter the two measurements in the same order, one pair per position.",
    fields: [dataField("x", "Measurement 1 (e.g. before)", "5.1 4.9 6.2 5.8 6.0 5.5 4.7 5.3 6.1 5.9"), dataField("y", "Measurement 2 (e.g. after)", "4.8 5.2 5.9 5.1 5.6 5.0 4.9 5.4 5.7 5.2"), CONF_FIELD],
    formula: "t = mean(d) / (SD(d) / sqrt(n)), where d = measurement 1 - measurement 2, df = n - 1.",
    assumptions: ["Pairs are independent of each other.", "Differences are approximately normal."],
    limitations: ["Pairs with a missing value must be removed from both lists before entering."],
    references: [REF.pagano, REF.altman],
    run: (n, raw) => {
      const d = two(raw, "x", "y", "Measurement 1", "Measurement 2", true);
      if (typeof d === "string") return { error: d };
      return ttestResult(pairedT(d.x, d.y, n.conf), n.conf, "The difference is measurement 1 minus measurement 2.");
    },
  },
  {
    slug: "chi-square-test", name: "Chi-Square Test of Independence", category: "statistical", kind: "calculator",
    summary: "Test for association in a 2x2 table, with optional Yates correction and expected counts.",
    keywords: ["chi-square", "association", "contingency table", "Yates", "Cramer"],
    description: "Enter observed counts for a 2 x 2 table. Rows could be exposed and unexposed; columns outcome and no outcome.",
    fields: [cell("a", "Row 1, column 1", "30"), cell("b", "Row 1, column 2", "10"), cell("c", "Row 2, column 1", "15"), cell("d", "Row 2, column 2", "25"), { id: "yates", label: "Continuity correction", kind: "select", default: "no", options: [{ value: "no", label: "None (Pearson)" }, { value: "yes", label: "Yates" }] }],
    tableLabels: { title: "Observed counts", rows: ["Row 1", "Row 2"], cols: ["Column 1", "Column 2"] },
    formula: "chi2 = sum((O - E)^2 / E), E = row total x column total / N, df = (r - 1)(c - 1). Yates: (|O - E| - 0.5)^2 / E.",
    assumptions: ["Independent observations.", "Expected counts of at least 5 in most cells (at least 80% of cells, none below 1)."],
    limitations: ["Use Fisher's exact test when expected counts are small."],
    references: [REF.agresti, REF.pagano],
    run: (n, raw) => {
      const err = validateTable({ a: n.a, b: n.b, c: n.c, d: n.d });
      if (err) return { error: err };
      const r = chiSquare([[n.a, n.b], [n.c, n.d]], raw.yates === "yes");
      const notes = [NOTE];
      if (r.minExpected < 5) notes.unshift(`The smallest expected count is ${fmt(r.minExpected, 2)} (below 5). Prefer Fisher's exact test.`);
      return { headline: { label: "p-value", value: fmtP(r.p) }, rows: [["Chi-square", fmt(r.chi2, 4)], ["Degrees of freedom", String(r.df)], ["Smallest expected count", fmt(r.minExpected, 2)], ["Cramer's V", fmt(r.cramersV, 3)], ["Correction", r.yates ? "Yates" : "None"]], table: { head: ["Expected", "Column 1", "Column 2"], rows: r.expected.map((row, i) => [`Row ${i + 1}`, fmt(row[0], 2), fmt(row[1], 2)]) }, notes, methods: `A chi-square test of independence${r.yates ? " with Yates' continuity correction" : ""} gave χ²(${r.df}) = ${fmt(r.chi2, 2)}, p ${r.p < 0.0001 ? "< 0.0001" : "= " + fmtP(r.p)}.` };
    },
  },
  {
    slug: "fishers-exact-test", name: "Fisher's Exact Test", category: "statistical", kind: "calculator",
    summary: "Exact p-value for a 2x2 table, suitable for small counts.",
    keywords: ["Fisher", "exact test", "small sample", "2x2", "contingency"],
    description: "Use this when counts are small or expected counts fall below 5.",
    fields: [cell("a", "Row 1, column 1", "8"), cell("b", "Row 1, column 2", "2"), cell("c", "Row 2, column 1", "1"), cell("d", "Row 2, column 2", "5")],
    tableLabels: { title: "Observed counts", rows: ["Row 1", "Row 2"], cols: ["Column 1", "Column 2"] },
    formula: "Hypergeometric probability of each table with the observed margins; the two-sided p sums all tables no more probable than the observed one.",
    assumptions: ["Fixed margins (conditioning on row and column totals).", "Independent observations."],
    limitations: ["Conservative. The sample odds ratio shown is not the conditional maximum-likelihood estimate."],
    references: [REF.fisher, REF.agresti],
    run: (n) => {
      const err = validateTable({ a: n.a, b: n.b, c: n.c, d: n.d });
      if (err) return { error: err };
      const r = fisherExact(n.a, n.b, n.c, n.d);
      return { headline: { label: "Two-sided p-value", value: fmtP(r.pTwoSided) }, rows: [["Two-sided p", fmtP(r.pTwoSided)], ["One-sided p (less)", fmtP(r.pLess)], ["One-sided p (greater)", fmtP(r.pGreater)], ["Sample odds ratio", fmt(r.sampleOddsRatio, 3)]], notes: [NOTE], methods: `Fisher's exact test (two-sided) gave p ${r.pTwoSided < 0.0001 ? "< 0.0001" : "= " + fmtP(r.pTwoSided)}.` };
    },
  },
  {
    slug: "one-way-anova", name: "One-Way ANOVA", category: "statistical", kind: "calculator",
    summary: "Compare the means of three or more independent groups.",
    keywords: ["ANOVA", "analysis of variance", "F test", "groups", "eta squared"],
    description: "Enter each group on its own line.",
    fields: [{ id: "groups", label: "Groups (one group per line)", kind: "textarea", default: "5.1 4.9 6.2 5.8 6.0 5.5 4.7 5.3 6.1 5.9\n4.8 5.2 5.9 5.1 5.6 5.0 4.9 5.4 5.7 5.2\n6.5 7.1 6.8 7.4 6.9 7.2 6.6 7.0" }],
    formula: "F = MS_between / MS_within, df = (k - 1, N - k). Eta-squared = SS_between / SS_total.",
    assumptions: ["Independent observations.", "Approximately normal residuals.", "Similar variances across groups."],
    limitations: ["A significant F does not say which groups differ. Post-hoc tests are not included."],
    references: [REF.pagano],
    run: (_n, raw) => {
      const groups: number[][] = [];
      for (const [i, line] of (raw.groups ?? "").split(/\n/).map((l) => l.trim()).filter(Boolean).entries()) {
        const g = parseList(line, `Group ${i + 1}`, 2);
        if (typeof g === "string") return { error: g };
        groups.push(g);
      }
      if (groups.length < 3) return { error: "Enter at least three groups, one per line." };
      const r = oneWayAnova(groups);
      return { headline: { label: "p-value", value: fmtP(r.p) }, rows: [["F", fmt(r.f, 4)], ["df (between, within)", `${r.dfBetween}, ${r.dfWithin}`], ["Eta-squared", fmt(r.etaSquared, 3)]], table: { head: ["Group", "n", "Mean", "SD"], rows: r.groups.map((g, i) => [`${i + 1}`, String(g.n), fmt(g.mean, 3), fmt(g.sd, 3)]) }, notes: [NOTE], methods: `A one-way ANOVA showed F(${r.dfBetween}, ${r.dfWithin}) = ${fmt(r.f, 2)}, p ${r.p < 0.0001 ? "< 0.0001" : "= " + fmtP(r.p)}, η² = ${fmt(r.etaSquared, 2)}.` };
    },
  },
  {
    slug: "pearson-correlation", name: "Pearson Correlation", category: "statistical", kind: "calculator",
    summary: "Linear correlation between two variables with a Fisher z confidence interval.",
    keywords: ["Pearson", "correlation", "r", "linear association"],
    description: "Enter paired values for two continuous variables.",
    fields: [dataField("x", "Variable X", "1 2 3 4 5 6 7 8 9 10"), dataField("y", "Variable Y", "2.1 3.9 6.2 7.8 10.1 12.2 13.8 16.1 18.0 20.3"), CONF_FIELD],
    formula: "r = cov(x, y) / (SD(x) SD(y));  t = r sqrt((n - 2)/(1 - r^2));  CI by Fisher's z transform, SE = 1 / sqrt(n - 3).",
    assumptions: ["Linear relationship.", "Approximately bivariate normal data for the p-value and interval."],
    limitations: ["Sensitive to outliers. Correlation is not causation."],
    references: [REF.pagano, REF.altman],
    run: (n, raw) => {
      const d = two(raw, "x", "y", "Variable X", "Variable Y", true);
      if (typeof d === "string") return { error: d };
      if (d.x.length < 3) return { error: "At least 3 pairs are needed." };
      const r = pearson(d.x, d.y, n.conf);
      return { headline: { label: "Pearson r", value: fmt(r.r, 4) }, rows: [["r", fmt(r.r, 4)], ["R-squared", fmt(r.rSquared, 4)], ["n", String(r.n)], ["p-value", fmtP(r.p)], [`${confText(n.conf)} CI`, r.ci ? ci(r.ci, 3) : "needs n > 3"]], notes: [NOTE], methods: `Pearson's correlation was r = ${fmt(r.r, 2)} (${confText(n.conf)} CI ${r.ci ? ci(r.ci, 2) : "n/a"}), p ${r.p < 0.0001 ? "< 0.0001" : "= " + fmtP(r.p)}, n = ${r.n}.` };
    },
  },
  {
    slug: "spearman-correlation", name: "Spearman Rank Correlation", category: "statistical", kind: "calculator",
    summary: "Rank-based correlation for monotonic relationships, with ties handled.",
    keywords: ["Spearman", "rank correlation", "non-parametric", "monotonic", "rho"],
    description: "Use this for ordinal data, skewed data or monotonic but non-linear relationships.",
    fields: [dataField("x", "Variable X", "1 2 2 4 5 7 7 7 9 10"), dataField("y", "Variable Y", "3 1 4 4 6 5 9 8 7 12"), CONF_FIELD],
    formula: "rho = Pearson correlation of the average ranks;  p from t = rho sqrt((n - 2)/(1 - rho^2));  CI by Fisher z with Bonett-Wright SE sqrt((1 + rho^2/2)/(n - 3)).",
    assumptions: ["Monotonic relationship.", "Independent pairs."],
    limitations: ["The p-value is a t approximation, less accurate for very small n with many ties."],
    references: [REF.bonett, REF.pagano],
    run: (n, raw) => {
      const d = two(raw, "x", "y", "Variable X", "Variable Y", true);
      if (typeof d === "string") return { error: d };
      if (d.x.length < 4) return { error: "At least 4 pairs are needed." };
      const r = spearman(d.x, d.y, n.conf);
      return { headline: { label: "Spearman rho", value: fmt(r.rho, 4) }, rows: [["rho", fmt(r.rho, 4)], ["n", String(r.n)], ["p-value", fmtP(r.p)], [`${confText(n.conf)} CI`, r.ci ? ci(r.ci, 3) : "n/a"]], notes: [NOTE], methods: `Spearman's rank correlation was ρ = ${fmt(r.rho, 2)}, p ${r.p < 0.0001 ? "< 0.0001" : "= " + fmtP(r.p)}, n = ${r.n}.` };
    },
  },
  {
    slug: "simple-linear-regression", name: "Simple Linear Regression", category: "statistical", kind: "calculator",
    summary: "Fit y = a + bx with standard errors, p-values, R-squared and intervals.",
    keywords: ["linear regression", "least squares", "slope", "R squared", "prediction"],
    description: "One predictor and one continuous outcome.",
    fields: [dataField("x", "Predictor X", "1 2 3 4 5 6 7 8 9 10"), dataField("y", "Outcome Y", "2.1 3.9 6.2 7.8 10.1 12.2 13.8 16.1 18.0 20.3"), CONF_FIELD],
    formula: "b = Sxy / Sxx;  a = ybar - b xbar;  SE(b) = sqrt(s^2 / Sxx);  t = b / SE(b), df = n - 2.",
    assumptions: ["Linear relationship.", "Independent, normally distributed residuals with constant variance."],
    limitations: ["One predictor only. Check residual plots in your statistics package."],
    references: [REF.pagano],
    run: (n, raw) => {
      const d = two(raw, "x", "y", "Predictor X", "Outcome Y", true);
      if (typeof d === "string") return { error: d };
      if (d.x.length < 3) return { error: "At least 3 pairs are needed." };
      if (new Set(d.x).size < 2) return { error: "The predictor has no variation." };
      const r = linearRegression(d.x, d.y, n.conf);
      return { headline: { label: "Slope", value: fmt(r.slope, 4) }, rows: [["Intercept", `${fmt(r.intercept, 4)} (SE ${fmt(r.seIntercept, 4)})`], ["Slope", `${fmt(r.slope, 4)} (SE ${fmt(r.seSlope, 4)})`], [`${confText(n.conf)} CI for slope`, ci(r.slopeCi, 4)], ["p-value for slope", fmtP(r.pSlope)], ["R-squared", fmt(r.rSquared, 4)], ["Residual SE", fmt(r.residualSe, 4)], ["Degrees of freedom", String(r.df)]], notes: [NOTE], methods: `In simple linear regression, each unit increase in X was associated with a ${fmt(r.slope, 2)} change in Y (${confText(n.conf)} CI ${ci(r.slopeCi, 2)}; p ${r.pSlope < 0.0001 ? "< 0.0001" : "= " + fmtP(r.pSlope)}; R² = ${fmt(r.rSquared, 2)}).` };
    },
  },
  {
    slug: "simple-logistic-regression", name: "Simple Logistic Regression", category: "statistical", kind: "calculator",
    summary: "Odds ratio for a binary outcome per unit of one predictor, by maximum likelihood.",
    keywords: ["logistic regression", "odds ratio", "binary outcome", "maximum likelihood"],
    description: "One predictor and an outcome coded 0 or 1. Results match standard statistical software.",
    fields: [dataField("x", "Predictor X", "22 25 30 35 40 45 50 55 60 65 28 33 38 43 48 53 58 63 68 70"), dataField("y", "Outcome (0 or 1)", "0 0 0 1 0 0 1 0 1 1 0 0 0 1 0 1 1 0 1 1"), CONF_FIELD],
    formula: "logit(P(Y = 1)) = b0 + b1 x, fitted by Newton-Raphson. OR = exp(b1); Wald CI = exp(b1 +/- z SE). Likelihood-ratio test against the null model.",
    assumptions: ["Independent observations.", "Linearity of the logit in the predictor.", "No perfect separation."],
    limitations: ["One predictor only. Small samples (under about 10 events per variable) give unstable estimates."],
    references: [REF.hosmer],
    run: (n, raw) => {
      const d = two(raw, "x", "y", "Predictor X", "Outcome", true);
      if (typeof d === "string") return { error: d };
      try {
        const r = logisticRegression(d.x, d.y, n.conf);
        return { headline: { label: "Odds ratio per unit", value: fmt(r.oddsRatio, 4) }, rows: [["Intercept", `${fmt(r.intercept, 4)} (SE ${fmt(r.seIntercept, 4)})`], ["Slope (log odds)", `${fmt(r.slope, 4)} (SE ${fmt(r.seSlope, 4)})`], ["Odds ratio", fmt(r.oddsRatio, 4)], [`${confText(n.conf)} CI for OR`, ci(r.oddsRatioCi, 4)], ["Wald p-value", fmtP(r.pSlope)], ["Likelihood-ratio p", fmtP(r.lrP)], ["Log-likelihood", fmt(r.logLikelihood, 4)]], notes: [NOTE], methods: `In simple logistic regression, the odds ratio per unit increase in X was ${fmt(r.oddsRatio, 2)} (${confText(n.conf)} CI ${ci(r.oddsRatioCi, 2)}; Wald p ${r.pSlope < 0.0001 ? "< 0.0001" : "= " + fmtP(r.pSlope)}).` };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  },
  {
    slug: "missing-data-summary", name: "Missing-Data Summary", category: "statistical", kind: "calculator",
    summary: "Count and percentage missing per variable, and complete cases, from pasted data.",
    keywords: ["missing data", "NA", "complete cases", "data quality", "dataset"],
    description: "Paste a table with a header row. Blank cells and NA, N/A, NaN, null, '.' or '-' count as missing.",
    fields: [{ id: "csv", label: "Data (comma, tab or semicolon separated, header first)", kind: "textarea", default: "age,sex,hb\n23,F,11.2\n31,M,\n45,F,10.8\nNA,M,13.1\n52,F,12.0", help: "One row per participant. This tool only counts missingness. It does not test whether data are missing at random." }],
    formula: "Missing % = missing / total rows x 100. Complete cases = rows with no missing value.",
    assumptions: ["The first row holds variable names.", "Every row has the same number of fields."],
    limitations: ["Describes missingness only. Choosing how to handle it (for example multiple imputation) needs statistical judgement."],
    references: [REF.little],
    run: (_n, raw) => {
      const lines = (raw.csv ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
      if (lines.length < 2) return { error: "Enter a header row and at least one data row." };
      const split = (l: string) => l.split(/[,;\t]/).map((c) => c.trim());
      const head = split(lines[0]);
      const rows = lines.slice(1).map(split);
      const bad = rows.findIndex((r) => r.length !== head.length);
      if (bad >= 0) return { error: `Row ${bad + 2} has ${rows[bad].length} fields but the header has ${head.length}.` };
      const missing = (c: string) => c === "" || /^(na|n\/a|nan|null|\.|-)$/i.test(c);
      const counts = head.map((_, j) => rows.filter((r) => missing(r[j])).length);
      const complete = rows.filter((r) => r.every((c) => !missing(c))).length;
      return { headline: { label: "Complete cases", value: `${complete} of ${rows.length} (${pct(complete / rows.length)})` }, table: { head: ["Variable", "Missing", "Missing %", "Observed"], rows: head.map((h, j) => [h, String(counts[j]), pct(counts[j] / rows.length), String(rows.length - counts[j])]) }, notes: ["This counts missing values only. Whether they are missing at random cannot be judged from counts.", NOTE], methods: `Of ${rows.length} records, ${complete} (${pct(complete / rows.length)}) had complete data. Missingness by variable: ${head.map((h, j) => `${h} ${pct(counts[j] / rows.length)}`).join(", ")}.` };
    },
  },
];

const exposureFields = (): Field[] => [cell("a", "Exposed with outcome", "40"), cell("b", "Exposed without outcome", "60"), cell("c", "Unexposed with outcome", "20"), cell("d", "Unexposed without outcome", "80"), CONF_FIELD];
const tableLabels = { title: "Exposure and outcome", rows: ["Exposed", "Unexposed"] as [string, string], cols: ["Outcome", "No outcome"] as [string, string] };

function exposureCalc(slug: string, name: string, summary: string, keywords: string[], headlineKey: "or" | "rr" | "rd" | "all"): Calculator {
  return {
    slug, name, category: "epidemiology", kind: "calculator", summary, keywords,
    description: "Enter counts from a cohort, cross-sectional or case-control table. Risk-based measures (relative risk, risk difference, attributable fractions, NNT) are only valid for cohort or cross-sectional data, not for case-control data.",
    fields: exposureFields(), tableLabels,
    formula: "RR = (a/(a+b)) / (c/(c+d));  OR = ad/bc;  RD = p1 - p0;  AFe = (p1 - p0)/p1;  PAF = Pe(RR - 1)/(1 + Pe(RR - 1));  NNT = 1/|RD|.  CIs: log scale (Woolf for OR; Katz for RR), Wald for RD.",
    assumptions: ["Counts come from a design where the measure is valid (risk measures need a cohort or cross-section).", "Independent observations."],
    limitations: ["Crude (unadjusted) estimates. Confounding is not addressed.", "A 0.5 correction is added to every cell if any cell is zero.", "PAF here uses the exposure prevalence in the whole sample."],
    references: [REF.rothman, REF.woolf, REF.levin, REF.altman],
    run: (n) => {
      const err = validateTable({ a: n.a, b: n.b, c: n.c, d: n.d });
      if (err) return { error: err };
      const r = analyzeExposure({ a: n.a, b: n.b, c: n.c, d: n.d }, n.conf);
      const c = confText(n.conf);
      const all: [string, string][] = [["Risk in exposed", pct(r.riskExposed)], ["Risk in unexposed", pct(r.riskUnexposed)], ["Relative risk", `${fmt(r.rr, 3)} (${ci(r.rrCi, 3)})`], ["Odds ratio", `${fmt(r.or, 3)} (${ci(r.orCi, 3)})`], ["Risk difference (attributable risk)", `${fmt(r.rd, 4)} (${ci(r.rdCi, 4)})`], ["Attributable fraction among exposed", pct(r.afe)], ["Population attributable fraction", pct(r.paf)], [r.rd < 0 ? "Number needed to treat" : "Number needed to harm", r.nnt ? fmt(r.nnt, 1) : "not defined"]];
      const headline = headlineKey === "or" ? { label: `Odds ratio (${c} CI)`, value: `${fmt(r.or, 3)} (${ci(r.orCi, 2)})` } : headlineKey === "rr" ? { label: `Relative risk (${c} CI)`, value: `${fmt(r.rr, 3)} (${ci(r.rrCi, 2)})` } : headlineKey === "rd" ? { label: `Risk difference (${c} CI)`, value: `${fmt(r.rd, 4)} (${ci(r.rdCi, 3)})` } : { label: `Relative risk (${c} CI)`, value: `${fmt(r.rr, 3)} (${ci(r.rrCi, 2)})` };
      const notes = [NOTE];
      if (r.corrected) notes.unshift("A cell was zero, so 0.5 was added to every cell (Haldane-Anscombe).");
      if (r.nnt) notes.unshift(r.nntNote);
      return { headline, rows: all, notes, methods: `The relative risk was ${fmt(r.rr, 2)} (${c} CI ${ci(r.rrCi, 2)}), the odds ratio ${fmt(r.or, 2)} (${c} CI ${ci(r.orCi, 2)}) and the risk difference ${fmt(r.rd, 3)} (${c} CI ${ci(r.rdCi, 3)}).` };
    },
  };
}

export const EPI_CALCULATORS: Calculator[] = [
  exposureCalc("epidemiology-2x2-table", "2x2 Table: Risk, Odds and Attributable Measures", "Interactive 2x2 table giving relative risk, odds ratio, risk difference, attributable fractions and NNT/NNH.", ["2x2", "contingency table", "relative risk", "odds ratio", "risk difference", "attributable risk", "NNT", "NNH", "population attributable fraction"], "all"),
  exposureCalc("odds-ratio-calculator", "Odds Ratio Calculator", "Odds ratio with a log-scale confidence interval from a 2x2 table.", ["odds ratio", "OR", "Woolf", "case-control"], "or"),
  exposureCalc("relative-risk-calculator", "Relative Risk Calculator", "Relative (risk) ratio with a confidence interval from a 2x2 table.", ["relative risk", "risk ratio", "RR", "cohort"], "rr"),
  exposureCalc("risk-difference-calculator", "Risk Difference and NNT Calculator", "Absolute risk difference with a confidence interval, plus number needed to treat or harm.", ["risk difference", "absolute risk", "NNT", "NNH", "attributable risk"], "rd"),
  {
    slug: "diagnostic-test-calculator", name: "Diagnostic Test Accuracy", category: "epidemiology", kind: "calculator",
    summary: "Sensitivity, specificity, predictive values, likelihood ratios and diagnostic odds ratio with intervals.",
    keywords: ["sensitivity", "specificity", "PPV", "NPV", "likelihood ratio", "diagnostic odds ratio", "2x2", "accuracy"],
    description: "Enter the test result against the reference standard. Predictive values depend on prevalence in the sample.",
    fields: [cell("a", "Test positive, disease present (TP)", "90"), cell("b", "Test positive, disease absent (FP)", "30"), cell("c", "Test negative, disease present (FN)", "10"), cell("d", "Test negative, disease absent (TN)", "170"), CONF_FIELD],
    tableLabels: { title: "Test result versus reference standard", rows: ["Test positive", "Test negative"], cols: ["Disease present", "Disease absent"] },
    formula: "Se = TP/(TP+FN); Sp = TN/(TN+FP); PPV = TP/(TP+FP); NPV = TN/(TN+FN); LR+ = Se/(1 - Sp); LR- = (1 - Se)/Sp; DOR = (TP x TN)/(FP x FN). Proportions: Wilson intervals; ratios: log-scale intervals.",
    assumptions: ["A reference standard that is correct for everyone.", "Sampling that reflects the target population (otherwise PPV and NPV do not transfer)."],
    limitations: ["PPV and NPV apply only at the prevalence of this sample.", "Verification bias and spectrum effects are not corrected."],
    references: [REF.simel, REF.altman, REF.wilson],
    run: (n) => {
      const err = validateTable({ a: n.a, b: n.b, c: n.c, d: n.d });
      if (err) return { error: err };
      if (n.a + n.c === 0 || n.b + n.d === 0) return { error: "Both disease columns need at least one participant." };
      const r = analyzeDiagnostic({ a: n.a, b: n.b, c: n.c, d: n.d }, n.conf);
      const c = confText(n.conf);
      const notes = [NOTE];
      if (r.corrected) notes.unshift("A cell was zero, so 0.5 was added to the cells used for likelihood ratios and the diagnostic odds ratio.");
      return { headline: { label: "Sensitivity / Specificity", value: `${pct(r.sensitivity)} / ${pct(r.specificity)}` }, rows: [["Sensitivity", `${pct(r.sensitivity)} (${pctCi(r.sensitivityCi)})`], ["Specificity", `${pct(r.specificity)} (${pctCi(r.specificityCi)})`], ["Positive predictive value", `${pct(r.ppv)} (${pctCi(r.ppvCi)})`], ["Negative predictive value", `${pct(r.npv)} (${pctCi(r.npvCi)})`], ["Positive likelihood ratio", `${fmt(r.lrPositive, 2)} (${ci(r.lrPositiveCi, 2)})`], ["Negative likelihood ratio", `${fmt(r.lrNegative, 3)} (${ci(r.lrNegativeCi, 3)})`], ["Diagnostic odds ratio", `${fmt(r.dor, 1)} (${ci(r.dorCi, 1)})`], ["Accuracy", `${pct(r.accuracy)} (${pctCi(r.accuracyCi)})`], ["Prevalence in sample", `${pct(r.prevalence)} (${pctCi(r.prevalenceCi)})`]], notes, methods: `Sensitivity was ${pct(r.sensitivity)} (${c} CI ${pctCi(r.sensitivityCi)}) and specificity ${pct(r.specificity)} (${pctCi(r.specificityCi)}); PPV ${pct(r.ppv)} and NPV ${pct(r.npv)}; LR+ ${fmt(r.lrPositive, 2)} and LR− ${fmt(r.lrNegative, 2)} (Wilson and log-scale intervals).` };
    },
  },
  {
    slug: "prevalence-calculator", name: "Prevalence and Cumulative Incidence", category: "epidemiology", kind: "calculator",
    summary: "Proportion with a confidence interval, for point prevalence or cumulative incidence.",
    keywords: ["prevalence", "cumulative incidence", "risk", "proportion", "Wilson"],
    description: "Prevalence counts existing cases at one time. Cumulative incidence counts new cases among people at risk over a stated period.",
    fields: [{ id: "kind", label: "Measure", kind: "select", default: "prevalence", options: [{ value: "prevalence", label: "Point prevalence" }, { value: "incidence", label: "Cumulative incidence (risk)" }] }, { id: "x", label: "Number of cases", kind: "number", default: "42", min: 0, step: 1 }, { id: "n", label: "Population examined (or at risk at start)", kind: "number", default: "500", min: 1, step: 1 }, CONF_FIELD],
    formula: "Proportion = cases / N, with a Wilson score interval. Cumulative incidence requires everyone to be free of the outcome at the start and followed for the whole period.",
    assumptions: ["Random sample for prevalence; closed cohort with complete follow-up for cumulative incidence."],
    limitations: ["If follow-up is incomplete or varies, use an incidence rate (person-time) or survival methods instead."],
    references: [REF.rothman, REF.wilson],
    run: (n, raw) => {
      if (n.x > n.n || !Number.isInteger(n.x) || !Number.isInteger(n.n)) return { error: "Counts must be whole numbers and cases cannot exceed the total." };
      const w = wilson(n.x, n.n, n.conf);
      const label = raw.kind === "incidence" ? "Cumulative incidence" : "Prevalence";
      return { headline: { label, value: pct(n.x / n.n, 2) }, rows: [[label, pct(n.x / n.n, 2)], [`${confText(n.conf)} Wilson CI`, pctCi(w)], ["Per 1,000", fmt((n.x / n.n) * 1000, 1)], ["Per 100,000", fmt((n.x / n.n) * 100000, 0)]], notes: [NOTE], methods: `${label} was ${pct(n.x / n.n, 1)} (${n.x}/${n.n}; ${confText(n.conf)} Wilson CI ${pctCi(w)}).` };
    },
  },
  {
    slug: "incidence-rate-calculator", name: "Incidence Rate", category: "epidemiology", kind: "calculator",
    summary: "Events per person-time with an exact Poisson confidence interval.",
    keywords: ["incidence rate", "person-years", "person-time", "Poisson", "rate"],
    description: "Use this when follow-up time differs between participants. Divide events by total person-time at risk.",
    fields: [{ id: "e", label: "Number of new events", kind: "number", default: "12", min: 0, step: 1 }, { id: "pt", label: "Total person-time at risk", kind: "number", default: "3400", min: 0.0001, step: 1, help: "For example total person-years. Use the same unit for the rate." }, { id: "scale", label: "Report per", kind: "number", default: "1000", min: 1, step: 1, help: "e.g. 1000 person-years." }, CONF_FIELD],
    formula: "Rate = events / person-time. Exact (Garwood) interval: chi-square quantiles with 2d and 2(d + 1) degrees of freedom, divided by 2 x person-time.",
    assumptions: ["Events follow a Poisson process with a constant rate.", "Person-time is measured accurately."],
    limitations: ["A constant rate may not hold over long follow-up. Check by time period."],
    references: [REF.garwood, REF.rothman],
    run: (n) => {
      if (!Number.isInteger(n.e)) return { error: "Number of events must be a whole number." };
      const r = incidenceRate(n.e, n.pt, n.conf);
      const s = n.scale;
      return { headline: { label: `Rate per ${fmt(s, 0)} person-time`, value: fmt(r.rate * s, 3) }, rows: [["Events", String(n.e)], ["Person-time", fmt(n.pt, 1)], [`Rate per ${fmt(s, 0)}`, fmt(r.rate * s, 3)], [`${confText(n.conf)} exact CI`, `${fmt(r.ci.lower * s, 3)} to ${fmt(r.ci.upper * s, 3)}`]], notes: [NOTE], methods: `The incidence rate was ${fmt(r.rate * s, 2)} per ${fmt(s, 0)} person-time (${n.e} events; ${confText(n.conf)} exact Poisson CI ${fmt(r.ci.lower * s, 2)} to ${fmt(r.ci.upper * s, 2)}).` };
    },
  },
];

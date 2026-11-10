export type OutcomeKind = "continuous" | "binary" | "time" | "count" | "ordinal" | "categorical";
export type Comparison = "two" | "many" | "paired" | "single" | "association" | "descriptive";

export type SapInput = {
  design: string;
  outcomeName: string;
  outcomeKind: OutcomeKind;
  comparison: Comparison;
  groupLabel: string;
  adjust: string[];
  alpha: number;
  software: string;
  missing: "complete" | "imputation" | "none";
  secondaryCount: number;
  subgroups: string;
};

export type TestChoice = { test: string; alternative: string; effect: string; tools: { slug: string; label: string }[]; assumptions: string[]; adjusted: string };

const T = (slug: string, label: string) => ({ slug, label });

/** The usual test for an outcome type and comparison. Returns null when the combination is not meaningful. */
export function chooseTest(kind: OutcomeKind, cmp: Comparison): TestChoice | null {
  if (cmp === "descriptive") return null;
  const table: Partial<Record<OutcomeKind, Partial<Record<Comparison, TestChoice>>>> = {
    continuous: {
      two: { test: "Welch two-sample t-test", alternative: "Mann-Whitney U test if the outcome is clearly non-normal and the sample is small", effect: "Difference in means with a 95% CI", tools: [T("two-sample-t-test", "Two-sample t-test")], assumptions: ["Independent observations", "Roughly normal outcome in each group, or a reasonably large sample"], adjusted: "multiple linear regression" },
      many: { test: "One-way ANOVA with Tukey post-hoc comparisons", alternative: "Kruskal-Wallis test if clearly non-normal", effect: "Mean in each group and pairwise differences with 95% CIs", tools: [T("one-way-anova", "One-way ANOVA"), T("anova-post-hoc-tukey", "Tukey post-hoc")], assumptions: ["Independent observations", "Roughly normal residuals", "Similar variances"], adjusted: "multiple linear regression or ANCOVA" },
      paired: { test: "Paired t-test", alternative: "Wilcoxon signed-rank test if the differences are clearly non-normal", effect: "Mean difference with a 95% CI", tools: [T("paired-t-test", "Paired t-test")], assumptions: ["Pairs are independent of each other", "Differences are roughly normal"], adjusted: "a mixed-effects or repeated-measures model" },
      single: { test: "One-sample t-test", alternative: "Wilcoxon signed-rank test", effect: "Mean with a 95% CI, and the difference from the reference value", tools: [T("one-sample-t-test", "One-sample t-test")], assumptions: ["Roughly normal outcome or large sample"], adjusted: "not applicable" },
      association: { test: "Pearson correlation and simple linear regression", alternative: "Spearman rank correlation if non-linear or non-normal", effect: "Correlation coefficient or regression slope with a 95% CI", tools: [T("pearson-correlation", "Pearson correlation"), T("spearman-correlation", "Spearman"), T("simple-linear-regression", "Linear regression")], assumptions: ["Linear relationship", "Independent observations"], adjusted: "multiple linear regression" },
    },
    binary: {
      two: { test: "Chi-square test (Fisher exact test if any expected count is below 5)", alternative: "Fisher exact test", effect: "Risk ratio or odds ratio and risk difference with 95% CIs", tools: [T("chi-square-test", "Chi-square test"), T("fishers-exact-test", "Fisher exact test"), T("epidemiology-2x2-table", "2x2 table measures")], assumptions: ["Independent observations", "Expected counts of at least 5 in most cells"], adjusted: "multivariable logistic regression (or log-binomial or modified Poisson regression for a common outcome)" },
      many: { test: "Chi-square test of association (or trend test for ordered groups)", alternative: "Fisher-Freeman-Halton exact test for small counts", effect: "Proportion in each group, with odds ratios against a reference group", tools: [T("chi-square-test", "Chi-square test")], assumptions: ["Independent observations", "Adequate expected counts"], adjusted: "multivariable logistic regression" },
      paired: { test: "McNemar test", alternative: "Exact McNemar test for few discordant pairs", effect: "Difference in paired proportions, or the matched odds ratio", tools: [T("sample-size-matched-case-control", "Matched design planning")], assumptions: ["Pairs are independent of each other"], adjusted: "conditional logistic regression" },
      single: { test: "Exact or Wilson confidence interval for a proportion", alternative: "Binomial test against a reference value", effect: "Proportion with a 95% CI", tools: [T("confidence-interval-proportion", "Confidence interval for a proportion"), T("prevalence-calculator", "Prevalence")], assumptions: ["Independent observations"], adjusted: "not applicable" },
      association: { test: "Odds ratio from simple logistic regression", alternative: "Chi-square test for two categorical variables", effect: "Odds ratio with a 95% CI", tools: [T("simple-logistic-regression", "Logistic regression"), T("odds-ratio-calculator", "Odds ratio")], assumptions: ["Independent observations", "Linear logit for continuous predictors"], adjusted: "multivariable logistic regression" },
    },
    time: {
      two: { test: "Kaplan-Meier curves with a log-rank test", alternative: "Wilcoxon (Breslow) test if early differences matter more", effect: "Hazard ratio from a Cox model with a 95% CI; median survival per group", tools: [T("sample-size-survival", "Survival sample size")], assumptions: ["Independent censoring", "Proportional hazards (check with Schoenfeld residuals)"], adjusted: "Cox proportional-hazards regression" },
      many: { test: "Kaplan-Meier curves with a log-rank test across groups", alternative: "Stratified log-rank test", effect: "Hazard ratios against a reference group", tools: [], assumptions: ["Independent censoring", "Proportional hazards"], adjusted: "Cox proportional-hazards regression" },
      single: { test: "Kaplan-Meier estimate with a 95% CI", alternative: "Parametric survival model", effect: "Median survival and survival at fixed times", tools: [], assumptions: ["Independent censoring"], adjusted: "not applicable" },
      association: { test: "Cox proportional-hazards regression", alternative: "Parametric survival model", effect: "Hazard ratio per unit of the predictor", tools: [], assumptions: ["Proportional hazards", "Independent censoring"], adjusted: "multivariable Cox regression" },
    },
    count: {
      two: { test: "Poisson or negative binomial regression with person-time offset", alternative: "Exact rate-ratio test for small counts", effect: "Incidence rate ratio with a 95% CI", tools: [T("incidence-rate-calculator", "Incidence rate")], assumptions: ["Independent events", "Overdispersion checked; use negative binomial if present"], adjusted: "multivariable Poisson or negative binomial regression" },
      many: { test: "Poisson or negative binomial regression", alternative: "Kruskal-Wallis for counts without exposure time", effect: "Incidence rate ratios against a reference group", tools: [T("incidence-rate-calculator", "Incidence rate")], assumptions: ["Independent events", "Overdispersion checked"], adjusted: "multivariable count regression" },
      single: { test: "Exact Poisson interval for a rate", alternative: "Normal approximation for large counts", effect: "Rate per person-time with a 95% CI", tools: [T("incidence-rate-calculator", "Incidence rate")], assumptions: ["Constant rate"], adjusted: "not applicable" },
      association: { test: "Poisson or negative binomial regression", alternative: "Spearman correlation for counts without exposure time", effect: "Incidence rate ratio per unit", tools: [], assumptions: ["Independent events"], adjusted: "multivariable count regression" },
    },
    ordinal: {
      two: { test: "Mann-Whitney U test", alternative: "Proportional-odds (ordinal logistic) regression", effect: "Common odds ratio or median difference", tools: [], assumptions: ["Independent observations"], adjusted: "ordinal logistic regression" },
      many: { test: "Kruskal-Wallis test", alternative: "Ordinal logistic regression", effect: "Median per group", tools: [], assumptions: ["Independent observations"], adjusted: "ordinal logistic regression" },
      paired: { test: "Wilcoxon signed-rank test", alternative: "Sign test", effect: "Median of the paired differences", tools: [], assumptions: ["Pairs are independent of each other"], adjusted: "a mixed-effects ordinal model" },
      single: { test: "Wilcoxon signed-rank test against a reference", alternative: "Sign test", effect: "Median with a 95% CI", tools: [], assumptions: ["Independent observations"], adjusted: "not applicable" },
      association: { test: "Spearman rank correlation", alternative: "Kendall tau", effect: "Correlation coefficient with a 95% CI", tools: [T("spearman-correlation", "Spearman correlation")], assumptions: ["Monotonic relationship"], adjusted: "ordinal logistic regression" },
    },
    categorical: {
      two: { test: "Chi-square test of association (Fisher exact test for small counts)", alternative: "Fisher-Freeman-Halton exact test", effect: "Proportions in each category with 95% CIs", tools: [T("chi-square-test", "Chi-square test")], assumptions: ["Independent observations", "Adequate expected counts"], adjusted: "multinomial logistic regression" },
      many: { test: "Chi-square test of association", alternative: "Fisher-Freeman-Halton exact test", effect: "Proportions in each category with 95% CIs", tools: [T("chi-square-test", "Chi-square test")], assumptions: ["Independent observations", "Adequate expected counts"], adjusted: "multinomial logistic regression" },
      single: { test: "Proportion in each category with Wilson confidence intervals", alternative: "Chi-square goodness-of-fit test against expected proportions", effect: "Proportions with 95% CIs", tools: [T("confidence-interval-proportion", "Confidence interval for a proportion")], assumptions: ["Independent observations"], adjusted: "not applicable" },
      association: { test: "Chi-square test of association", alternative: "Cramer's V for strength", effect: "Cramer's V and proportions", tools: [T("chi-square-test", "Chi-square test")], assumptions: ["Independent observations"], adjusted: "multinomial logistic regression" },
    },
  };
  return table[kind]?.[cmp] ?? null;
}

const KIND_NAMES: Record<OutcomeKind, string> = { continuous: "a continuous measurement", binary: "a yes or no outcome", time: "time to an event", count: "a count of events", ordinal: "an ordered category", categorical: "an unordered category" };
const DESIGN_POP: Record<string, string> = { rct: "intention-to-treat (all randomised participants analysed as allocated); a per-protocol analysis is secondary", cohort: "all participants with the exposure recorded and at least one follow-up", "case-control": "all enrolled cases and controls with exposure data", "cross-sectional": "all participants with complete outcome data", diagnostic: "all participants who had both the index test and the reference standard" };

export function buildSap(i: SapInput): { ok: true; blocks: { title: string; text: string }[]; primary: string; warnings: string[]; tools: { slug: string; label: string }[] } | { ok: false; error: string } {
  const outcome = i.outcomeName.trim();
  if (!outcome) return { ok: false, error: "Name the primary outcome." };
  if (!(i.alpha > 0 && i.alpha < 1)) return { ok: false, error: "Significance level must be between 0 and 1." };
  const choice = chooseTest(i.outcomeKind, i.comparison);
  if (i.comparison !== "descriptive" && !choice) return { ok: false, error: `The combination "${KIND_NAMES[i.outcomeKind]}" with this comparison is not usually analysed directly. Choose a different comparison or outcome type.` };
  const warnings: string[] = [];
  const adj = i.adjust.map((a) => a.trim()).filter(Boolean);
  const group = i.groupLabel.trim() || "the comparison groups";
  const CI = `${((1 - i.alpha) * 100).toFixed(0)}%`;
  const blocks: { title: string; text: string }[] = [];

  blocks.push({ title: "Analysis population", text: `${DESIGN_POP[i.design] ?? "All participants with data on the primary outcome"}. The number screened, enrolled, excluded and analysed will be reported in a flow diagram.` });
  blocks.push({ title: "Descriptive statistics", text: "Continuous variables will be summarised as mean (SD) if roughly symmetric, otherwise median (IQR). Categorical variables will be summarised as counts and percentages. Baseline characteristics will be shown overall and by group, without significance tests for baseline differences in a randomised trial." });

  let primary = "";
  if (choice) {
    primary = `The primary outcome is ${outcome} (${KIND_NAMES[i.outcomeKind]}). It will be compared across ${group} using the ${choice.test}. The effect will be reported as ${choice.effect}. Statistical significance will be set at a two-sided α of ${i.alpha}, with ${CI} confidence intervals.`;
    blocks.push({ title: "Primary analysis", text: primary });
    blocks.push({ title: "Assumption checks", text: `Assumptions: ${choice.assumptions.join("; ")}. If they are clearly violated, the analysis will use: ${choice.alternative}.` });
    if (adj.length) blocks.push({ title: "Adjusted analysis", text: `To account for ${adj.join(", ")}, an adjusted analysis will use ${choice.adjusted}. Covariates were chosen before looking at the data, based on subject knowledge, and not by significance. The adjusted effect will be reported with its ${CI} confidence interval alongside the unadjusted effect.` });
  } else {
    primary = `${outcome} will be described (${KIND_NAMES[i.outcomeKind]}) with an appropriate summary and a ${CI} confidence interval. No hypothesis test is planned.`;
    blocks.push({ title: "Primary analysis", text: primary });
  }
  if (i.secondaryCount > 1) blocks.push({ title: "Multiple comparisons", text: `${i.secondaryCount} secondary outcomes are planned. They will be reported as exploratory with effect sizes and confidence intervals, and a correction (for example Holm or Bonferroni) will be applied if they are used to make confirmatory claims.` });
  if (i.subgroups.trim()) blocks.push({ title: "Subgroup analyses", text: `Planned subgroup analyses (${i.subgroups.trim()}) will be assessed with an interaction test and reported as exploratory, because the study is not powered for them.` });
  blocks.push({ title: "Missing data", text: i.missing === "none" ? "Little missing data is expected. The amount of missing data will be reported for each variable." : i.missing === "complete" ? "The amount of missing data will be reported. The main analysis will use complete cases. A sensitivity analysis will examine whether conclusions change under plausible assumptions about the missing values." : "The amount of missing data will be reported. Missing values will be handled by multiple imputation under a missing-at-random assumption, with a complete-case analysis as a sensitivity check." });
  blocks.push({ title: "Software", text: `Analyses will be done in ${i.software || "a recognised statistical package"}. The analysis code will be saved with the dataset.` });

  if (i.alpha > 0.1) warnings.push("A significance level above 0.10 is unusually lax. Check this is intended.");
  if (adj.length > 10) warnings.push("Many covariates risk overfitting. A common guide is about 10 outcome events (or participants per covariate for a continuous outcome).");
  if (i.design === "rct" && adj.length) warnings.push("In a randomised trial, adjust only for pre-specified covariates such as the stratification factors.");
  if (i.design === "case-control" && i.comparison === "paired") warnings.push("Matched case-control data need conditional analysis, such as conditional logistic regression.");
  if (i.comparison === "descriptive") warnings.push("No comparison was chosen. This plan describes the data but does not test a hypothesis.");
  return { ok: true, blocks, primary, warnings, tools: choice?.tools ?? [] };
}

// Deterministic test-selection guide. It reasons from the research question and design the user describes, not just variable types,
// and always returns the caveats that go with a suggestion. AI may explain a suggestion afterwards; it never chooses the test.

export type Objective = "describe" | "compare" | "relate" | "predict" | "agreement" | "diagnostic" | "survival";
export type OutcomeKind = "continuous" | "ordinal" | "binary" | "nominal" | "count" | "time_to_event";
export type WizardAnswers = {
  objective: Objective;
  outcome?: OutcomeKind;
  groups?: 1 | 2 | 3;
  paired?: boolean;
  /** Repeated measurements or clustering beyond simple pairing (e.g. patients within clinics, several visits). */
  clustered?: boolean;
  normal?: "yes" | "no" | "unsure";
  smallSample?: boolean;
  confounders?: boolean;
  /** Two or more crossed grouping factors (e.g. treatment and sex). */
  factorial?: boolean;
  design?: "rct" | "cohort" | "case_control" | "cross_sectional" | "other";
};

export type Suggestion = { method: string | null; label: string; why: string; caveats: string[]; primary: boolean };

const causal = "This is an observational comparison: it shows association, not causation, unless the design (randomisation) supports a causal reading.";

export function suggest(a: WizardAnswers): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (method: string | null, label: string, why: string, caveats: string[] = [], primary = false) => out.push({ method, label, why, caveats, primary });
  const obs = a.design && a.design !== "rct";
  if (a.clustered) {
    add(null, "Mixed-effects model or GEE", "Measurements are clustered or repeated beyond a single pair, so observations are not independent. Standard tests would give p-values that are too small.", ["Mixed models and GEE are planned for Data Studio but not yet available. Until then, summarise each cluster or subject to one value, or use specialised software.", "Do not run tests that assume independence on clustered data."], true);
    return out;
  }
  switch (a.objective) {
    case "describe":
      if (a.outcome === "continuous" || a.outcome === "count") add("describe", "Descriptive statistics", "Summarise with mean and SD if roughly symmetric, otherwise median and IQR.", ["Check the shape with a histogram or the normality check first."], true);
      else add("frequencies", "Frequency tables", "Categorical variables are summarised as counts and percentages.", [], true);
      add("table1", "Table 1 (sample characteristics)", "One publication-style table of continuous and categorical variables, overall and by group, with missing counts.", ["In a randomised trial, do not add baseline p-values (CONSORT)."]);
      add("normality", "Normality check", "Shows whether a mean and SD are adequate summaries and whether parametric tests are reasonable.");
      if (a.outcome === "continuous" && a.normal !== "yes") add("bootstrap_ci", "Bootstrap confidence interval", "A CI for the mean or median that does not rely on normality.", ["Use 2000 or more resamples; the seed is recorded so the result can be reproduced."]);
      break;
    case "compare": {
      const g = a.groups ?? 2;
      if (a.outcome === "continuous" || a.outcome === "count") {
        const nonNormal = a.normal === "no" || (a.normal === "unsure" && a.smallSample);
        if (a.outcome === "count" && !a.paired && g > 1) add("glm", "Poisson or negative binomial regression", "Counts (and rates with person-time) are compared with a count model; group is the predictor.", ["Check overdispersion: use the negative binomial model if the variance exceeds the mean.", "Add an exposure (person-time) offset when follow-up differs."], true);
        if (g === 1) add(nonNormal ? "wilcoxon" : "ttest_one", nonNormal ? "Wilcoxon signed-rank test (against a value)" : "One-sample t-test", nonNormal ? "Skewed data in a small sample: a rank-based test is safer. Create a variable equal to the test value and compare pairs." : "Compares a mean with a reference value.", [], true);
        else if (g === 2 && a.paired) {
          add(nonNormal ? "wilcoxon" : "ttest_paired", nonNormal ? "Wilcoxon signed-rank test" : "Paired t-test", "Two measurements on the same subjects.", nonNormal ? ["Assumes the differences are symmetric; the sign test (included) does not."] : ["Assumes the paired differences are roughly normal or there are many pairs."], true);
          add(nonNormal ? "ttest_paired" : "wilcoxon", nonNormal ? "Paired t-test" : "Wilcoxon signed-rank test", "Alternative to report as a sensitivity analysis.");
        } else if (g === 2) {
          add(nonNormal ? "mannwhitney" : "ttest_ind", nonNormal ? "Mann-Whitney U test" : "Independent-samples t-test (Welch)", "Two independent groups.", nonNormal ? ["Compares distributions; interpret as a median difference only if the shapes are similar."] : ["Welch's version does not assume equal variances."], true);
          add(nonNormal ? "ttest_ind" : "mannwhitney", nonNormal ? "Independent-samples t-test" : "Mann-Whitney U test", "Alternative for a sensitivity analysis.");
          if (nonNormal) add("permutation_test", "Permutation test", "Tests the mean difference without assuming normality.", ["Assumes the two groups have the same distribution under the null hypothesis."]);
        } else if (a.paired) {
          add("friedman", "Friedman test", "Three or more related measurements.", ["Repeated-measures ANOVA is not yet available in Data Studio; Friedman makes fewer assumptions."], true);
        } else {
          add(nonNormal ? "kruskal" : "anova_oneway", nonNormal ? "Kruskal-Wallis test" : "One-way ANOVA (with Welch's ANOVA)", "Three or more independent groups.", nonNormal ? ["Follow with adjusted pairwise comparisons."] : ["Use Welch's ANOVA and Games-Howell if variances differ."], true);
          add(nonNormal ? "anova_oneway" : "kruskal", nonNormal ? "One-way ANOVA" : "Kruskal-Wallis test", "Alternative for a sensitivity analysis.");
        }
        if (a.factorial && !a.paired) add("anova_factorial", "Factorial (two-way) ANOVA", "Two or more crossed grouping factors, with their interaction.", ["With unbalanced cells, report which sums of squares were used (Type III by default)."], g > 1);
        if (a.confounders && !a.paired) add("anova_factorial", "ANCOVA (adjusted group comparison)", "Compares group means adjusted for continuous covariates, with a check that slopes are equal across groups.", ["Covariates should be measured before the grouping (not affected by it)."]);
        if (a.confounders) add("linear_regression", "Linear regression (adjusted comparison)", "Adjusts the group difference for confounders.", ["Include the group variable and the confounders as predictors."]);
      } else if (a.outcome === "ordinal") {
        if (g === 2) add(a.paired ? "wilcoxon" : "mannwhitney", a.paired ? "Wilcoxon signed-rank test" : "Mann-Whitney U test", "Rank-based tests suit ordinal outcomes.", [], true);
        else add(a.paired ? "friedman" : "kruskal", a.paired ? "Friedman test" : "Kruskal-Wallis test", "Rank-based tests suit ordinal outcomes.", [], true);
        if (a.confounders && !a.paired) add("ordinal_logistic", "Ordinal logistic regression", "Adjusted comparison of an ordered outcome.", ["Check the proportional-odds assumption."]);
      } else if (a.outcome === "binary" || a.outcome === "nominal") {
        if (a.paired) add(g === 2 ? "mcnemar" : "cochran_q", g === 2 ? "McNemar test" : "Cochran's Q test", "Paired categorical outcomes.", [], true);
        else {
          add("crosstab", "Cross-tabulation with chi-square (or Fisher's exact test)", "Compares proportions between independent groups.", ["Use Fisher's exact test when expected counts are small (shown automatically for 2x2 tables)."], true);
          if (a.outcome === "binary" && g === 2) add("risk_2x2", "Risk ratio, odds ratio and risk difference", "Quantifies the size of the difference, not just whether one exists.", a.design === "case_control" ? ["In a case-control study only the odds ratio is valid."] : []);
          if (a.confounders && a.outcome === "binary") add("logistic_regression", "Logistic regression", "Adjusts for confounders.", ["Needs about 10 events per coefficient."]);
          if (a.confounders && a.outcome === "nominal") add("multinomial_logistic", "Multinomial logistic regression", "Adjusted comparison of an outcome with several unordered categories.");
          if (a.outcome === "binary" && (a.design === "cohort" || a.design === "cross_sectional")) add("standardization", "Age-standardised rates or SMR", "Compares event rates between populations with different age structures.", ["Needs events and population (or person-time) by age group."]);
          if (a.confounders && a.outcome === "binary") add("mantel_haenszel", "Stratified (Mantel-Haenszel) analysis", "Adjusts for one categorical confounder and checks for effect modification.");
        }
      } else if (a.outcome === "time_to_event") {
        add("kaplan_meier", "Kaplan-Meier curves and log-rank test", "Compares survival between groups while handling censoring.", [], true);
        if (a.confounders) add("cox", "Cox regression", "Adjusted hazard ratios.", ["Check proportional hazards."]);
      }
      if (obs) out.forEach((s) => s.caveats.push(causal));
      break;
    }
    case "relate":
      if (a.outcome === "continuous" && a.normal !== "no") add("correlation", "Pearson correlation", "Linear association between two continuous variables.", ["Inspect a scatter plot; Pearson is sensitive to outliers."], true);
      add("correlation", "Spearman or Kendall correlation", "Monotonic association; suits ordinal data, skewed data or outliers.", [], a.outcome !== "continuous" || a.normal === "no");
      if (a.confounders) add("partial_correlation", "Partial correlation", "Association after removing the effect of control variables.");
      if (a.outcome === "continuous") add("pca", "Principal component analysis", "Summarises many correlated measurements in a few components.", ["PCA describes variance; it does not test hypotheses."]);
      out.forEach((s) => s.caveats.push("Correlation does not imply causation."));
      break;
    case "predict":
      if (a.outcome === "continuous") add("linear_regression", "Multiple linear regression", "Models a continuous outcome from several predictors.", ["Check residual plots, VIF and influential points."], true);
      else if (a.outcome === "binary") add("logistic_regression", "Binary logistic regression", "Models the odds of a binary outcome.", ["About 10 events per coefficient; check for separation."], true);
      else if (a.outcome === "time_to_event") add("cox", "Cox proportional hazards regression", "Models time to an event with censoring.", ["Check the proportional hazards assumption."], true);
      else if (a.outcome === "count") add("glm", "Poisson or negative binomial regression", "Count outcomes need a count model; rates use person-time as an offset.", ["Start with Poisson and check overdispersion; switch to negative binomial (or robust SEs) if the variance exceeds the mean."], true);
      else if (a.outcome === "ordinal") add("ordinal_logistic", "Ordinal (proportional-odds) logistic regression", "Ordered categories such as severity grades or Likert items.", ["Check the proportional-odds assumption; if it fails, consider multinomial regression."], true);
      else add("multinomial_logistic", "Multinomial logistic regression", "Outcomes with three or more unordered categories.", ["Needs enough observations in every category (about 10 per predictor)."], true);
      if (a.outcome === "continuous" && a.normal === "no") add("glm", "Gamma regression (log link)", "Positive, right-skewed outcomes such as costs or lengths of stay.", ["Report ratios of means; check that the spread grows with the mean."]);
      out.forEach((s) => s.caveats.push("A model built and evaluated on the same data overstates how well it predicts new cases; validate it.", ...(obs ? [causal] : [])));
      break;
    case "agreement":
      if (a.outcome === "continuous") { add("bland_altman", "Bland-Altman analysis", "Agreement between two measurement methods on the same scale.", ["Correlation is not agreement: two methods can correlate perfectly and still disagree."], true); add("reliability", "Intraclass correlation", "Reliability across raters or occasions."); }
      else add("kappa", "Cohen's kappa", "Chance-corrected agreement between two raters on categories.", ["For ordered categories use weighted kappa."], true);
      break;
    case "diagnostic":
      if (a.outcome === "continuous") add("roc", "ROC curve and AUC", "Evaluates a continuous test against a reference standard, with sensitivity and specificity at each cutoff.", [], true);
      add("diagnostic", "Sensitivity, specificity and predictive values", "Evaluates a positive/negative test against a reference standard.", ["Predictive values depend on prevalence."], a.outcome !== "continuous");
      break;
    case "survival":
      add("kaplan_meier", "Kaplan-Meier and log-rank", "Describes and compares survival with censoring.", [], true);
      add("cox", "Cox regression", "Hazard ratios adjusted for covariates.", ["Check proportional hazards."]);
      break;
  }
  return out;
}

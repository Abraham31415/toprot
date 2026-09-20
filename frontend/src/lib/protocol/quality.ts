import type { ObjectiveRow, ObjectiveType, ProtocolVersionRow, VariableRow, VariableType } from "./types";
import type { SampleSizeInput } from "./sample-size";
import { CATEGORICAL_DESIGNS, CONTINUOUS_DESIGNS } from "./sample-size";

export const SECTION_KEYS = [
  "identity",
  "objectives",
  "population",
  "variables",
  "statistics",
  "sample_size",
  "data_collection",
  "ethics",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  identity: "Study identity",
  objectives: "Objectives",
  population: "Population",
  variables: "Variables",
  statistics: "Statistical plan",
  sample_size: "Sample size",
  data_collection: "Data collection",
  ethics: "Ethics",
};

export type SectionStatus = "consistent" | "warnings" | "incomplete";

/** Everything a quality check needs, mirrored live from each section's in-progress (not necessarily saved) state. */
export type QualitySnapshot = {
  study_title: string;
  study_design: string;
  research_question: string;
  objectives: { objective_type: ObjectiveType; description: string }[];
  target_population: string;
  setting: string;
  inclusion_criteria: string[];
  exclusion_criteria: string[];
  variables: VariableRow[];
  statistical_methods: string;
  primary_analysis: string;
  significance_level: number | null;
  sample_size_inputs: Partial<SampleSizeInput> | null;
  calculated_sample_size: number | null;
  current_enrollment: number | null;
  data_collection_methods: string;
  data_sources: string;
  data_management_plan: string;
  ethical_approval_body: string;
  consent_process: string;
};

export function buildInitialSnapshot(
  version: ProtocolVersionRow,
  objectives: ObjectiveRow[],
  variables: VariableRow[],
  currentEnrollment: number | null = null,
): QualitySnapshot {
  const sampleSizeInputs = version.sample_size_inputs as Partial<SampleSizeInput> | null;
  return {
    study_title: version.study_title ?? "",
    study_design: version.study_design ?? "",
    research_question: version.research_question ?? "",
    objectives: objectives.map((o) => ({ objective_type: o.objective_type, description: o.description })),
    target_population: version.target_population ?? "",
    setting: version.setting ?? "",
    inclusion_criteria: version.inclusion_criteria ?? [],
    exclusion_criteria: version.exclusion_criteria ?? [],
    variables,
    statistical_methods: version.statistical_methods ?? "",
    primary_analysis: version.primary_analysis ?? "",
    significance_level: version.significance_level,
    sample_size_inputs: sampleSizeInputs,
    calculated_sample_size: version.calculated_sample_size,
    current_enrollment: currentEnrollment,
    data_collection_methods: version.data_collection_methods ?? "",
    data_sources: version.data_sources ?? "",
    data_management_plan: version.data_management_plan ?? "",
    ethical_approval_body: version.ethical_approval_body ?? "",
    consent_process: version.consent_process ?? "",
  };
}

export type QualityIssue = {
  id: string;
  section: SectionKey;
  tier: 1 | 2 | 3;
  message: string;
  detail?: string;
};

const CATEGORICAL_VARIABLE_TYPES: VariableType[] = ["categorical", "binary", "ordinal"];
const CONTINUOUS_VARIABLE_TYPES: VariableType[] = ["continuous"];

// Keyword dictionaries used for the free-text cross-checks below. These are heuristic
// (substring matches on section 5's free text), not NLP -- deliberately conservative
// so they only fire on clear, named mismatches rather than guessing intent.
const CATEGORICAL_TEST_KEYWORDS = [
  "chi-square",
  "chi square",
  "chi-squared",
  "chi2",
  "fisher's exact",
  "fisher exact",
  "logistic regression",
];
const CONTINUOUS_TEST_KEYWORDS = [
  "t-test",
  "t test",
  "paired t-test",
  "anova",
  "linear regression",
  "pearson correlation",
  "pearson's correlation",
];
const SURVIVAL_KEYWORDS = [
  "survival analysis",
  "kaplan-meier",
  "kaplan meier",
  "cox regression",
  "cox proportional",
  "time-to-event",
  "time to event",
];
const CROSS_SECTIONAL_DESIGN_KEYWORDS = ["cross-sectional", "cross sectional"];

function findKeyword(haystack: string, needles: string[]): string | null {
  const lower = haystack.toLowerCase();
  return needles.find((n) => lower.includes(n)) ?? null;
}

/**
 * Tier 1: deterministic structural consistency checks. Pure function of the
 * snapshot -- no AI, no network, safe to re-run on every keystroke.
 */
export function runTier1Checks(s: QualitySnapshot): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const analysisText = `${s.statistical_methods} ${s.primary_analysis}`.trim();
  const outcomeVars = s.variables.filter((v) => v.role === "outcome");
  const covariateVars = s.variables.filter((v) => v.role === "covariate" || v.role === "exposure");

  // 1. Sample size calculated but no outcome variable declared to match it against.
  if (s.calculated_sample_size != null && outcomeVars.length === 0) {
    issues.push({
      id: "ss-no-outcome",
      section: "sample_size",
      tier: 1,
      message: "A sample size has been calculated, but no variable in Section 4 is tagged \"outcome\".",
      detail: "Tag the variable your sample size is powered to detect so the two sections stay traceable to each other.",
    });
  }

  // Outcome variable type vs. sample size design (proportions imply categorical, means imply continuous).
  const designType = s.sample_size_inputs?.design_type;
  if (designType && outcomeVars.length > 0) {
    const wantsContinuous = CONTINUOUS_DESIGNS.includes(designType);
    const wantsCategorical = CATEGORICAL_DESIGNS.includes(designType);
    for (const v of outcomeVars) {
      if (wantsContinuous && !CONTINUOUS_VARIABLE_TYPES.includes(v.variable_type)) {
        issues.push({
          id: `ss-type-${v.id}`,
          section: "sample_size",
          tier: 1,
          message: `Section 6 is powered to compare means, but outcome variable "${v.variable_name}" is ${v.variable_type}, not continuous.`,
        });
      }
      if (wantsCategorical && !CATEGORICAL_VARIABLE_TYPES.includes(v.variable_type)) {
        issues.push({
          id: `ss-type-${v.id}`,
          section: "sample_size",
          tier: 1,
          message: `Section 6 is powered to compare proportions, but outcome variable "${v.variable_name}" is ${v.variable_type}, not categorical.`,
        });
      }
    }
  }

  // 2. A declared exposure/covariate variable that the statistical plan never mentions by name.
  if (analysisText) {
    const lowerAnalysis = analysisText.toLowerCase();
    for (const v of covariateVars) {
      if (v.variable_name.trim() && !lowerAnalysis.includes(v.variable_name.toLowerCase())) {
        issues.push({
          id: `stat-unmentioned-${v.id}`,
          section: "statistics",
          tier: 1,
          message: `"${v.variable_name}" is tagged as ${v.role} in Section 4 but isn't mentioned in your statistical plan.`,
          detail: "Make sure the analysis actually accounts for every exposure/covariate you've declared.",
        });
      }
    }
  }

  // 3. Study design vs. analysis method -- e.g. cross-sectional design with survival analysis.
  if (s.study_design && analysisText) {
    const isCrossSectional = findKeyword(s.study_design, CROSS_SECTIONAL_DESIGN_KEYWORDS);
    const isSurvival = findKeyword(analysisText, SURVIVAL_KEYWORDS);
    if (isCrossSectional && isSurvival) {
      issues.push({
        id: "design-vs-analysis-survival",
        section: "statistics",
        tier: 1,
        message: "Section 1 describes a cross-sectional design, but Section 5 mentions survival/time-to-event analysis, which needs follow-up over time.",
      });
    }
  }

  // 4. Outcome variable type vs. the statistical test named in the plan.
  if (analysisText) {
    const categoricalTest = findKeyword(analysisText, CATEGORICAL_TEST_KEYWORDS);
    const continuousTest = findKeyword(analysisText, CONTINUOUS_TEST_KEYWORDS);
    for (const v of outcomeVars) {
      if (categoricalTest && !continuousTest && CONTINUOUS_VARIABLE_TYPES.includes(v.variable_type)) {
        issues.push({
          id: `test-mismatch-${v.id}`,
          section: "statistics",
          tier: 1,
          message: `Section 5 mentions "${categoricalTest}", a test for categorical data, but outcome variable "${v.variable_name}" is continuous.`,
        });
      }
      if (continuousTest && !categoricalTest && CATEGORICAL_VARIABLE_TYPES.includes(v.variable_type)) {
        issues.push({
          id: `test-mismatch-${v.id}`,
          section: "statistics",
          tier: 1,
          message: `Section 5 mentions "${continuousTest}", a test for continuous data, but outcome variable "${v.variable_name}" is ${v.variable_type}.`,
        });
      }
    }
  }

  // 5. A primary objective with no corresponding primary analysis.
  const hasPrimaryObjective = s.objectives.some((o) => o.objective_type === "primary" && o.description.trim());
  if (hasPrimaryObjective && !s.primary_analysis.trim()) {
    issues.push({
      id: "objective-no-analysis",
      section: "statistics",
      tier: 1,
      message: "Section 2 states a primary objective, but Section 5's primary analysis is still blank.",
    });
  }

  // 6. Sample size design vs. the analysis method named in the plan.
  if (designType && analysisText) {
    const categoricalTest = findKeyword(analysisText, CATEGORICAL_TEST_KEYWORDS);
    const continuousTest = findKeyword(analysisText, CONTINUOUS_TEST_KEYWORDS);
    if (CATEGORICAL_DESIGNS.includes(designType) && continuousTest && !categoricalTest) {
      issues.push({
        id: "ss-analysis-mismatch",
        section: "sample_size",
        tier: 1,
        message: `Section 6 is powered for a proportions comparison, but Section 5 describes "${continuousTest}", typically used for continuous outcomes.`,
      });
    }
    if (CONTINUOUS_DESIGNS.includes(designType) && categoricalTest && !continuousTest) {
      issues.push({
        id: "ss-analysis-mismatch",
        section: "sample_size",
        tier: 1,
        message: `Section 6 is powered for a means comparison, but Section 5 describes "${categoricalTest}", typically used for categorical outcomes.`,
      });
    }
  }

  // 7. Variables declared but no data collection method specified.
  if (s.variables.length > 0 && !s.data_collection_methods.trim()) {
    issues.push({
      id: "no-data-collection-method",
      section: "data_collection",
      tier: 1,
      message: `You've declared ${s.variables.length} variable${s.variables.length === 1 ? "" : "s"}, but Section 7 doesn't say how data will be collected.`,
    });
  }

  return issues;
}

const MISSING_DATA_KEYWORDS = [
  "missing data",
  "missing value",
  "imputation",
  "complete case",
  "complete-case",
  "listwise deletion",
  "multiple imputation",
];

/** A rough overall outcome prevalence, for rule-of-thumb power calculations only. */
function estimateOutcomeProportion(inputs: Partial<SampleSizeInput> | null): number | null {
  if (!inputs) return null;
  if (inputs.design_type === "single_proportion" && inputs.expected_proportion != null) {
    return inputs.expected_proportion;
  }
  if (
    inputs.design_type === "two_proportions" &&
    inputs.proportion_group1 != null &&
    inputs.proportion_group2 != null
  ) {
    return (inputs.proportion_group1 + inputs.proportion_group2) / 2;
  }
  if (inputs.design_type === "cross_sectional_or" && inputs.baseline_proportion != null && inputs.odds_ratio != null) {
    const p0 = inputs.baseline_proportion;
    const p1 = (inputs.odds_ratio * p0) / (1 - p0 + inputs.odds_ratio * p0);
    return (p0 + p1) / 2;
  }
  if (inputs.design_type === "cohort_rr" && inputs.baseline_proportion != null && inputs.relative_risk != null) {
    const p0 = inputs.baseline_proportion;
    const p1 = p0 * inputs.relative_risk;
    return (p0 + p1) / 2;
  }
  return null;
}

/**
 * Tier 2: published statistical rules of thumb, run on the numbers the student
 * entered. Still deterministic (formulas, not AI) -- each warning names the
 * rule and threshold so it's educational, not just a red flag.
 */
export function runTier2Checks(s: QualitySnapshot): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const analysisText = `${s.statistical_methods} ${s.primary_analysis}`.trim();
  const lowerAnalysis = analysisText.toLowerCase();
  const predictorCount = s.variables.filter((v) => v.role === "covariate" || v.role === "exposure").length;
  const n = s.calculated_sample_size;
  const inputs = s.sample_size_inputs;

  // Events per variable for logistic regression (Peduzzi et al., 1996: >=10 events per predictor).
  if (lowerAnalysis.includes("logistic regression") && n != null && predictorCount > 0) {
    const proportion = estimateOutcomeProportion(inputs);
    if (proportion != null) {
      const impliedEvents = n * proportion;
      const epv = impliedEvents / predictorCount;
      if (epv < 10) {
        issues.push({
          id: "epv-logistic",
          section: "statistics",
          tier: 2,
          message: `About ${epv.toFixed(1)} events per variable for your logistic regression (≈${Math.round(impliedEvents)} expected events ÷ ${predictorCount} predictors). Published guidance recommends at least 10 events per predictor (Peduzzi et al., 1996).`,
          detail: "Consider reducing the number of predictors or increasing your sample size.",
        });
      }
    }
  }

  // Subjects per predictor for linear regression (common guidance: ~10-15 per predictor).
  if (lowerAnalysis.includes("linear regression") && n != null && predictorCount > 0) {
    const perPredictor = n / predictorCount;
    if (perPredictor < 15) {
      issues.push({
        id: "spp-linear",
        section: "statistics",
        tier: 2,
        message: `About ${perPredictor.toFixed(1)} subjects per predictor for your linear regression (${n} ÷ ${predictorCount}). Common guidance recommends at least 10-15 subjects per predictor.`,
      });
    }
  }

  // Chi-square: warn if expected cell counts in a 2x2 table are likely under 5.
  const usesChiSquare = ["chi-square", "chi square", "chi-squared", "chi2"].some((k) => lowerAnalysis.includes(k));
  if (usesChiSquare && inputs?.design_type === "two_proportions" && n != null) {
    const nPerGroup = n / 2;
    const p1 = inputs.proportion_group1 ?? 0.5;
    const p2 = inputs.proportion_group2 ?? 0.5;
    const expectedCells = [nPerGroup * p1, nPerGroup * (1 - p1), nPerGroup * p2, nPerGroup * (1 - p2)];
    if (expectedCells.some((c) => c < 5)) {
      issues.push({
        id: "chi-square-small-cells",
        section: "sample_size",
        tier: 2,
        message: "At least one expected cell count in your 2x2 table is likely under 5, based on your planned group sizes and proportions. The chi-square approximation is unreliable below that; consider Fisher's exact test instead.",
      });
    }
  }

  // Achieved vs. planned enrollment.
  if (n != null && s.current_enrollment != null && s.current_enrollment > 0 && s.current_enrollment < n) {
    const pctOfTarget = Math.round((s.current_enrollment / n) * 100);
    issues.push({
      id: "enrollment-below-target",
      section: "sample_size",
      tier: 2,
      message: `Current enrollment (${s.current_enrollment}) is ${pctOfTarget}% of your calculated sample size (${n}). Falling short of target reduces your power to detect the effect you planned for.`,
    });
  }

  // Missing-data handling.
  if (s.statistical_methods.trim() && !MISSING_DATA_KEYWORDS.some((k) => lowerAnalysis.includes(k))) {
    issues.push({
      id: "missing-data-not-addressed",
      section: "statistics",
      tier: 2,
      message: "Your statistical plan doesn't say how missing data will be handled (e.g. complete-case analysis, multiple imputation).",
    });
  }

  return issues;
}

function sectionHasContent(key: SectionKey, s: QualitySnapshot): boolean {
  switch (key) {
    case "identity":
      return !!(s.study_title.trim() && s.study_design.trim());
    case "objectives":
      return !!(s.research_question.trim() && s.objectives.some((o) => o.description.trim()));
    case "population":
      return !!(
        s.target_population.trim() &&
        (s.inclusion_criteria.some((c) => c.trim()) || s.exclusion_criteria.some((c) => c.trim()))
      );
    case "variables":
      return s.variables.length > 0;
    case "statistics":
      return !!(s.statistical_methods.trim() && s.primary_analysis.trim());
    case "sample_size":
      return s.calculated_sample_size != null;
    case "data_collection":
      return !!s.data_collection_methods.trim();
    case "ethics":
      return !!(s.ethical_approval_body.trim() && s.consent_process.trim());
  }
}

export function sectionStatus(key: SectionKey, snapshot: QualitySnapshot, issues: QualityIssue[]): SectionStatus {
  if (!sectionHasContent(key, snapshot)) return "incomplete";
  if (issues.some((i) => i.section === key)) return "warnings";
  return "consistent";
}

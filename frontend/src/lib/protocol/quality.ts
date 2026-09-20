import type { ObjectiveRow, ObjectiveType, ProtocolVersionRow, VariableRow, VariableType } from "./types";
import type { DesignType } from "./sample-size";

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
  sample_size_design_type: DesignType | null;
  calculated_sample_size: number | null;
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
): QualitySnapshot {
  const sampleSizeInputs = version.sample_size_inputs as { design_type?: DesignType } | null;
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
    sample_size_design_type: sampleSizeInputs?.design_type ?? null,
    calculated_sample_size: version.calculated_sample_size,
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

const CATEGORICAL_SAMPLE_SIZE_DESIGNS: DesignType[] = ["single_proportion", "two_proportions"];
const CONTINUOUS_SAMPLE_SIZE_DESIGNS: DesignType[] = ["two_means"];

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
  if (s.sample_size_design_type && outcomeVars.length > 0) {
    const wantsContinuous = CONTINUOUS_SAMPLE_SIZE_DESIGNS.includes(s.sample_size_design_type);
    const wantsCategorical = CATEGORICAL_SAMPLE_SIZE_DESIGNS.includes(s.sample_size_design_type);
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
  if (s.sample_size_design_type && analysisText) {
    const categoricalTest = findKeyword(analysisText, CATEGORICAL_TEST_KEYWORDS);
    const continuousTest = findKeyword(analysisText, CONTINUOUS_TEST_KEYWORDS);
    if (
      CATEGORICAL_SAMPLE_SIZE_DESIGNS.includes(s.sample_size_design_type) &&
      continuousTest &&
      !categoricalTest
    ) {
      issues.push({
        id: "ss-analysis-mismatch",
        section: "sample_size",
        tier: 1,
        message: `Section 6 is powered for a proportions comparison, but Section 5 describes "${continuousTest}", typically used for continuous outcomes.`,
      });
    }
    if (
      CONTINUOUS_SAMPLE_SIZE_DESIGNS.includes(s.sample_size_design_type) &&
      categoricalTest &&
      !continuousTest
    ) {
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

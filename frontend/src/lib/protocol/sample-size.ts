export type DesignType =
  | "single_proportion"
  | "single_mean"
  | "two_proportions"
  | "two_means"
  | "paired_means"
  | "correlation"
  | "sensitivity_specificity"
  | "cross_sectional_or"
  | "cohort_rr";

export type SampleSizeInput = {
  design_type: DesignType;
  confidence_level: number;
  power: number;
  dropout_rate: number;
  population_size?: number;

  expected_proportion?: number;
  margin_of_error?: number;

  proportion_group1?: number;
  proportion_group2?: number;

  mean_difference?: number;
  standard_deviation?: number;

  expected_correlation?: number;

  expected_sensitivity?: number;
  expected_specificity?: number;
  disease_prevalence?: number;

  baseline_proportion?: number;
  odds_ratio?: number;
  relative_risk?: number;
};

export type StressTestCell = { label: string; value: number };

export type SampleSizeResult = {
  n_before_dropout: number;
  n_total: number;
  n_per_group: number | null;
  stress_test: {
    effect_label: string;
    dropout_label: string;
    rows: StressTestCell[];
    columns: StressTestCell[];
    grid: number[][];
  };
  formula_label: string;
  citation: string;
};

export const DESIGN_TYPE_LABELS: Record<DesignType, string> = {
  single_proportion: "Single proportion (prevalence)",
  single_mean: "Single mean",
  two_proportions: "Two proportions (comparing groups)",
  two_means: "Two means (comparing groups)",
  paired_means: "Paired means (before/after, matched pairs)",
  correlation: "Correlation coefficient",
  sensitivity_specificity: "Sensitivity / specificity (diagnostic accuracy)",
  cross_sectional_or: "Cross-sectional analytic (odds ratio)",
  cohort_rr: "Cohort (relative risk)",
};

/** Designs whose outcome is naturally categorical (proportions-based). */
export const CATEGORICAL_DESIGNS: DesignType[] = [
  "single_proportion",
  "two_proportions",
  "sensitivity_specificity",
  "cross_sectional_or",
  "cohort_rr",
];

/** Designs whose outcome is naturally continuous (means-based). */
export const CONTINUOUS_DESIGNS: DesignType[] = ["single_mean", "two_means", "paired_means", "correlation"];

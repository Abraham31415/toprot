export type DesignType = "single_proportion" | "two_proportions" | "two_means";

export type SampleSizeInput = {
  design_type: DesignType;
  confidence_level: number;
  power: number;
  dropout_rate: number;
  expected_proportion?: number;
  margin_of_error?: number;
  proportion_group1?: number;
  proportion_group2?: number;
  mean_difference?: number;
  standard_deviation?: number;
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
};

export const DESIGN_TYPE_LABELS: Record<DesignType, string> = {
  single_proportion: "Single proportion (prevalence)",
  two_proportions: "Two proportions (comparing groups)",
  two_means: "Two means (comparing groups)",
};

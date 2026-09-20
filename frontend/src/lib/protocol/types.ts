export type ProtocolStatus = "draft" | "registered" | "superseded";

export type VariableType =
  | "continuous"
  | "categorical"
  | "binary"
  | "ordinal"
  | "date"
  | "text";

export type VariableRole = "exposure" | "outcome" | "covariate" | "identifier" | "other";

export type ObjectiveType = "primary" | "secondary";

export type ProtocolVersionRow = {
  id: string;
  study_id: string;
  version_number: number;
  status: ProtocolStatus;

  study_title: string | null;
  short_title: string | null;
  study_design: string | null;
  site: string | null;
  principal_investigator_name: string | null;
  anticipated_start_date: string | null;
  anticipated_end_date: string | null;

  research_question: string | null;

  target_population: string | null;
  setting: string | null;
  inclusion_criteria: string[];
  exclusion_criteria: string[];

  statistical_methods: string | null;
  primary_analysis: string | null;
  significance_level: number | null;
  analysis_software: string | null;

  sample_size_method: string | null;
  sample_size_inputs: Record<string, unknown> | null;
  calculated_sample_size: number | null;
  stress_test_results: unknown | null;

  data_collection_methods: string | null;
  data_sources: string | null;
  data_management_plan: string | null;

  ethical_approval_body: string | null;
  consent_process: string | null;
  risks_and_benefits: string | null;
  confidentiality_plan: string | null;
};

export type ObjectiveRow = {
  id: string;
  objective_type: ObjectiveType;
  description: string;
  display_order: number;
};

export type VariableRow = {
  id: string;
  variable_name: string;
  variable_slug: string;
  variable_type: VariableType;
  role: VariableRole;
  unit: string | null;
  value_labels: Record<string, string> | null;
  measurement_timepoint: string | null;
  description: string | null;
  display_order: number;
};

export const VARIABLE_TYPES: VariableType[] = [
  "continuous",
  "categorical",
  "binary",
  "ordinal",
  "date",
  "text",
];

export const VARIABLE_ROLES: VariableRole[] = [
  "exposure",
  "outcome",
  "covariate",
  "identifier",
  "other",
];

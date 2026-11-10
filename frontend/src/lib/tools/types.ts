export type FieldOption = { value: string; label: string };

export type Field = {
  id: string;
  label: string;
  kind: "number" | "select" | "textarea" | "rows";
  default: string;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: FieldOption[];
  placeholder?: string;
  /** For kind "textarea": visible rows. */
  rows?: number;
  /** For kind "rows": the columns of a repeating table. The value is stored as a JSON array of objects. */
  columns?: { id: string; label: string; kind: "text" | "select"; options?: FieldOption[]; placeholder?: string }[];
  /** For kind "rows": a starting set of rows, as JSON. */
  /** Only show this field when the predicate returns true for the current values. */
  showIf?: { id: string; equals: string };
};

/** Protocol text fields a builder may append to. Research question is set only when empty. */
export type ProtocolTextField =
  | "research_question" | "study_design" | "target_population" | "setting" | "statistical_methods" | "primary_analysis"
  | "data_collection_methods" | "data_sources" | "data_management_plan" | "consent_process"
  | "risks_and_benefits" | "confidentiality_plan";

export type ApplyVariable = {
  variable_name: string;
  variable_type: "continuous" | "categorical" | "binary" | "ordinal" | "date" | "text";
  role: "exposure" | "outcome" | "covariate" | "identifier" | "other";
  unit?: string | null;
  measurement_timepoint?: string | null;
  description?: string | null;
};

/** A change a builder can make to a study's draft protocol. Applied on the server after recomputation. */
export type ApplyAction =
  | { kind: "text"; label: string; field: ProtocolTextField; text: string }
  | { kind: "list"; label: string; field: "inclusion_criteria" | "exclusion_criteria"; items: string[] }
  | { kind: "objectives"; label: string; items: { objective_type: "primary" | "secondary"; description: string }[] }
  | { kind: "variables"; label: string; items: ApplyVariable[] }
  | { kind: "timeline"; label: string; start?: string; end?: string; milestones: { milestone_type: string; target_date: string }[] };

export type ResultBlock = { title: string; text: string };

export type ToolResult = {
  error?: string;
  headline?: { label: string; value: string };
  rows?: [string, string][];
  table?: { head: string[]; rows: string[][] };
  steps?: string[];
  notes?: string[];
  /** Copy-ready methodology / results sentence. */
  methods?: string;
  /** Longer generated documents, each shown with a copy button. */
  blocks?: ResultBlock[];
  /** Ways to put this result into the protocol. Each is recomputed on the server before it is applied. */
  apply?: ApplyAction[];
};

export type ToolCategory =
  | "sample-size"
  | "statistical"
  | "epidemiology"
  | "study-design"
  | "literature"
  | "writing"
  | "data-collection"
  | "reporting";

export const CATEGORIES: { id: ToolCategory; name: string; blurb: string }[] = [
  { id: "sample-size", name: "Sample Size and Power", blurb: "Plan how many participants you need." },
  { id: "statistical", name: "Statistical Calculators", blurb: "Tests, intervals and models." },
  { id: "epidemiology", name: "Epidemiology", blurb: "Risk, odds and diagnostic accuracy." },
  { id: "study-design", name: "Study Design", blurb: "Structure a protocol." },
  { id: "literature", name: "Literature and References", blurb: "Find and organise sources." },
  { id: "writing", name: "Academic Writing", blurb: "Draft and cite." },
  { id: "data-collection", name: "Data Collection", blurb: "Instruments and dictionaries." },
  { id: "reporting", name: "Research Reporting", blurb: "Track and report." },
];

export type ToolMeta = {
  slug: string;
  name: string;
  category: ToolCategory;
  summary: string;
  keywords: string[];
  /** calculator: runs in the page. workspace: lives inside a study (account needed). planned: not built. */
  kind: "calculator" | "workspace" | "planned" | "external";
  href?: string;
};

export type Calculator = ToolMeta & {
  kind: "calculator";
  description: string;
  fields: Field[];
  /** Optional 2x2 layout for fields a, b, c, d. */
  tableLabels?: { rows: [string, string]; cols: [string, string]; title: string };
  formula: string;
  /** Heading for the formula panel. Defaults to "Formula"; builders use "How it works". */
  formulaLabel?: string;
  assumptions: string[];
  limitations: string[];
  references: string[];
  /** `n` holds every visible number field already parsed and range-checked; `raw` holds the original text. */
  run: (n: Record<string, number>, raw: Record<string, string>) => ToolResult;
};

export type OutputType =
  | "data_dictionary"
  | "kobo_form"
  | "redcap_form"
  | "stata_skeleton"
  | "table_shells"
  | "methods_paragraph"
  | "ethics_package"
  | "consent_form";

export const OUTPUT_LABELS: Record<OutputType, string> = {
  data_dictionary: "Data dictionary",
  kobo_form: "KoBo form",
  redcap_form: "REDCap form",
  stata_skeleton: "Stata skeleton",
  table_shells: "Table shells",
  methods_paragraph: "Methods paragraph",
  ethics_package: "Ethics package",
  consent_form: "Consent form",
};

export const IMPLEMENTED_OUTPUTS: OutputType[] = [
  "data_dictionary",
  "kobo_form",
  "redcap_form",
  "stata_skeleton",
  "table_shells",
  "methods_paragraph",
  "ethics_package",
  "consent_form",
];

export const OUTPUT_ORDER: OutputType[] = [
  "data_dictionary",
  "kobo_form",
  "redcap_form",
  "stata_skeleton",
  "table_shells",
  "methods_paragraph",
  "ethics_package",
  "consent_form",
];

/** What each generated file is, for the documents screen. Formats match the document service. */
export const OUTPUT_INFO: Record<OutputType, { format: string; description: string }> = {
  data_dictionary: { format: "Word (.docx)", description: "Every variable with its type, role, unit and measurement timepoint, from your Variables section." },
  kobo_form: { format: "Excel (.xlsx, XLSForm)", description: "A KoBo Toolbox form built from your variables. Variables with value labels become select questions." },
  redcap_form: { format: "CSV (REDCap data dictionary)", description: "A REDCap data dictionary built from your variables, ready to upload when creating a project." },
  stata_skeleton: { format: "Stata do-file (.do)", description: "A skeleton script for loading and labelling your dataset, to extend with your own analysis." },
  table_shells: { format: "Word (.docx)", description: "Empty results tables laid out from your objectives and analysis plan." },
  methods_paragraph: { format: "Word (.docx)", description: "A draft methods paragraph summarising your design, population, sample size and analysis." },
  ethics_package: { format: "Word (.docx)", description: "Draft ethics submission documents assembled from your protocol." },
  consent_form: { format: "Word (.docx)", description: "A draft participant information and consent form from your protocol." },
};

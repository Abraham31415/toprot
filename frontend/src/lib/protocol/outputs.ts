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

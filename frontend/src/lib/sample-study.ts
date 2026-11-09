// Entirely fictional demonstration study. No real patients, sites or data.

export const SAMPLE_STUDY = {
  title: "Anaemia in Pregnancy at Riverbend District Clinics (fictional sample)",
  design: "Cross-sectional",
  researchQuestion:
    "What proportion of pregnant women attending antenatal clinics in the fictional Riverbend District have anaemia, and which factors are associated with it?",
  objectives: [
    { type: "Primary", text: "To estimate the prevalence of anaemia among pregnant women attending antenatal clinics in Riverbend District." },
    { type: "Secondary", text: "To assess the association between anaemia and parity, gestational age, and iron supplement use." },
  ],
  protocolSections: [
    { name: "Study identity", note: "Title, design, research question, setting." },
    { name: "Objectives", note: "One primary and one secondary objective." },
    { name: "Study population", note: "Pregnant women attending antenatal care; inclusion and exclusion criteria." },
    { name: "Variables", note: "Outcome, exposures and covariates with types and roles." },
    { name: "Sample size", note: "Single proportion, 95% confidence, 5% precision, expected prevalence 40%, 10% dropout." },
    { name: "Statistical analysis", note: "Prevalence with 95% CI; logistic regression for associated factors." },
    { name: "Data collection", note: "Interviewer-administered questionnaire and haemoglobin measurement." },
    { name: "Ethics", note: "Informed consent; approval from a fictional institutional review board." },
  ],
  inclusion: ["Pregnant women aged 15 years or older", "Attending antenatal care at a participating clinic", "Provided written informed consent"],
  exclusion: ["Known sickle cell disease", "Received a blood transfusion in the last 3 months"],
  sampleSize: { design: "Single proportion (prevalence)", confidence: "95%", precision: "5%", expected: "40%", dropout: "10%", result: 410 },
  variables: [
    { name: "anaemia", label: "Anaemia (Hb below 11.0 g/dL)", type: "Binary (0 = No, 1 = Yes)", role: "Outcome" },
    { name: "hb_gdl", label: "Haemoglobin (g/dL)", type: "Continuous", role: "Measurement used to define outcome" },
    { name: "age_years", label: "Age in completed years", type: "Continuous", role: "Covariate" },
    { name: "parity", label: "Number of previous births", type: "Integer", role: "Exposure" },
    { name: "gest_weeks", label: "Gestational age (weeks)", type: "Continuous", role: "Exposure" },
    { name: "iron_use", label: "Takes iron supplements", type: "Binary (0 = No, 1 = Yes)", role: "Exposure" },
  ],
  references: [
    "Illustrative reference 1 (fictional placeholder). Example A, Example B. Anaemia thresholds in pregnancy. Journal of Example Studies. 2020;1(1):1-10.",
    "Illustrative reference 2 (fictional placeholder). Example C. Sample size for prevalence surveys. Example Methods Review. 2019;2(3):11-20.",
  ],
  tableShells: [
    {
      title: "Table 1. Participant characteristics",
      columns: ["Characteristic", "n", "%"],
      rows: ["Age group (years)", "Parity", "Gestational age (weeks)", "Iron supplement use"],
    },
    {
      title: "Table 2. Prevalence of anaemia",
      columns: ["Outcome", "n / N", "Prevalence (95% CI)"],
      rows: ["Anaemia (Hb below 11.0 g/dL)"],
    },
  ],
} as const;

/** CSV text for the downloadable sample data dictionary. */
export function sampleDataDictionaryCsv(): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [["variable_name", "label", "type", "role"].join(",")];
  for (const v of SAMPLE_STUDY.variables) lines.push([v.name, v.label, v.type, v.role].map(esc).join(","));
  return lines.join("\r\n") + "\r\n";
}

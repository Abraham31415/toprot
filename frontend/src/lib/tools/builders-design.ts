import { FRAMEWORK_LABELS, buildResearchQuestion, type Framework, type OutcomeType } from "../builders/research-question";
import { CRITERIA_CATEGORIES, CATEGORY_PROMPTS, buildCriteria, type CriteriaRow } from "../builders/criteria";
import { MEASURE_OPTIONS, ROLE_OPTIONS, classifyVariables, definitionsText, type VarRow } from "../builders/variables";
import type { Calculator } from "./types";

const NOTE = "These builders apply rules and templates. They do not judge whether your question or design is scientifically sound. Discuss the result with your supervisor.";

export function parseRows<T extends Record<string, string>>(raw: string | undefined, columns: (keyof T)[]): T[] | string {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return "The table could not be read."; }
  if (!Array.isArray(data) || data.length > 100) return "The table is not valid or has too many rows.";
  return data.map((row) => {
    const o: Record<string, string> = {};
    for (const c of columns) o[c as string] = typeof (row as Record<string, unknown>)?.[c as string] === "string" ? ((row as Record<string, string>)[c as string]).slice(0, 2000) : "";
    return o as T;
  });
}

const REF = {
  richardson: "Richardson WS, Wilson MC, Nishikawa J, Hayward RS. The well-built clinical question: a key to evidence-based decisions. ACP J Club. 1995;123(3):A12-13.",
  sackett: "Sackett DL, Rosenberg WMC, Gray JAM, Haynes RB, Richardson WS. Evidence based medicine: what it is and what it isn't. BMJ. 1996;312:71-72.",
  morgan: "Morgan RL, Whaley P, Thayer KA, Schunemann HJ. Identifying the PECO: a framework for formulating good questions to explore the association of environmental and other exposures with health outcomes. Environ Int. 2018;121:1027-1031.",
  hulley: "Hulley SB, Cummings SR, Browner WS, Grady DG, Newman TB. Designing Clinical Research. 4th ed. Philadelphia: Lippincott Williams & Wilkins; 2013.",
  rothman: "Rothman KJ, Greenland S, Lash TL. Modern Epidemiology. 3rd ed. Philadelphia: Lippincott Williams & Wilkins; 2008.",
  stevens: "Stevens SS. On the theory of scales of measurement. Science. 1946;103(2684):677-680.",
};

const txt = (id: string, label: string, def: string, help?: string) => ({ id, label, kind: "textarea" as const, default: def, help, rows: 2 });

export const DESIGN_BUILDERS: Calculator[] = [
  {
    slug: "research-question-builder", name: "Research Question Builder (PICO, PICOT, PECO)", category: "study-design", kind: "calculator", formulaLabel: "How it works",
    summary: "Turn PICO, PICOT or PECO parts into a research question, objectives, hypotheses and variables.",
    keywords: ["PICO", "PICOT", "PECO", "research question", "objectives", "hypotheses", "exposure", "outcome", "variables", "FINER"],
    description: "Fill in the parts of your question. The builder assembles the question, a primary and specific objectives, null and alternative hypotheses, and the exposure and outcome variables, and flags vague wording. You can add the result to your protocol.",
    fields: [
      { id: "framework", label: "Framework", kind: "select", default: "pico", options: (Object.keys(FRAMEWORK_LABELS) as Framework[]).map((k) => ({ value: k, label: FRAMEWORK_LABELS[k].name })), help: "PICO or PICOT for questions about an intervention; PECO for questions about exposures and risk factors." },
      txt("population", "Population (P)", "Children aged 6 to 59 months attending outpatient clinics", "Who are the participants? Include age group, condition and setting level."),
      txt("exposure", "Intervention (I) or exposure (E)", "Vitamin A supplementation", "What is being given, or what are people exposed to?"),
      txt("comparator", "Comparison (C)", "No supplementation", "What it is compared with. Leave blank only for a purely descriptive question."),
      txt("outcome", "Outcome (O)", "Incidence of severe diarrhoea", "One primary outcome, stated as something measurable."),
      { id: "outcomeType", label: "Outcome is measured as", kind: "select", default: "binary", options: [{ value: "binary", label: "Yes or no (event occurs or not)" }, { value: "continuous", label: "A number (continuous)" }, { value: "categorical", label: "Categories" }] },
      { ...txt("timeframe", "Time frame (T)", "12 months of follow-up", "PICOT only. How long until the outcome is assessed?"), showIf: { id: "framework", equals: "picot" } },
      txt("setting", "Setting (optional)", "Mulago National Referral Hospital, Kampala", "Place or level of care."),
      txt("covariates", "Covariates to consider (one per line, optional)", "Age\nSex\nNutritional status", "Factors that could confound or modify the result."),
    ],
    formula: "The question follows the chosen framework's template (Richardson et al., 1995; Morgan et al., 2018). Objectives and hypotheses are generated from the same parts, and a wording check flags vague terms, a missing comparator, several outcomes in one, and a missing setting or time frame. Nothing is sent to an AI service.",
    assumptions: ["You supply scientifically meaningful parts. The builder cannot judge whether the question is important, feasible or ethical.", "One primary outcome per question."],
    limitations: ["Templates produce clear but plain wording. Edit the result for style.", "Qualitative and prevalence questions often do not fit PICO. For those, write the question directly and use the Study Design Assistant."],
    references: [REF.richardson, REF.sackett, REF.morgan, REF.hulley],
    run: (_n, raw) => {
      const r = buildResearchQuestion({
        framework: raw.framework as Framework, population: raw.population ?? "", exposure: raw.exposure ?? "", comparator: raw.comparator ?? "",
        outcome: raw.outcome ?? "", timeframe: raw.timeframe ?? "", setting: raw.setting ?? "", outcomeType: (raw.outcomeType as OutcomeType) ?? "binary",
        covariates: (raw.covariates ?? "").split(/\n/),
      });
      if (!r.ok) return { error: r.error };
      const o = r.out;
      const objectives = [{ objective_type: "primary" as const, description: o.primaryObjective }, ...o.specificObjectives.map((d) => ({ objective_type: "secondary" as const, description: d }))];
      const popText = [raw.population?.trim(), raw.setting?.trim() ? `Setting: ${raw.setting.trim()}` : ""].filter(Boolean).join(". ");
      return {
        headline: { label: "Research question", value: o.question },
        blocks: [
          { title: "Research question", text: o.question },
          { title: "Primary objective", text: o.primaryObjective },
          { title: "Specific objectives", text: o.specificObjectives.map((s, i) => `${i + 1}. ${s}`).join("\n") },
          { title: "Hypotheses", text: `Null hypothesis (H0): ${o.nullHypothesis}\nAlternative hypothesis (H1): ${o.alternativeHypothesis}` },
        ],
        table: { head: ["Variable", "Role", "Type"], rows: o.variables.map((v) => [v.name, v.role, v.type]) },
        notes: [...o.warnings, "Variable types are suggestions. Review them in the protocol.", NOTE],
        methods: o.question,
        apply: [
          { kind: "text", label: "Set the research question", field: "research_question", text: o.question },
          { kind: "text", label: "Add population to Target population", field: "target_population", text: popText },
          { kind: "objectives", label: "Add objectives", items: objectives },
          { kind: "variables", label: "Add variables", items: o.variables.map((v) => ({ variable_name: v.name, variable_type: v.type, role: v.role, description: v.description })) },
        ],
      };
    },
  },
  {
    slug: "eligibility-criteria-builder", name: "Inclusion and Exclusion Criteria Builder", category: "study-design", kind: "calculator", formulaLabel: "How it works",
    summary: "Build a clean, de-duplicated eligibility list with checks for gaps and contradictions.",
    keywords: ["inclusion criteria", "exclusion criteria", "eligibility", "selection", "participants"],
    description: "List each criterion with its type and category. The builder orders them, removes duplicates, flags criteria that appear on both lists, and reminds you of common gaps such as age, setting and consent.",
    fields: [
      {
        id: "rows", label: "Criteria", kind: "rows", default: JSON.stringify([
          { type: "inclusion", category: "age", text: "Aged 6 to 59 months" },
          { type: "inclusion", category: "setting", text: "Attending the outpatient department between January and June 2027" },
          { type: "inclusion", category: "consent", text: "Parent or guardian gives written informed consent" },
          { type: "exclusion", category: "clinical", text: "Severe acute malnutrition requiring admission" },
        ]),
        columns: [
          { id: "type", label: "Type", kind: "select", options: [{ value: "inclusion", label: "Inclusion" }, { value: "exclusion", label: "Exclusion" }] },
          { id: "category", label: "Category", kind: "select", options: CRITERIA_CATEGORIES },
          { id: "text", label: "Criterion", kind: "text", placeholder: "e.g. Aged 18 years or older" },
        ],
        help: "Write each criterion so that two different people would apply it the same way.",
      },
    ],
    formula: "Criteria are ordered by category, normalised for capitalisation and punctuation, and de-duplicated. A criterion appearing as both inclusion and exclusion, an open-ended phrase (such as 'etc'), or no entry for age, condition, setting or consent triggers a warning.",
    assumptions: ["Each criterion is something that can be checked at enrolment."],
    limitations: ["Checks are text-based. They cannot tell whether criteria are clinically sensible or biased.", "Overly narrow criteria limit generalisability, which this tool does not measure."],
    references: [REF.hulley, REF.rothman],
    run: (_n, raw) => {
      const rows = parseRows<CriteriaRow>(raw.rows, ["type", "category", "text"]);
      if (typeof rows === "string") return { error: rows };
      const r = buildCriteria(rows);
      if (!r.ok) return { error: r.error };
      return {
        headline: { label: "Criteria", value: `${r.inclusion.length} inclusion, ${r.exclusion.length} exclusion` },
        blocks: [
          { title: "Inclusion criteria", text: r.inclusion.map((s, i) => `${i + 1}. ${s}`).join("\n") || "None" },
          { title: "Exclusion criteria", text: r.exclusion.map((s, i) => `${i + 1}. ${s}`).join("\n") || "None" },
        ],
        notes: [...r.warnings, NOTE],
        methods: `Inclusion criteria: ${r.inclusion.join("; ")}. Exclusion criteria: ${r.exclusion.join("; ")}.`,
        apply: [
          ...(r.inclusion.length ? [{ kind: "list" as const, label: "Add inclusion criteria", field: "inclusion_criteria" as const, items: r.inclusion }] : []),
          ...(r.exclusion.length ? [{ kind: "list" as const, label: "Add exclusion criteria", field: "exclusion_criteria" as const, items: r.exclusion }] : []),
        ],
      };
    },
  },
  {
    slug: "variables-and-definitions-builder", name: "Variables and Operational Definitions", category: "study-design", kind: "calculator", formulaLabel: "How it works",
    summary: "Classify variables, define exposure and outcome operationally, and see the matching summary statistics and tests.",
    keywords: ["variables", "operational definitions", "variable classification", "measurement scale", "exposure definition", "outcome definition", "nominal ordinal continuous"],
    description: "List your variables and say what kind of measurement each is. The builder classifies them (continuous, categorical, binary, ordinal, date), shows the usual summary and comparison methods, checks that exposure and outcome have operational definitions, and can add the variables and definitions to your protocol.",
    fields: [
      {
        id: "rows", label: "Variables", kind: "rows", default: JSON.stringify([
          { name: "Severe diarrhoea", role: "outcome", measure: "yesno", definition: "Three or more loose stools in 24 hours with dehydration requiring admission", source: "Clinic record review", unit: "", timepoint: "Within 12 months" },
          { name: "Vitamin A supplementation", role: "exposure", measure: "yesno", definition: "Received at least one dose in the past 6 months, confirmed on the child health card", source: "Child health card", unit: "", timepoint: "Baseline" },
          { name: "Age", role: "covariate", measure: "number", definition: "Age in completed months at enrolment", source: "Birth record", unit: "months", timepoint: "Baseline" },
        ]),
        columns: [
          { id: "name", label: "Variable", kind: "text", placeholder: "e.g. Haemoglobin" },
          { id: "role", label: "Role", kind: "select", options: ROLE_OPTIONS },
          { id: "measure", label: "Measured as", kind: "select", options: MEASURE_OPTIONS },
          { id: "definition", label: "Operational definition", kind: "text", placeholder: "Exactly how it is defined and measured" },
          { id: "source", label: "Instrument or source", kind: "text" },
          { id: "unit", label: "Unit or cut-off", kind: "text" },
          { id: "timepoint", label: "When measured", kind: "text" },
        ],
      },
    ],
    formula: "Each variable's measurement kind sets its type (number → continuous, category → categorical, yes or no → binary, ordered → ordinal) and measurement scale (Stevens, 1946), with the usual summary and comparison methods. Warnings flag a missing outcome, an exposure or outcome without an operational definition, a number without a unit, and duplicate names.",
    assumptions: ["The measurement kind you choose is how the data will actually be collected."],
    limitations: ["The suggested tests are starting points. The right test depends on the design, sample size and distribution.", "An ordinal or categorical variable turned into a number loses information, and a number grouped into categories loses power."],
    references: [REF.stevens, REF.hulley, REF.rothman],
    run: (_n, raw) => {
      const rows = parseRows<VarRow>(raw.rows, ["name", "role", "measure", "definition", "source", "unit", "timepoint"]);
      if (typeof rows === "string") return { error: rows };
      const r = classifyVariables(rows);
      if (!r.ok) return { error: r.error };
      const defText = definitionsText(r.items);
      return {
        headline: { label: "Variables", value: String(r.items.length) },
        table: { head: ["Variable", "Role", "Type", "Scale", "Usual summary", "Usual comparison"], rows: r.items.map((i) => [i.name, i.role, i.type, i.scale, i.summary, i.compare]) },
        blocks: [{ title: "Operational definitions", text: defText }],
        notes: [...r.warnings, NOTE],
        methods: defText,
        apply: [
          { kind: "variables", label: "Add variables", items: r.items.map((i) => ({ variable_name: i.name, variable_type: i.type, role: i.role, unit: i.unit || null, measurement_timepoint: i.timepoint || null, description: [i.definition, i.source ? `Source: ${i.source}` : ""].filter(Boolean).join(". ") || null })) },
          { kind: "text", label: "Add definitions to Data collection methods", field: "data_collection_methods", text: defText },
        ],
      };
    },
  },
];

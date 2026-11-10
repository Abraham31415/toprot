import { DICT_TYPES, MILESTONE_CHOICES, QTYPES, buildConsent, buildDictionary, buildQuestionnaire, buildTimeline, codebookCsv, questionnaireText, type ConsentInput, type DictRow, type PhaseRow, type QRow } from "../builders/instruments";
import { parseRows } from "./builders-design";
import type { Calculator, Field } from "./types";

const NOTE = "These tools use templates and fixed rules. They do not check scientific validity, and your ethics committee's requirements come first.";
const REF = {
  oppenheim: "Oppenheim AN. Questionnaire Design, Interviewing and Attitude Measurement. London: Continuum; 1992.",
  dillman: "Dillman DA, Smyth JD, Christian LM. Internet, Phone, Mail, and Mixed-Mode Surveys: The Tailored Design Method. 4th ed. Hoboken: Wiley; 2014.",
  cdisc: "Clinical Data Interchange Standards Consortium. CDISC Define-XML and data dictionary conventions. cdisc.org.",
  hulley: "Hulley SB, Cummings SR, Browner WS, Grady DG, Newman TB. Designing Clinical Research. 4th ed. Philadelphia: Lippincott Williams & Wilkins; 2013.",
  cioms: "Council for International Organizations of Medical Sciences. International Ethical Guidelines for Health-related Research Involving Humans. Geneva: CIOMS; 2016.",
  helsinki: "World Medical Association. Declaration of Helsinki: ethical principles for medical research involving human subjects. JAMA. 2013;310(20):2191-2194.",
};
const txt = (id: string, label: string, def: string, help?: string, showIf?: Field["showIf"]): Field => ({ id, label, kind: "textarea", default: def, help, rows: 2, showIf });
const YESNO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

export const INSTRUMENT_BUILDERS: Calculator[] = [
  {
    slug: "questionnaire-builder", name: "Questionnaire Builder", category: "data-collection", kind: "calculator", formulaLabel: "How it works",
    summary: "Write questions with answer types, check them for common wording problems, and export a printable form and codebook.",
    keywords: ["questionnaire", "survey", "data collection instrument", "Likert", "codebook", "double-barrelled", "leading question"],
    description: "Enter your questions, choose how each is answered, and group them into sections. The builder numbers them, gives each a variable name, checks for double-barrelled or leading wording, and produces a printable questionnaire, a codebook (CSV) and variables for your protocol.",
    fields: [{
      id: "rows", label: "Questions", kind: "rows", default: JSON.stringify([
        { section: "About you", text: "What is your age", type: "number", options: "", required: "yes", unit: "years" },
        { section: "About you", text: "What is your sex", type: "single", options: "Female; Male", required: "yes", unit: "" },
        { section: "Health", text: "Have you had diarrhoea in the past two weeks", type: "yesno", options: "", required: "yes", unit: "" },
        { section: "Health", text: "The clinic staff explained my treatment clearly", type: "scale", options: "", required: "yes", unit: "" },
      ]),
      columns: [
        { id: "section", label: "Section", kind: "text", placeholder: "e.g. About you" },
        { id: "text", label: "Question", kind: "text", placeholder: "Write one question" },
        { id: "type", label: "Answer type", kind: "select", options: QTYPES.map((t) => ({ value: t.value, label: t.label })) },
        { id: "options", label: "Answer options (separate with ;)", kind: "text", placeholder: "Used for choose-one and choose-all" },
        { id: "required", label: "Required", kind: "select", options: YESNO },
        { id: "unit", label: "Unit (numbers)", kind: "text" },
      ],
    }],
    formula: "Questions are numbered in order. Choice questions need at least two distinct options. Yes or no and agreement-scale questions get fixed answer lists. Wording checks flag questions that contain 'and' or 'or' (possible double-barrelled), leading phrases, absolutes such as 'always' or 'never', numbers without a unit, and very long questions.",
    assumptions: ["Questions are written in the language and at the reading level of the respondents."],
    limitations: ["The checks look at wording patterns only. A questionnaire still needs expert review and a pilot test.", "Skip logic and translations are not built in. For electronic collection use a tool such as KoBoToolbox or REDCap, which can be generated from your protocol in the study's Documents tab."],
    references: [REF.oppenheim, REF.dillman, REF.hulley],
    run: (_n, raw) => {
      const rows = parseRows<QRow>(raw.rows, ["section", "text", "type", "options", "required", "unit"]);
      if (typeof rows === "string") return { error: rows };
      const r = buildQuestionnaire(rows);
      if (!r.ok) return { error: r.error };
      const sections = [...new Set(r.questions.map((q) => q.section).filter(Boolean))];
      return {
        headline: { label: "Questions", value: String(r.questions.length) },
        table: { head: ["Variable", "Question", "Type", "Required"], rows: r.questions.map((q) => [q.variable, q.text, q.varType, q.required ? "yes" : "no"]) },
        blocks: [{ title: "Questionnaire", text: questionnaireText(r.questions) }],
        csv: { filename: "codebook.csv", content: codebookCsv(r.questions) },
        notes: [...r.warnings, NOTE],
        methods: `Data will be collected with a structured questionnaire of ${r.questions.length} questions${sections.length ? ` covering ${sections.join(", ").toLowerCase()}` : ""}. The questionnaire will be pilot-tested before use.`,
        apply: [
          { kind: "variables", label: "Add questions as variables", items: r.questions.map((q) => ({ variable_name: q.variable, variable_type: q.varType as "categorical", role: "other" as const, unit: q.unit || null, description: `${q.text}${q.options.length ? ` Options: ${q.options.join("; ")}.` : ""}` })) },
          { kind: "text", label: "Add to Data collection methods", field: "data_collection_methods", text: `Data will be collected with a structured questionnaire of ${r.questions.length} questions${sections.length ? ` covering ${sections.join(", ").toLowerCase()}` : ""}. The questionnaire will be pilot-tested before use.` },
        ],
      };
    },
  },
  {
    slug: "data-dictionary-builder", name: "Data Dictionary Builder", category: "data-collection", kind: "calculator", formulaLabel: "How it works",
    summary: "Define each variable's name, type, allowed values, unit and plausible range, and export a CSV data dictionary.",
    keywords: ["data dictionary", "codebook", "variable names", "coding", "plausible range", "data management"],
    description: "A data dictionary says exactly what each column in your dataset means. Enter each variable and the builder creates clean variable names, checks for gaps, and exports a CSV you can keep with your dataset.",
    fields: [{
      id: "rows", label: "Variables", kind: "rows", default: JSON.stringify([
        { name: "Participant ID", label: "Unique study code", type: "text", values: "", unit: "", range: "", required: "yes", source: "Assigned at enrolment" },
        { name: "Age", label: "Age in completed years", type: "continuous", values: "", unit: "years", range: "0 to 120", required: "yes", source: "Questionnaire" },
        { name: "Sex", label: "Sex at birth", type: "categorical", values: "1=Female; 2=Male", unit: "", range: "", required: "yes", source: "Questionnaire" },
      ]),
      columns: [
        { id: "name", label: "Variable", kind: "text", placeholder: "e.g. Haemoglobin" },
        { id: "label", label: "Label (plain description)", kind: "text" },
        { id: "type", label: "Type", kind: "select", options: DICT_TYPES },
        { id: "values", label: "Allowed values with codes", kind: "text", placeholder: "1=Yes; 0=No" },
        { id: "unit", label: "Unit", kind: "text" },
        { id: "range", label: "Plausible range", kind: "text", placeholder: "0 to 120" },
        { id: "required", label: "Required", kind: "select", options: YESNO },
        { id: "source", label: "Source", kind: "text" },
      ],
    }],
    formula: "Each name becomes a short, lower-case variable name with underscores, made unique if repeated. Categorical and ordinal variables need coded values; numbers need a unit and a plausible range of the form 'min to max'.",
    assumptions: ["Variable names will be used consistently in the dataset."],
    limitations: ["It documents variables. It does not check actual data. Run range and consistency checks in your statistics software.", "To generate a dictionary from the variables already in your protocol, use the study's Documents tab."],
    references: [REF.cdisc, REF.hulley],
    run: (_n, raw) => {
      const rows = parseRows<DictRow>(raw.rows, ["name", "label", "type", "values", "unit", "range", "required", "source"]);
      if (typeof rows === "string") return { error: rows };
      const r = buildDictionary(rows);
      if (!r.ok) return { error: r.error };
      const typeMap: Record<string, "continuous" | "categorical" | "binary" | "ordinal" | "date" | "text"> = { continuous: "continuous", categorical: "categorical", binary: "binary", ordinal: "ordinal", date: "date", text: "text" };
      return {
        headline: { label: "Variables", value: String(r.entries.length) },
        table: { head: ["Variable", "Label", "Type", "Values", "Unit", "Range"], rows: r.entries.map((e) => [e.slug, e.label, e.type, e.values, e.unit, e.range]) },
        csv: { filename: "data-dictionary.csv", content: r.csv },
        notes: [...r.warnings, NOTE],
        methods: `A data dictionary defines ${r.entries.length} variables with their types, allowed values, units and plausible ranges. Data will be entered and checked against it.`,
        apply: [{ kind: "variables", label: "Add variables", items: r.entries.map((e) => ({ variable_name: e.name, variable_type: typeMap[e.type] ?? "text", role: "other" as const, unit: e.unit || null, description: [e.label, e.values && `Values: ${e.values}`, e.range && `Range: ${e.range}`, e.source && `Source: ${e.source}`].filter(Boolean).join(". ") })) }],
      };
    },
  },
  {
    slug: "research-timeline-builder", name: "Research Timeline Builder", category: "reporting", kind: "calculator", formulaLabel: "How it works",
    summary: "Lay out project phases with dates, check the order, and set your milestone target dates.",
    keywords: ["timeline", "Gantt", "schedule", "milestones", "project plan", "research plan"],
    description: "Enter a start date and the phases of your project with their length in weeks. The builder calculates start and end dates, checks the order (for example no recruitment before ethics approval), and can set your study's milestone target dates and start and end dates.",
    fields: [
      { id: "start", label: "Project start date", kind: "date", default: "2027-02-01" },
      {
        id: "rows", label: "Phases", kind: "rows", default: JSON.stringify([
          { name: "Write the protocol", weeks: "8", start: "after", milestone: "protocol_written" },
          { name: "Ethics submission and review", weeks: "10", start: "after", milestone: "ethics_approved" },
          { name: "Recruit participants and collect data", weeks: "16", start: "after", milestone: "enrollment_started" },
          { name: "Clean and analyse data", weeks: "8", start: "after", milestone: "analysis_complete" },
          { name: "Write the report or manuscript", weeks: "10", start: "after", milestone: "manuscript_drafted" },
        ]),
        columns: [
          { id: "name", label: "Phase", kind: "text" },
          { id: "weeks", label: "Weeks", kind: "text", placeholder: "e.g. 8" },
          { id: "start", label: "Starts", kind: "select", options: [{ value: "after", label: "After the previous phase" }, { value: "with", label: "With the previous phase" }] },
          { id: "milestone", label: "Matches milestone", kind: "select", options: MILESTONE_CHOICES },
        ],
      },
    ],
    formula: "Each phase starts the day after the previous one ends (or with it, if chosen). End = start + weeks x 7 days - 1 day. The project ends when the last phase ends. A milestone takes the phase's end date, except 'enrollment started', which takes the phase's start date.",
    assumptions: ["Phases are sequential unless marked as running together.", "Durations are realistic. Ethics review and recruitment commonly run late."],
    limitations: ["Does not model holidays, resource limits or dependencies other than order.", "Only the first phase attached to a milestone sets its date."],
    references: [REF.hulley],
    run: (_n, raw) => {
      const rows = parseRows<PhaseRow>(raw.rows, ["name", "weeks", "start", "milestone"]);
      if (typeof rows === "string") return { error: rows };
      const r = buildTimeline(raw.start ?? "", rows);
      if (!r.ok) return { error: r.error };
      const first = r.phases[0].start;
      return {
        headline: { label: "Project finishes", value: `${r.endDate} (${r.totalWeeks} weeks)` },
        table: { head: ["Phase", "Start", "End", "Weeks", "Milestone"], rows: r.phases.map((p) => [p.name, p.start, p.end, String(p.weeks), p.milestone ? p.milestone.replace(/_/g, " ") : ""]) },
        notes: [...r.warnings, NOTE],
        methods: `The study will run from ${first} to ${r.endDate} (${r.totalWeeks} weeks) in ${r.phases.length} phases: ${r.phases.map((p) => `${p.name.toLowerCase()} (${p.start} to ${p.end})`).join("; ")}.`,
        apply: [{ kind: "timeline", label: "Set study dates and milestone targets", start: first, end: r.endDate, milestones: r.milestones }],
      };
    },
  },
  {
    slug: "consent-ethics-template-builder", name: "Consent and Ethics Template Builder", category: "study-design", kind: "calculator", formulaLabel: "How it works",
    summary: "Draft a participant information and consent form (adult, or parent permission with child assent) with the standard elements.",
    keywords: ["consent form", "informed consent", "participant information sheet", "assent", "ethics", "confidentiality", "risks and benefits"],
    description: "Fill in the details of your study. The builder writes a plain-language participant information sheet and consent form containing the standard elements (purpose, procedures, risks, benefits, privacy, voluntariness, contacts and signatures), marks anything missing as [ADD: ...], and can add short consent, risk and confidentiality paragraphs to your protocol.",
    fields: [
      { id: "kind", label: "Form", kind: "select", default: "adult", options: [{ value: "adult", label: "Adult participant" }, { value: "child", label: "Child: parent or guardian permission and child assent" }] },
      txt("title", "Study title", "Vitamin A supplementation and diarrhoea in children under five"),
      txt("researcher", "Researcher name", "Nduhukire Abraham"),
      txt("institution", "Institution", "Makerere University"),
      txt("contact", "Researcher contact", "Phone and email of the researcher"),
      txt("committeeContact", "Ethics committee contact (optional)", "", "Name, phone and email of the committee that approves the study."),
      txt("ageRange", "Children's age range", "6 to 59 months", undefined, { id: "kind", equals: "child" }),
      txt("purpose", "Purpose, in plain language", "We want to find out whether a vitamin supplement helps protect young children from severe diarrhoea."),
      txt("procedures", "What participants will do", "We will ask some questions about your child, record their weight and height, and review their clinic card."),
      txt("duration", "How long it takes", "about 30 minutes today, and a phone call after 6 months"),
      txt("risks", "Possible risks or discomforts", "There are no medical risks from the questions. Some people may find questions about illness upsetting. The visit takes your time."),
      txt("benefits", "Possible benefits", "There may be no direct benefit to you. The results may help improve care for children."),
      txt("compensation", "Payment or costs", "You will not be paid. Your transport will be refunded."),
      txt("confidentiality", "How information is kept private", "Your information will be recorded under a study code, not your name, and kept in a locked cabinet and a password-protected computer."),
    ],
    formula: "A fixed template with the standard elements of informed consent (CIOMS 2016; Declaration of Helsinki). Your answers are placed into each section. Anything you leave blank is replaced by an [ADD: ...] marker so nothing is invented, and the checker flags 'no risk' claims.",
    assumptions: ["You will translate and test the form with a few members of the community.", "Your ethics committee's template and rules take precedence over this one."],
    limitations: ["This is a draft template. It is not legal or ethical approval, and it does not know local law.", "It does not cover special cases such as waiver of consent, emergency research, illiterate participants' witness requirements or recorded interviews. Check what your committee requires."],
    references: [REF.cioms, REF.helsinki],
    run: (_n, raw) => {
      const input: ConsentInput = {
        kind: raw.kind === "child" ? "child" : "adult", title: raw.title ?? "", researcher: raw.researcher ?? "", institution: raw.institution ?? "", contact: raw.contact ?? "", committeeContact: raw.committeeContact ?? "",
        purpose: raw.purpose ?? "", procedures: raw.procedures ?? "", duration: raw.duration ?? "", risks: raw.risks ?? "", benefits: raw.benefits ?? "", compensation: raw.compensation ?? "", confidentiality: raw.confidentiality ?? "", ageRange: raw.ageRange ?? "", language: "",
      };
      const r = buildConsent(input);
      if (!r.ok) return { error: r.error };
      return {
        headline: { label: "Template", value: r.missing.length ? `Draft with ${r.missing.length} item${r.missing.length === 1 ? "" : "s"} to add` : "Complete draft" },
        blocks: [{ title: "Complete document", text: r.document }, ...r.sections.map((s) => ({ title: s.title, text: s.text }))],
        notes: [...r.warnings, NOTE],
        methods: r.paragraphs.consent,
        apply: [
          { kind: "text", label: "Add consent process", field: "consent_process", text: r.paragraphs.consent },
          { kind: "text", label: "Add risks and benefits", field: "risks_and_benefits", text: r.paragraphs.risks },
          { kind: "text", label: "Add confidentiality plan", field: "confidentiality_plan", text: r.paragraphs.confidentiality },
        ],
      };
    },
  },
];

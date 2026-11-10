import { DESIGNS, recommendDesigns, type DesignAnswers, type DesignId } from "../builders/designs";
import { METHOD_NAMES, adviseSampling, type SamplingAnswers } from "../builders/sampling";
import { buildSap, type Comparison, type OutcomeKind } from "../builders/sap";
import type { Calculator, Field } from "./types";

const NOTE = "This is decision support built on fixed rules. It does not replace judgement, your supervisor, or a statistician.";
const REF = {
  hulley: "Hulley SB, Cummings SR, Browner WS, Grady DG, Newman TB. Designing Clinical Research. 4th ed. Philadelphia: Lippincott Williams & Wilkins; 2013.",
  grimes: "Grimes DA, Schulz KF. An overview of clinical research: the lay of the land. Lancet. 2002;359(9300):57-61.",
  strobe: "von Elm E, Altman DG, Egger M, Pocock SJ, Gotzsche PC, Vandenbroucke JP. The Strengthening the Reporting of Observational Studies in Epidemiology (STROBE) statement. Lancet. 2007;370(9596):1453-1457.",
  consort: "Schulz KF, Altman DG, Moher D. CONSORT 2010 statement: updated guidelines for reporting parallel group randomised trials. BMJ. 2010;340:c332.",
  stard: "Bossuyt PM, Reitsma JB, Bruns DE, et al. STARD 2015: an updated list of essential items for reporting diagnostic accuracy studies. BMJ. 2015;351:h5527.",
  prisma: "Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ. 2021;372:n71.",
  tong: "Tong A, Sainsbury P, Craig J. Consolidated criteria for reporting qualitative research (COREQ): a 32-item checklist for interviews and focus groups. Int J Qual Health Care. 2007;19(6):349-357.",
  creswell: "Creswell JW, Plano Clark VL. Designing and Conducting Mixed Methods Research. 3rd ed. Thousand Oaks: SAGE; 2018.",
  kish: "Kish L. Survey Sampling. New York: Wiley; 1965.",
  lwanga: "Lwanga SK, Lemeshow S. Sample Size Determination in Health Studies: A Practical Manual. Geneva: World Health Organization; 1991.",
  patton: "Patton MQ. Qualitative Research and Evaluation Methods. 4th ed. Thousand Oaks: SAGE; 2015.",
  ich: "ICH E9. Statistical Principles for Clinical Trials. International Conference on Harmonisation; 1998.",
  altman: "Altman DG, Machin D, Bryant TN, Gardner MJ. Statistics with Confidence. 2nd ed. Bristol: BMJ Books; 2000.",
};

const sel = (id: string, label: string, def: string, options: [string, string][], help?: string, showIf?: Field["showIf"]): Field => ({
  id, label, kind: "select", default: def, options: options.map(([value, label]) => ({ value, label })), help, showIf,
});

export const METHOD_BUILDERS: Calculator[] = [
  {
    slug: "study-design-assistant", name: "Study Design Assistant", category: "study-design", kind: "calculator", formulaLabel: "How it works",
    summary: "Compare cross-sectional, case-control, cohort, trial, diagnostic, qualitative, mixed-methods and review designs for your aim.",
    keywords: ["study design", "cross-sectional", "case-control", "cohort", "randomised trial", "diagnostic accuracy", "qualitative", "mixed methods", "systematic review", "which design"],
    description: "Answer five questions about your aim and constraints. The assistant scores eight designs with fixed, visible rules, and shows each design's strengths, limitations, typical biases, reporting guideline and the calculators to use next.",
    fields: [
      sel("aim", "What do you mainly want to find out?", "risk", [["describe", "How common something is (prevalence) and its characteristics"], ["cause", "Whether an intervention works"], ["risk", "What is associated with, or causes, an outcome"], ["diagnostic", "How well a test identifies a disease"], ["experience", "People's experiences, views and reasons"], ["both", "Both how much and why (numbers and experiences)"], ["synthesize", "What existing studies show"]]),
      sel("assign", "Can you assign the intervention to participants?", "yes", [["yes", "Yes, ethically and practically"], ["no", "No, it already happens or cannot be assigned"]], "A randomised trial needs this.", { id: "aim", equals: "cause" }),
      sel("outcome", "How common is the outcome?", "common", [["common", "Common (more than a few percent)"], ["rare", "Rare (well under one percent, or long latency)"]]),
      sel("followup", "How long can you follow participants?", "long", [["short", "Short (a few months or less)"], ["long", "Long (a year or more is possible)"]]),
      sel("resources", "What are your time and funding?", "limited", [["limited", "Limited (a student project, small budget)"], ["adequate", "Adequate (funded team, longer timeline)"]]),
    ],
    formula: "Each design gets a base score for how well it answers your aim, then points are added or removed for outcome frequency, follow-up time and resources. Every change is listed with its reason. A trial is excluded if you cannot assign the intervention. Scores above 5 are a strong fit, 3 to 5 possible, below 3 weak.",
    assumptions: ["Your answers describe your real situation.", "One main aim. If you have several, run the assistant for each."],
    limitations: ["The rules are a simplification. Real choices also depend on ethics, data access, setting and your team's skills.", "Hybrid and quasi-experimental designs are not scored."],
    references: [REF.hulley, REF.grimes, REF.strobe, REF.consort],
    run: (_n, raw) => {
      const a: DesignAnswers = { aim: raw.aim as DesignAnswers["aim"], assign: (raw.assign as DesignAnswers["assign"]) ?? "yes", outcome: raw.outcome as DesignAnswers["outcome"], followup: raw.followup as DesignAnswers["followup"], resources: raw.resources as DesignAnswers["resources"] };
      const ranked = recommendDesigns(a);
      const top = ranked[0];
      if (!top || top.fit === "Not suitable") return { error: "No design fits these answers. If you cannot assign an intervention, choose an observational aim such as 'what is associated with an outcome'." };
      const topN = ranked.filter((r) => r.fit !== "Not suitable").slice(0, 3);
      const blocks = topN.map((r) => {
        const d = DESIGNS[r.id];
        const tools = d.sampleSizeTools.length ? `\nSample size: ${d.sampleSizeTools.map((t) => `${t.label} (/tools/${t.slug})`).join("; ")}` : "\nSample size: not a fixed number. Qualitative work uses information power or saturation.";
        return { title: `${d.name}: ${r.fit}`, text: `Answers: ${d.answers}\nWhy: ${r.reasons.join(" ")}\nStrengths: ${d.strengths.join(" ")}\nLimitations: ${d.limitations.join(" ")}\nCommon biases: ${d.biases.join("; ")}.\nReport with: ${d.guideline}.${tools}` };
      });
      return {
        headline: { label: "Best-fitting design", value: `${DESIGNS[top.id].name} (${top.fit})` },
        table: { head: ["Design", "Fit", "Points"], rows: ranked.map((r) => [DESIGNS[r.id].name, r.fit, r.blocked ? "excluded" : String(r.points)]) },
        blocks,
        notes: [NOTE],
        methods: `A ${DESIGNS[top.id].name.toLowerCase()} was chosen because ${top.reasons[0].replace(/ \(\+\d+\)\.$/, "").replace(/^Suits your aim to /, "the aim is to ")}. The study will be reported according to ${DESIGNS[top.id].guideline}.`,
        apply: [{ kind: "text", label: "Set study design", field: "study_design", text: DESIGNS[top.id].name }],
      };
    },
  },
  {
    slug: "sampling-strategy-assistant", name: "Sampling Strategy Assistant", category: "study-design", kind: "calculator", formulaLabel: "How it works",
    summary: "Choose a sampling method for your frame, population and aim, with steps, biases and a methods paragraph.",
    keywords: ["sampling", "random sampling", "stratified", "cluster", "systematic", "purposive", "snowball", "consecutive", "convenience", "sampling frame"],
    description: "Say what you want to estimate and what you know about your population. The assistant recommends a sampling method, explains the choice, lists the steps and likely biases, writes a methods paragraph, and points to the matching sample size tools.",
    fields: [
      sel("purpose", "Purpose", "estimate", [["estimate", "Estimate a prevalence or mean for a population"], ["compare", "Compare groups"], ["explore", "Explore experiences (qualitative)"]]),
      sel("representative", "Must the results represent a wider population?", "yes", [["yes", "Yes"], ["no", "No, results apply to the setting only"]], undefined, undefined),
      sel("frame", "Do you have a complete list of eligible people (a sampling frame)?", "yes", [["yes", "Yes"], ["no", "No (but there may be a list of villages, schools or wards)"]]),
      sel("groups", "Is the population made up of distinct subgroups that matter?", "uniform", [["uniform", "No, fairly uniform"], ["subgroups", "Yes (for example regions, sex or age bands)"]]),
      sel("spread", "How spread out is the population?", "compact", [["compact", "Compact (one facility or town)"], ["scattered", "Scattered over a wide area"]]),
      { id: "population", label: "Population", kind: "textarea", default: "Women aged 15 to 49 years in Kampala district", rows: 2 },
      { id: "n", label: "Planned sample size (0 if not yet known)", kind: "number", default: "0", min: 0, step: 1 },
    ],
    formula: "Rules in order: exploring experiences gives purposive sampling; no need for representativeness gives consecutive or convenience sampling; a full list with a compact uniform population gives simple random sampling, with subgroups gives stratified; a list over a wide area gives systematic or stratified; no list gives cluster or multistage sampling.",
    assumptions: ["Your answers about the frame and the population are accurate."],
    limitations: ["Probability sampling needs a good frame and field effort. Where that is not possible, state the limits of generalisation.", "Sampling choice affects the sample size through design effects. Use the linked tools."],
    references: [REF.kish, REF.lwanga, REF.patton],
    run: (n, raw) => {
      const a: SamplingAnswers = { purpose: raw.purpose as SamplingAnswers["purpose"], representative: raw.purpose === "explore" ? "no" : (raw.representative as SamplingAnswers["representative"]), frame: raw.frame as SamplingAnswers["frame"], groups: raw.groups as SamplingAnswers["groups"], spread: raw.spread as SamplingAnswers["spread"], population: raw.population ?? "", sampleSize: n.n };
      const r = adviseSampling(a);
      return {
        headline: { label: "Recommended sampling method", value: METHOD_NAMES[r.primary] },
        blocks: [
          { title: "Why this method", text: r.why.join(" ") + (r.alternatives.length ? "\nAlternatives: " + r.alternatives.map((x) => `${METHOD_NAMES[x.method]} (${x.why})`).join(" ") : "") },
          { title: "Steps", text: r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") },
          { title: "Likely biases and limits", text: r.biases.map((b) => `- ${b}`).join("\n") },
          ...(r.tools.length ? [{ title: "Next: sample size tools", text: r.tools.map((t) => `${t.label} (/tools/${t.slug})`).join("\n") }] : []),
        ],
        notes: [NOTE],
        methods: r.methodsText,
        apply: [{ kind: "text", label: "Add sampling to Target population", field: "target_population", text: `Sampling: ${r.methodsText}` }],
      };
    },
  },
  {
    slug: "statistical-analysis-plan-generator", name: "Statistical Analysis Plan Generator", category: "statistical", kind: "calculator", formulaLabel: "How it works",
    summary: "Generate an analysis plan with the right test for your outcome and comparison, assumptions and fallbacks.",
    keywords: ["statistical analysis plan", "SAP", "analysis plan", "test selection", "which test", "primary analysis", "missing data", "multiplicity"],
    description: "Describe your design, primary outcome and comparison. The generator picks the usual test from a fixed table, and writes the analysis population, descriptive statistics, primary and adjusted analysis, assumption checks, missing data, multiplicity and software sections. You can add it to your protocol.",
    fields: [
      sel("design", "Study design", "cohort", [["cross-sectional", "Cross-sectional"], ["case-control", "Case-control"], ["cohort", "Cohort"], ["rct", "Randomised trial"], ["diagnostic", "Diagnostic accuracy"], ["other", "Other"]]),
      { id: "outcomeName", label: "Primary outcome", kind: "textarea", default: "Incidence of severe diarrhoea", rows: 2 },
      sel("outcomeKind", "The outcome is", "binary", [["binary", "Yes or no"], ["continuous", "A continuous measurement"], ["time", "Time to an event"], ["count", "A count of events"], ["ordinal", "An ordered category"], ["categorical", "An unordered category"]]),
      sel("comparison", "The main comparison is", "two", [["two", "Two independent groups"], ["many", "Three or more groups"], ["paired", "Paired or before and after"], ["single", "One group against a reference value"], ["association", "Association with a continuous predictor"], ["descriptive", "None, descriptive only"]]),
      { id: "groupLabel", label: "Groups being compared (optional)", kind: "textarea", default: "supplemented and unsupplemented children", rows: 2 },
      { id: "adjust", label: "Covariates to adjust for (one per line, optional)", kind: "textarea", default: "Age\nSex\nNutritional status", rows: 3 },
      { id: "alpha", label: "Significance level (two-sided)", kind: "number", default: "0.05", min: 0.001, max: 0.5, step: 0.005 },
      sel("software", "Software", "Stata", [["Stata", "Stata"], ["R", "R"], ["SPSS", "SPSS"], ["Python", "Python"], ["Excel", "Excel"]]),
      sel("missing", "Missing data", "complete", [["none", "Little expected"], ["complete", "Complete cases with a sensitivity analysis"], ["imputation", "Multiple imputation"]]),
      { id: "secondary", label: "Number of secondary outcomes", kind: "number", default: "2", min: 0, max: 50, step: 1 },
      { id: "subgroups", label: "Planned subgroup analyses (optional)", kind: "textarea", default: "", rows: 2 },
    ],
    formula: "The test comes from a fixed table of outcome type by comparison (for example: binary and two groups gives a chi-square or Fisher exact test with a risk ratio; continuous and two groups gives a Welch t-test; time to event gives Kaplan-Meier with a log-rank test and a Cox hazard ratio). Each choice lists its assumptions and the fallback if they fail.",
    assumptions: ["The chosen outcome type and comparison are correct for the data you will collect."],
    limitations: ["A plan from a template still needs review. Complex designs (clustering, repeated measures, competing risks) need a statistician.", "The table covers common single-outcome analyses only."],
    references: [REF.ich, REF.altman, REF.hulley],
    run: (n, raw) => {
      const r = buildSap({
        design: raw.design ?? "other", outcomeName: raw.outcomeName ?? "", outcomeKind: raw.outcomeKind as OutcomeKind, comparison: raw.comparison as Comparison, groupLabel: raw.groupLabel ?? "",
        adjust: (raw.adjust ?? "").split(/\n/), alpha: n.alpha, software: raw.software ?? "", missing: (raw.missing as "complete" | "imputation" | "none") ?? "complete", secondaryCount: n.secondary, subgroups: raw.subgroups ?? "",
      });
      if (!r.ok) return { error: r.error };
      const full = r.blocks.map((b) => `${b.title}\n${b.text}`).join("\n\n");
      return {
        headline: { label: "Primary analysis", value: r.primary.length > 140 ? r.primary.slice(0, 137) + "..." : r.primary },
        blocks: r.blocks,
        notes: [...r.warnings, ...(r.tools.length ? [`Try these calculators on your data: ${r.tools.map((t) => `${t.label} (/tools/${t.slug})`).join("; ")}.`] : []), NOTE],
        methods: r.primary,
        apply: [
          { kind: "text", label: "Add plan to Statistics", field: "statistical_methods", text: full },
          { kind: "text", label: "Add primary analysis", field: "primary_analysis", text: r.primary },
        ],
      };
    },
  },
];

export const DESIGN_ID_LIST = Object.keys(DESIGNS) as DesignId[];

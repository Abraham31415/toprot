export type Framework = "pico" | "picot" | "peco";
export type OutcomeType = "binary" | "continuous" | "categorical";

export type QuestionInput = {
  framework: Framework;
  population: string;
  exposure: string;
  comparator: string;
  outcome: string;
  timeframe: string;
  setting: string;
  outcomeType: OutcomeType;
  covariates: string[];
};

export type QuestionOutput = {
  question: string;
  primaryObjective: string;
  specificObjectives: string[];
  nullHypothesis: string;
  alternativeHypothesis: string;
  variables: { name: string; role: "exposure" | "outcome" | "covariate"; type: "binary" | "continuous" | "categorical"; description: string }[];
  warnings: string[];
};

export const FRAMEWORK_LABELS: Record<Framework, { name: string; exposureLabel: string; hint: string }> = {
  pico: { name: "PICO (intervention studies)", exposureLabel: "Intervention", hint: "Population, Intervention, Comparison, Outcome" },
  picot: { name: "PICOT (intervention studies with a time frame)", exposureLabel: "Intervention", hint: "PICO plus the Time over which the outcome is assessed" },
  peco: { name: "PECO (exposure and risk-factor studies)", exposureLabel: "Exposure", hint: "Population, Exposure, Comparison, Outcome" },
};

const VAGUE = ["effective", "effectiveness", "better", "improve", "improved", "improvement", "good", "poor", "quality", "success", "successful", "impact", "outcome", "status", "burden", "wellbeing", "well-being"];

const clean = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.?!;:,]+$/, "");
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** Build the question, objectives, hypotheses and variables from the framework parts. Pure and deterministic. */
export function buildResearchQuestion(input: QuestionInput): { ok: true; out: QuestionOutput } | { ok: false; error: string } {
  const P = clean(input.population), E = clean(input.exposure), C = clean(input.comparator), O = clean(input.outcome), T = clean(input.timeframe), S = clean(input.setting);
  const isPeco = input.framework === "peco";
  const eLabel = FRAMEWORK_LABELS[input.framework].exposureLabel.toLowerCase();
  if (!P) return { ok: false, error: "Describe the population." };
  if (!E) return { ok: false, error: `Describe the ${eLabel}.` };
  if (!O) return { ok: false, error: "Describe the outcome." };
  if (input.framework === "picot" && !T) return { ok: false, error: "PICOT needs a time frame. Choose PICO if the outcome has no set time frame." };

  const where = S ? ` in ${S}` : "";
  const when = input.framework === "picot" && T ? ` over ${T}` : "";
  const vs = C ? ` compared with ${lowerFirst(C)}` : "";
  const popPhrase = `${lowerFirst(P)}${where}`;

  const question = isPeco
    ? `Among ${popPhrase}, is ${lowerFirst(E)}${vs} associated with ${lowerFirst(O)}${when}?`
    : `Among ${popPhrase}, what is the effect of ${lowerFirst(E)}${vs} on ${lowerFirst(O)}${when}?`;

  const primaryObjective = isPeco
    ? `To assess the association between ${lowerFirst(E)}${vs} and ${lowerFirst(O)} among ${popPhrase}${when}.`
    : `To determine the effect of ${lowerFirst(E)}${vs} on ${lowerFirst(O)} among ${popPhrase}${when}.`;

  const specificObjectives = [`To measure ${lowerFirst(O)} among ${popPhrase}.`];
  if (C) specificObjectives.push(`To compare ${lowerFirst(O)} between participants with ${lowerFirst(E)} and those with ${lowerFirst(C)}.`);
  const cov = input.covariates.map(clean).filter(Boolean);
  if (cov.length) specificObjectives.push(`To determine whether the association is explained by ${cov.slice(0, 4).map(lowerFirst).join(", ")}${cov.length > 4 ? " and other covariates" : ""}.`);

  const nullHypothesis = isPeco
    ? `There is no association between ${lowerFirst(E)} and ${lowerFirst(O)} among ${popPhrase}.`
    : `${E[0].toUpperCase() + E.slice(1)}${vs} has no effect on ${lowerFirst(O)} among ${popPhrase}.`;
  const alternativeHypothesis = isPeco
    ? `There is an association between ${lowerFirst(E)} and ${lowerFirst(O)} among ${popPhrase}.`
    : `${E[0].toUpperCase() + E.slice(1)}${vs} changes ${lowerFirst(O)} among ${popPhrase}.`;

  const variables: QuestionOutput["variables"] = [
    { name: E, role: "exposure", type: "categorical", description: `${isPeco ? "Exposure" : "Intervention"}: ${E}${C ? `, versus ${C}` : ""}.` },
    { name: O, role: "outcome", type: input.outcomeType, description: `Outcome: ${O}${input.framework === "picot" ? `, assessed ${when.trim()}` : ""}.` },
    ...cov.map((c) => ({ name: c, role: "covariate" as const, type: "categorical" as const, description: `Covariate: ${c}. Review its measurement type.` })),
  ];

  const warnings: string[] = [];
  const words = (s: string) => s.toLowerCase().split(/[^a-z-]+/);
  const vagueIn = (s: string) => VAGUE.filter((v) => words(s).includes(v));
  if (vagueIn(O).length) warnings.push(`The outcome contains vague wording (${vagueIn(O).join(", ")}). State exactly what will be measured, with a unit or threshold, in the operational definition.`);
  if (vagueIn(E).length) warnings.push(`The ${eLabel} contains vague wording (${vagueIn(E).join(", ")}). Say precisely what it is, how much and for how long.`);
  if (!C) warnings.push("No comparison group was given. Questions about an effect or an association need a comparator (for example unexposed, placebo or standard care). Without one this is a descriptive question.");
  if (/\b(and|or)\b/i.test(O)) warnings.push("The outcome may combine several outcomes. Pick one primary outcome and list the rest as secondary.");
  if (!S) warnings.push("No setting was given. Naming the place or health-service level makes the question answerable and the findings interpretable.");
  if (P.split(" ").length < 3) warnings.push("The population description is very short. Include age group, condition and eligibility so someone else could identify the same people.");
  if (input.framework !== "picot" && !T) warnings.push("No time frame was given. If the outcome depends on follow-up time, use PICOT.");
  return { ok: true, out: { question, primaryObjective, specificObjectives, nullHypothesis, alternativeHypothesis, variables, warnings } };
}

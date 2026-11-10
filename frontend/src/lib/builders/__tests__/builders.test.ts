import { describe, expect, it } from "vitest";
import { buildResearchQuestion, type QuestionInput } from "../research-question";
import { buildCriteria } from "../criteria";
import { classifyVariables, definitionsText } from "../variables";

const base: QuestionInput = {
  framework: "pico", population: "Children aged 6 to 59 months", exposure: "Vitamin A supplementation", comparator: "No supplementation",
  outcome: "Incidence of severe diarrhoea", timeframe: "", setting: "Mulago Hospital", outcomeType: "binary", covariates: ["Age", "Sex"],
};
const q = (over: Partial<QuestionInput> = {}) => {
  const r = buildResearchQuestion({ ...base, ...over });
  if (!r.ok) throw new Error(r.error);
  return r.out;
};

describe("research question builder", () => {
  it("builds a PICO intervention question, objective, hypotheses and variables", () => {
    const o = q();
    expect(o.question).toBe("Among children aged 6 to 59 months in Mulago Hospital, what is the effect of vitamin A supplementation compared with no supplementation on incidence of severe diarrhoea?");
    expect(o.primaryObjective.startsWith("To determine the effect of vitamin A supplementation")).toBe(true);
    expect(o.nullHypothesis).toContain("has no effect on");
    expect(o.alternativeHypothesis).toContain("changes");
    expect(o.variables.map((v) => v.role)).toEqual(["exposure", "outcome", "covariate", "covariate"]);
    expect(o.variables[1].type).toBe("binary");
    expect(o.specificObjectives.length).toBe(3);
  });
  it("PICOT adds the time frame to the question and objective", () => {
    const o = q({ framework: "picot", timeframe: "12 months" });
    expect(o.question).toMatch(/over 12 months\?$/);
    expect(o.primaryObjective).toMatch(/over 12 months\.$/);
  });
  it("PECO uses association wording instead of effect", () => {
    const o = q({ framework: "peco", exposure: "Exposure to indoor cooking smoke" });
    expect(o.question).toContain("is exposure to indoor cooking smoke compared with no supplementation associated with");
    expect(o.nullHypothesis).toContain("no association");
    expect(o.primaryObjective).toContain("association between");
  });
  it("requires population, exposure, outcome, and a time frame for PICOT", () => {
    expect(buildResearchQuestion({ ...base, population: " " }).ok).toBe(false);
    expect(buildResearchQuestion({ ...base, exposure: "" }).ok).toBe(false);
    expect(buildResearchQuestion({ ...base, outcome: "" }).ok).toBe(false);
    expect(buildResearchQuestion({ ...base, framework: "picot", timeframe: "" }).ok).toBe(false);
  });
  it("warns about vague outcomes, a missing comparator, compound outcomes and missing setting", () => {
    const w = q({ outcome: "Better quality of life and survival", comparator: "", setting: "" }).warnings.join(" | ");
    expect(w).toMatch(/vague wording \(better, quality\)/);
    expect(w).toMatch(/No comparison group/);
    expect(w).toMatch(/several outcomes/);
    expect(w).toMatch(/No setting/);
  });
  it("does not warn about a clean, specific question", () => {
    const w = q({ framework: "picot", timeframe: "12 months" }).warnings;
    expect(w).toEqual([]);
  });
  it("without a comparator it omits 'compared with' rather than inventing one", () => {
    expect(q({ comparator: "" }).question).not.toContain("compared with");
  });
  it("trims whitespace and trailing punctuation", () => {
    expect(q({ population: "  Adults with diabetes.  ", outcome: "HbA1c level?" }).question).toContain("adults with diabetes");
  });
});

describe("eligibility criteria builder", () => {
  const rows = [
    { type: "inclusion", category: "condition", text: "confirmed malaria by RDT" },
    { type: "inclusion", category: "age", text: "Aged 18 years or older" },
    { type: "inclusion", category: "age", text: "aged 18 years or older." },
    { type: "exclusion", category: "clinical", text: "Pregnancy" },
  ];
  it("orders by category, capitalises, removes duplicates and reports them", () => {
    const r = buildCriteria(rows);
    if (!r.ok) throw new Error(r.error);
    expect(r.inclusion).toEqual(["Aged 18 years or older", "Confirmed malaria by RDT"]);
    expect(r.exclusion).toEqual(["Pregnancy"]);
    expect(r.warnings.join(" ")).toMatch(/1 duplicate inclusion criterion was removed/);
  });
  it("flags a criterion on both lists, open-ended wording, and missing standard categories", () => {
    const r = buildCriteria([{ type: "inclusion", category: "other", text: "Pregnant women" }, { type: "exclusion", category: "other", text: "pregnant women" }, { type: "exclusion", category: "clinical", text: "Severe illness etc" }]);
    if (!r.ok) throw new Error(r.error);
    const w = r.warnings.join(" | ");
    expect(w).toMatch(/both an inclusion and an exclusion/);
    expect(w).toMatch(/open-ended/);
    expect(w).toMatch(/Nothing about age/);
    expect(w).toMatch(/Nothing about consent/);
  });
  it("needs at least one non-empty criterion", () => {
    expect(buildCriteria([]).ok).toBe(false);
    expect(buildCriteria([{ type: "inclusion", category: "age", text: "   " }]).ok).toBe(false);
  });
  it("has no warnings when the four core areas are covered", () => {
    const r = buildCriteria([
      { type: "inclusion", category: "age", text: "Aged 18 or over" }, { type: "inclusion", category: "condition", text: "Confirmed TB" },
      { type: "inclusion", category: "setting", text: "Attends Mulago clinic in 2027" }, { type: "inclusion", category: "consent", text: "Gives written consent" },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings).toEqual([]);
  });
});

describe("variables and operational definitions", () => {
  const row = (o: Partial<Record<string, string>> = {}) => ({ name: "Age", role: "covariate", measure: "number", definition: "Age in completed years", source: "ID", unit: "years", timepoint: "Baseline", ...o });
  it("maps measurement kind to type and scale, with summary and comparison methods", () => {
    const r = classifyVariables([row(), row({ name: "Sex", measure: "category" }), row({ name: "Died", measure: "yesno", role: "outcome" }), row({ name: "Stage", measure: "ordered" }), row({ name: "DOB", measure: "date" })]);
    if (!r.ok) throw new Error(r.error);
    expect(r.items.map((i) => i.type)).toEqual(["continuous", "categorical", "binary", "ordinal", "date"]);
    expect(r.items[0].scale).toBe("Interval or ratio");
    expect(r.items[2].compare).toMatch(/odds ratio/);
  });
  it("generates unique slugs for duplicate-looking names", () => {
    const r = classifyVariables([row({ name: "Hb level" }), row({ name: "Hb-level" }), row({ name: "HB LEVEL" })]);
    if (!r.ok) throw new Error(r.error);
    expect(new Set(r.slugs).size).toBe(3);
    expect(r.slugs[0]).toBe("hb_level");
  });
  it("warns about a missing outcome, undefined exposure, missing unit and duplicates", () => {
    const r = classifyVariables([row({ name: "Smoking", role: "exposure", definition: "" }), row({ unit: "" }), row({ name: "age" })]);
    if (!r.ok) throw new Error(r.error);
    const w = r.warnings.join(" | ");
    expect(w).toMatch(/No outcome variable/);
    expect(w).toMatch(/"Smoking" is an exposure but has no operational definition/);
    expect(w).toMatch(/"Age" is a measured number without a unit/);
    expect(w).toMatch(/appears 2 times/);
  });
  it("rejects an empty list and ignores blank names", () => {
    expect(classifyVariables([]).ok).toBe(false);
    expect(classifyVariables([row({ name: "  " })]).ok).toBe(false);
  });
  it("writes a definitions block", () => {
    const r = classifyVariables([row()]);
    if (!r.ok) throw new Error(r.error);
    expect(definitionsText(r.items)).toBe("Operational definitions\n- Age (covariate, interval or ratio). Age in completed years. Measured using ID. Unit or cut-off: years. Timing: Baseline.");
  });
});

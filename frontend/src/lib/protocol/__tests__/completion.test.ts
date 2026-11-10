import { describe, expect, it } from "vitest";
import { computeCompletion } from "../completion";
import type { QualitySnapshot } from "../quality";

const empty: QualitySnapshot = {
  study_title: "", study_design: "", research_question: "", objectives: [], target_population: "", setting: "",
  inclusion_criteria: [], exclusion_criteria: [], variables: [], statistical_methods: "", primary_analysis: "",
  significance_level: null, sample_size_inputs: null, calculated_sample_size: null, current_enrollment: null,
  data_collection_methods: "", data_sources: "", data_management_plan: "", ethical_approval_body: "", consent_process: "",
};

const full: QualitySnapshot = {
  ...empty,
  study_title: "T", study_design: "cross-sectional", research_question: "Q?",
  objectives: [{ objective_type: "primary", description: "Estimate prevalence" }],
  target_population: "Pregnant women", setting: "Clinic", inclusion_criteria: ["Age 15+"],
  variables: [{ variable_name: "age" } as never],
  statistical_methods: "Descriptive", primary_analysis: "Prevalence", calculated_sample_size: 369,
  data_collection_methods: "Questionnaire", data_sources: "Primary", data_management_plan: "REDCap",
  ethical_approval_body: "IRB", consent_process: "Written",
};

describe("protocol completion", () => {
  it("an empty protocol is 0% with every section incomplete", () => {
    const c = computeCompletion(empty);
    expect(c.percent).toBe(0);
    expect(c.completeSections).toBe(0);
    expect(c.sections).toHaveLength(8);
  });

  it("a fully filled protocol is 100%", () => {
    const c = computeCompletion(full);
    expect(c.percent).toBe(100);
    expect(c.completeSections).toBe(8);
    expect(c.sections.every((s) => s.missing.length === 0)).toBe(true);
  });

  it("reports exactly what is missing in a partly filled section", () => {
    const c = computeCompletion({ ...full, target_population: "   ", inclusion_criteria: [] });
    const pop = c.sections.find((s) => s.key === "population")!;
    expect(pop.complete).toBe(false);
    expect(pop.filled).toBe(1);
    expect(pop.missing).toEqual(["target population", "at least one inclusion criterion"]);
  });

  it("treats whitespace-only text and blank list entries as not filled", () => {
    const c = computeCompletion({
      ...full, study_title: "  ", objectives: [{ objective_type: "primary", description: " " }],
      variables: [{ variable_name: "" } as never],
    });
    expect(c.sections.find((s) => s.key === "identity")!.missing).toEqual(["study title"]);
    expect(c.sections.find((s) => s.key === "objectives")!.missing).toEqual(["at least one objective"]);
    expect(c.sections.find((s) => s.key === "variables")!.complete).toBe(false);
  });

  it("counts a calculated sample size of 0 as present, but null as missing", () => {
    expect(computeCompletion({ ...full, calculated_sample_size: 0 }).sections.find((s) => s.key === "sample_size")!.complete).toBe(true);
    expect(computeCompletion({ ...full, calculated_sample_size: null }).sections.find((s) => s.key === "sample_size")!.complete).toBe(false);
  });

  it("percent is the rounded share of required items", () => {
    const c = computeCompletion({ ...empty, study_title: "T" }); // 1 of 16 items
    expect(c.total).toBe(16);
    expect(c.filled).toBe(1);
    expect(c.percent).toBe(6); // 6.25 rounds to 6
  });
});

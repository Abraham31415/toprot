import { describe, expect, it } from "vitest";
import { DESIGNS, recommendDesigns, type DesignAnswers, type DesignId } from "../designs";
import { adviseSampling, METHOD_NAMES, type SamplingAnswers } from "../sampling";
import { buildSap, chooseTest, type SapInput } from "../sap";

const A = (over: Partial<DesignAnswers> = {}): DesignAnswers => ({ aim: "risk", assign: "yes", outcome: "common", followup: "long", resources: "adequate", ...over });
const top = (a: DesignAnswers): DesignId => recommendDesigns(a)[0].id;

describe("study design assistant rules", () => {
  it("maps each aim to its natural design", () => {
    expect(top(A({ aim: "describe" }))).toBe("cross-sectional");
    expect(top(A({ aim: "cause" }))).toBe("rct");
    expect(top(A({ aim: "diagnostic" }))).toBe("diagnostic");
    expect(top(A({ aim: "experience" }))).toBe("qualitative");
    expect(top(A({ aim: "both" }))).toBe("mixed");
    expect(top(A({ aim: "synthesize" }))).toBe("review");
  });
  it("prefers case-control for a rare outcome and cohort for a common one", () => {
    expect(top(A({ aim: "risk", outcome: "rare" }))).toBe("case-control");
    expect(top(A({ aim: "risk", outcome: "common", followup: "long", resources: "adequate" }))).toBe("cohort");
  });
  it("excludes a trial when the intervention cannot be assigned, and falls back to an observational design", () => {
    const r = recommendDesigns(A({ aim: "cause", assign: "no" }));
    const rct = r.find((x) => x.id === "rct")!;
    expect(rct.blocked).toBe(true);
    expect(rct.fit).toBe("Not suitable");
    expect(rct.reasons.join(" ")).toMatch(/cannot be assigned/);
    expect(r[0].id).toBe("cohort");
  });
  it("short follow-up and limited resources lower the score of costly designs", () => {
    const rich = recommendDesigns(A({ aim: "cause", resources: "adequate", followup: "long" })).find((x) => x.id === "rct")!.points;
    const poor = recommendDesigns(A({ aim: "cause", resources: "limited", followup: "short" })).find((x) => x.id === "rct")!.points;
    expect(poor).toBeLessThan(rich);
  });
  it("gives a reason for every design and only strong fits above the threshold", () => {
    for (const aim of ["describe", "cause", "risk", "diagnostic", "experience", "both", "synthesize"] as const) {
      for (const r of recommendDesigns(A({ aim }))) {
        expect(r.reasons.length).toBeGreaterThan(0);
        if (r.fit === "Strong fit") expect(r.points).toBeGreaterThanOrEqual(6);
        if (r.fit === "Not suitable" && !r.blocked) expect(r.reasons[0]).toMatch(/Not designed to/);
      }
    }
  });
  it("describes all eight requested designs with limitations and a reporting guideline", () => {
    expect(Object.keys(DESIGNS).sort()).toEqual(["case-control", "cohort", "cross-sectional", "diagnostic", "mixed", "qualitative", "rct", "review"]);
    for (const d of Object.values(DESIGNS)) {
      expect(d.limitations.length, d.id).toBeGreaterThan(0);
      expect(d.guideline.length, d.id).toBeGreaterThan(3);
      expect(d.biases.length, d.id).toBeGreaterThan(0);
    }
  });
});

const S = (over: Partial<SamplingAnswers> = {}): SamplingAnswers => ({ purpose: "estimate", frame: "yes", groups: "uniform", spread: "compact", representative: "yes", population: "Adults in Gulu", sampleSize: 384, ...over });

describe("sampling strategy assistant rules", () => {
  it("applies the rules in order", () => {
    expect(adviseSampling(S({ purpose: "explore" })).primary).toBe("purposive");
    expect(adviseSampling(S({ representative: "no", frame: "no" })).primary).toBe("consecutive");
    expect(adviseSampling(S({ representative: "no", frame: "yes", groups: "subgroups" })).primary).toBe("quota");
    expect(adviseSampling(S()).primary).toBe("simple");
    expect(adviseSampling(S({ groups: "subgroups" })).primary).toBe("stratified");
    expect(adviseSampling(S({ spread: "scattered" })).primary).toBe("systematic");
    expect(adviseSampling(S({ spread: "scattered", groups: "subgroups" })).primary).toBe("stratified");
    expect(adviseSampling(S({ frame: "no", spread: "compact" })).primary).toBe("cluster");
    expect(adviseSampling(S({ frame: "no", spread: "scattered" })).primary).toBe("multistage");
  });
  it("writes a methods paragraph with the population, method and sample size", () => {
    const r = adviseSampling(S());
    expect(r.methodsText).toContain("Adults in Gulu");
    expect(r.methodsText).toContain("simple random sampling");
    expect(r.methodsText).toContain("384 participants");
    expect(adviseSampling(S({ sampleSize: 0 })).methodsText).toContain("the calculated sample size");
  });
  it("links the design effect tool for clustered designs and no sample size tools for qualitative work", () => {
    expect(adviseSampling(S({ frame: "no" })).tools.map((t) => t.slug)).toContain("design-effect");
    expect(adviseSampling(S({ purpose: "explore" })).tools).toEqual([]);
    expect(adviseSampling(S({ frame: "no" })).methodsText).toMatch(/design effect/);
  });
  it("has steps, biases and a name for every method it can recommend", () => {
    const seen = new Set<string>();
    for (const purpose of ["estimate", "explore"] as const) for (const representative of ["yes", "no"] as const) for (const frame of ["yes", "no"] as const)
      for (const groups of ["uniform", "subgroups"] as const) for (const spread of ["compact", "scattered"] as const) {
        const r = adviseSampling(S({ purpose, representative, frame, groups, spread }));
        seen.add(r.primary);
        expect(r.steps.length).toBeGreaterThan(2);
        expect(r.biases.length).toBeGreaterThan(0);
        expect(METHOD_NAMES[r.primary]).toBeTruthy();
      }
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });
});

const P = (over: Partial<SapInput> = {}): SapInput => ({ design: "cohort", outcomeName: "Severe diarrhoea", outcomeKind: "binary", comparison: "two", groupLabel: "supplemented and unsupplemented children", adjust: ["Age", "Sex"], alpha: 0.05, software: "Stata", missing: "complete", secondaryCount: 3, subgroups: "", ...over });

describe("statistical analysis plan generator", () => {
  it("chooses the usual test for common combinations", () => {
    expect(chooseTest("binary", "two")?.test).toMatch(/Chi-square/);
    expect(chooseTest("continuous", "two")?.test).toMatch(/Welch/);
    expect(chooseTest("continuous", "many")?.test).toMatch(/ANOVA/);
    expect(chooseTest("continuous", "paired")?.test).toMatch(/Paired t-test/);
    expect(chooseTest("time", "two")?.test).toMatch(/log-rank/);
    expect(chooseTest("count", "two")?.test).toMatch(/Poisson/);
    expect(chooseTest("ordinal", "two")?.test).toMatch(/Mann-Whitney/);
    expect(chooseTest("binary", "paired")?.test).toBe("McNemar test");
  });
  it("returns nothing for descriptive plans and for combinations that make no sense", () => {
    expect(chooseTest("binary", "descriptive")).toBeNull();
    expect(chooseTest("time", "paired")).toBeNull();
    const r = buildSap(P({ outcomeKind: "time", comparison: "paired" }));
    expect(r.ok).toBe(false);
  });
  it("builds every section with the stated alpha and confidence level", () => {
    const r = buildSap(P());
    if (!r.ok) throw new Error(r.error);
    const titles = r.blocks.map((b) => b.title);
    expect(titles).toEqual(["Analysis population", "Descriptive statistics", "Primary analysis", "Assumption checks", "Adjusted analysis", "Multiple comparisons", "Missing data", "Software"]);
    expect(r.primary).toContain("two-sided α of 0.05");
    expect(r.primary).toContain("95% confidence intervals");
    expect(r.blocks.find((b) => b.title === "Adjusted analysis")!.text).toMatch(/Age, Sex/);
    expect(r.tools.map((t) => t.slug)).toContain("chi-square-test");
  });
  it("omits optional sections when not needed", () => {
    const r = buildSap(P({ adjust: [], secondaryCount: 1 }));
    if (!r.ok) throw new Error(r.error);
    const titles = r.blocks.map((b) => b.title);
    expect(titles).not.toContain("Adjusted analysis");
    expect(titles).not.toContain("Multiple comparisons");
  });
  it("handles a descriptive plan without a hypothesis test and warns", () => {
    const r = buildSap(P({ comparison: "descriptive" }));
    if (!r.ok) throw new Error(r.error);
    expect(r.primary).toMatch(/No hypothesis test is planned/);
    expect(r.warnings.join(" ")).toMatch(/No comparison was chosen/);
  });
  it("warns about a lax alpha, too many covariates, trial adjustment and matched designs", () => {
    const w = (o: Partial<SapInput>) => { const r = buildSap(P(o)); if (!r.ok) throw new Error(r.error); return r.warnings.join(" | "); };
    expect(w({ alpha: 0.2 })).toMatch(/unusually lax/);
    expect(w({ adjust: Array.from({ length: 11 }, (_, i) => `v${i}`) })).toMatch(/overfitting/);
    expect(w({ design: "rct" })).toMatch(/pre-specified covariates/);
    expect(w({ design: "case-control", comparison: "paired", outcomeKind: "binary" })).toMatch(/conditional/);
  });
  it("validates the outcome name and alpha", () => {
    expect(buildSap(P({ outcomeName: "  " })).ok).toBe(false);
    expect(buildSap(P({ alpha: 0 })).ok).toBe(false);
    expect(buildSap(P({ alpha: 1 })).ok).toBe(false);
  });
  it("uses the right missing-data and subgroup wording", () => {
    const imp = buildSap(P({ missing: "imputation", subgroups: "sex and age band" }));
    if (!imp.ok) throw new Error(imp.error);
    expect(imp.blocks.find((b) => b.title === "Missing data")!.text).toMatch(/multiple imputation/);
    expect(imp.blocks.find((b) => b.title === "Subgroup analyses")!.text).toMatch(/exploratory/);
  });
});

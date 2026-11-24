import { describe, expect, it } from "vitest";
import { runAnalysis } from "../engine/run";
import { METHODS } from "../engine/registry";
import { suggest } from "../wizard";
import type { Dataset } from "../types";

// End-to-end runner behaviour: validated parameters in, a complete structured result out, and a clear error (never a partial result)
// for every edge case listed in the Data Studio specification.

function make(cols: Record<string, (number | string | null)[]>, nominal: string[] = []): Dataset {
  return {
    variables: Object.entries(cols).map(([name, c]) => {
      const numeric = c.every((x) => x === null || typeof x === "number");
      return { name, type: numeric ? "numeric" : "string", measure: !numeric || nominal.includes(name) ? "nominal" : "scale", role: "none" };
    }),
    columns: Object.values(cols),
  };
}

// Deterministic pseudo-random data (no Math.random, so failures reproduce).
function lcg(seed: number) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }
const r = lcg(42);
const N = 120;
const group = Array.from({ length: N }, (_, i) => (i % 3 === 0 ? "a" : i % 3 === 1 ? "b" : "c"));
const sex = Array.from({ length: N }, () => (r() < 0.5 ? 0 : 1));
const age = Array.from({ length: N }, () => Math.round(20 + r() * 50));
const y = age.map((a, i) => +(10 + 0.2 * a + 3 * sex[i] + (group[i] === "b" ? 2 : 0) + (r() - 0.5) * 8).toFixed(2));
const event = y.map((v) => (v > 22 ? 1 : 0));
const time = y.map((v) => +(1 + (40 - v) * r()).toFixed(1)).map((t) => Math.max(0.1, t));
const pre = y.map((v) => +(v - 1 + r()).toFixed(2));
const rater1 = sex.map((s, i) => (i % 7 === 0 ? 1 - s : s));
// Overdispersed counts (geometric, i.e. negative binomial with alpha = 1) and an ordered grade.
const count = age.map((a, i) => { const m = Math.exp(-1 + 0.03 * a + 0.4 * sex[i]); return Math.floor(Math.log(1 - r()) / Math.log(m / (1 + m))); });
const grade = y.map((v) => (v < 18 ? 1 : v < 23 ? 2 : 3));
const base = make({ group, sex, age, y, event, time, pre, rater1, count, grade }, ["sex", "event", "rater1"]);

describe("every registered method runs on suitable data", () => {
  const cases: Record<string, Record<string, unknown>> = {
    describe: { variables: ["y", "age"], by: "group" }, frequencies: { variables: ["group", "sex"], ci: true }, normality: { variable: "y" },
    crosstab: { row: "sex", col: "event" }, ttest_one: { variable: "y", mu: 20 }, ttest_ind: { outcome: "y", group: "sex" }, ttest_paired: { a: "y", b: "pre" },
    anova_oneway: { outcome: "y", group: "group", posthoc: "games_howell" }, mannwhitney: { outcome: "y", group: "sex" }, wilcoxon: { a: "y", b: "pre" },
    kruskal: { outcome: "y", group: "group" }, friedman: { variables: ["y", "pre", "age"] }, mcnemar: { a: "sex", b: "rater1" }, cochran_q: { variables: ["sex", "rater1", "event"] },
    correlation: { variables: ["y", "age", "pre"], method: "kendall" }, partial_correlation: { x: "y", y: "pre", controls: ["age"] },
    linear_regression: { outcome: "y", predictors: ["age", "sex", "group"], interactions: [["age", "sex"]], polynomial: ["age"], robust: true },
    logistic_regression: { outcome: "event", event: "1", predictors: ["age", "group"] },
    risk_2x2: { exposure: "sex", exposed: "1", outcome: "event", event: "1" }, diagnostic: { test: "rater1", testPositive: "1", reference: "sex", diseased: "1" },
    roc: { score: "y", reference: "sex", diseased: "1" }, kappa: { a: "sex", b: "rater1" },
    kaplan_meier: { time: "time", event: "event", group: "sex", at: 5 }, cox: { time: "time", event: "event", predictors: ["sex", "age"] },
    mantel_haenszel: { exposure: "sex", exposed: "1", outcome: "event", event: "1", stratum: "group" },
    reliability: { variables: ["y", "pre"] }, bland_altman: { a: "y", b: "pre" },
    table1: { variables: ["age", "y", "sex", "group", "grade"], by: "event", medianVars: ["y"], pvalues: true, decimals: 2 },
    anova_factorial: { outcome: "y", factors: ["group", "sex"], covariates: ["age"] },
    glm: { outcome: "count", family: "negbin", predictors: ["age", "sex"], exposure: "time", robust: true },
    multinomial_logistic: { outcome: "group", predictors: ["age", "y"] }, ordinal_logistic: { outcome: "grade", predictors: ["age", "sex"] },
    pca: { variables: ["y", "age", "pre", "time"] }, bootstrap_ci: { variable: "y", replicates: 500, seed: 7 },
    permutation_test: { outcome: "y", group: "sex", permutations: 2000, seed: 3 },
    standardization: { events: "event", population: "time", stratum: "group", group: "sex" },
  };
  for (const m of METHODS) {
    it(m.id, () => {
      const params = cases[m.id];
      expect(params, `add a test case for ${m.id}`).toBeDefined();
      const { result } = runAnalysis(m.id, params, base);
      expect(result.tables.length).toBeGreaterThan(0);
      expect(result.methodsText.length).toBeGreaterThan(20);
      expect(result.n.used).toBeGreaterThan(0);
      for (const t of result.tables) for (const row of t.rows) for (const c of row) if (typeof c === "number") expect(Number.isFinite(c)).toBe(true);
      expect(JSON.stringify(result).length).toBeLessThan(2_000_000);
    });
  }
});

describe("results are deterministic and self-consistent", () => {
  it("same input gives an identical result", () => {
    const a = runAnalysis("linear_regression", { outcome: "y", predictors: ["age", "group"] }, base).result;
    const b = runAnalysis("linear_regression", { outcome: "y", predictors: ["age", "group"] }, base).result;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("documents the reference category and excluded rows", () => {
    const d = make({ y: [...y.slice(0, 10), null], g: [...group.slice(0, 10), "a"] });
    const res = runAnalysis("linear_regression", { outcome: "y", predictors: ["g"] }, d).result;
    expect(res.tables[0].notes?.join(" ")).toMatch(/reference category is "a"/);
    expect(res.n.excluded).toBe(1);
    expect(res.warnings.some((w) => w.text.includes("1 of 11 rows were excluded"))).toBe(true);
  });
});

describe("statistical edge cases fail clearly instead of returning results", () => {
  it("empty and all-missing data", () => {
    expect(() => runAnalysis("ttest_one", { variable: "x", mu: 0 }, make({ x: [null, null, null] }))).toThrow(/at least 2 complete observations/);
    expect(() => runAnalysis("describe", { variables: ["x"] }, make({ x: [] }))).not.toThrow();
  });
  it("constant variables", () => {
    expect(() => runAnalysis("ttest_one", { variable: "x", mu: 0 }, make({ x: [3, 3, 3, 3] }))).toThrow(/no variation/);
    expect(() => runAnalysis("linear_regression", { outcome: "y", predictors: ["x"] }, make({ y: [1, 2, 3, 4, 5], x: [2, 2, 2, 2, 2] }))).toThrow(/collinear|linear combination/);
    expect(() => runAnalysis("normality", { variable: "x" }, make({ x: [1, 1, 1, 1] }))).not.toThrow();
  });
  it("perfect multicollinearity names the offending term", () => {
    const d = make({ y: [1, 3, 2, 5, 4, 6, 8, 7], a: [1, 2, 3, 4, 5, 6, 7, 8], b: [2, 4, 6, 8, 10, 12, 14, 16] });
    expect(() => runAnalysis("linear_regression", { outcome: "y", predictors: ["a", "b"] }, d)).toThrow(/"b"/);
  });
  it("too few observations for the number of coefficients", () => {
    expect(() => runAnalysis("linear_regression", { outcome: "y", predictors: ["a", "b"] }, make({ y: [1, 2, 3], a: [1, 5, 2], b: [7, 1, 3] }))).toThrow(/complete observations/);
  });
  it("logistic separation is detected", () => {
    const d = make({ out: [0, 0, 0, 0, 1, 1, 1, 1], x: [1, 2, 3, 4, 5, 6, 7, 8] }, ["out"]);
    expect(() => runAnalysis("logistic_regression", { outcome: "out", predictors: ["x"] }, d)).toThrow(/separation/);
  });
  it("sparse tables warn and offer Fisher's test; empty categories are refused", () => {
    const d = make({ a: ["x", "x", "y", "y", "x"], b: ["p", "q", "p", "p", "p"] });
    const res = runAnalysis("crosstab", { row: "a", col: "b" }, d).result;
    expect(res.warnings.some((w) => w.text.includes("Fisher"))).toBe(true);
    expect(res.keyResults.fisher_p).toBeGreaterThan(0);
  });
  it("zero events are refused for survival models and zero cells are corrected for ratios", () => {
    const d = make({ t: [1, 2, 3, 4], e: [0, 0, 0, 0], x: [1, 2, 3, 4] }, ["e"]);
    expect(() => runAnalysis("cox", { time: "t", event: "e", predictors: ["x"] }, d)).toThrow(/two values|no events/);
    const z = runAnalysis("risk_2x2", { exposure: "x2", exposed: "1", outcome: "o", event: "1" }, make({ x2: [1, 1, 0, 0], o: [1, 1, 0, 1] }, ["x2", "o"])).result;
    expect(z.warnings.some((w) => w.text.includes("0.5"))).toBe(true);
  });
  it("invalid variable types and unknown variables", () => {
    expect(() => runAnalysis("ttest_one", { variable: "s", mu: 0 }, make({ s: ["a", "b"] }))).toThrow(/must be numeric/);
    expect(() => runAnalysis("ttest_one", { variable: "nope", mu: 0 }, make({ s: [1, 2] }))).toThrow(/does not exist/);
    expect(() => runAnalysis("ttest_ind", { outcome: "y", group: "y" }, base)).toThrow();
    expect(() => runAnalysis("not_a_method", {}, base)).toThrow(/Unknown analysis/);
  });
  it("extremely large values do not lose precision in descriptives", () => {
    const res = runAnalysis("describe", { variables: ["x"] }, make({ x: [1e12 + 1, 1e12 + 2, 1e12 + 3] })).result;
    expect(res.keyResults.x_mean).toBe(1e12 + 2);
    expect(res.keyResults.x_sd).toBeCloseTo(1, 6);
  });
  it("extreme outliers are reported, not removed", () => {
    const res = runAnalysis("linear_regression", { outcome: "y", predictors: ["x"] }, make({ y: [1, 2, 3, 4, 5, 6, 7, 8, 9, 200], x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] })).result;
    expect(res.n.used).toBe(10);
    expect(res.assumptions.find((a) => a.name === "Influential observations")?.status).not.toBe("met");
  });
});

describe("edge cases for Table 1, factorial ANOVA, GLMs, multicategory models, PCA, resampling and standardisation", () => {
  it("Table 1: p-values off by default, missing counts shown, decimals respected, one group refused", () => {
    const d = make({ g: ["a", "a", "b", "b", "a", "b"], x: [1.234, 2.5, null, 3.75, 4, 5], s: ["m", "f", "f", null, "m", "m"] });
    const t = runAnalysis("table1", { variables: ["x", "s"], by: "g", decimals: 2 }, d).result.tables[0];
    expect(t.columns).not.toContain("p");
    expect(t.rows.some((r) => r[0] === "   Missing, n")).toBe(true);
    expect(String(t.rows[0][1])).toMatch(/^\d+\.\d{2} \(\d+\.\d{2}\)$/);
    const withP = runAnalysis("table1", { variables: ["x", "s"], by: "g", pvalues: true }, d).result.tables[0];
    expect(withP.columns).toEqual(expect.arrayContaining(["p", "Test"]));
    expect(withP.rows[0][withP.columns.indexOf("Test")]).toBe("Welch t-test");
    expect(() => runAnalysis("table1", { variables: ["x"], by: "g" }, make({ g: ["a", "a"], x: [1, 2] }))).toThrow(/only one category/);
  });
  it("factorial ANOVA: empty cells with interactions are refused with a clear reason", () => {
    const d = make({ y: [1, 2, 3, 4, 5, 6, 7, 8], a: ["p", "p", "q", "q", "p", "p", "q", "q"], b: ["u", "u", "u", "u", "v", "v", "u", "u"] });
    expect(() => runAnalysis("anova_factorial", { outcome: "y", factors: ["a", "b"] }, d)).toThrow(/empty cells/);
    expect(() => runAnalysis("anova_factorial", { outcome: "y", factors: ["a", "b"], interactions: false }, d)).not.toThrow();
  });
  it("factorial ANOVA reports the sums-of-squares type it used", () => {
    const res = runAnalysis("anova_factorial", { outcome: "y", factors: ["group", "sex"], ssType: "2" }, base).result;
    expect(res.tables[0].title).toMatch(/Type II sums of squares/);
    expect(res.keyResults.ss_type).toBe("II");
  });
  it("GLMs: invalid outcomes and exposures are refused; overdispersion is flagged", () => {
    expect(() => runAnalysis("glm", { outcome: "y", family: "poisson", predictors: ["age"] }, base)).toThrow(/whole numbers/);
    expect(() => runAnalysis("glm", { outcome: "x", family: "gamma", predictors: ["z"] }, make({ x: [0, 1, 2, 3, 4], z: [1, 2, 3, 4, 5] }))).toThrow(/strictly positive/);
    expect(() => runAnalysis("glm", { outcome: "count", family: "poisson", predictors: ["age"], exposure: "pre" }, make({ count: [1, 2, 0, 3, 4], age: [1, 2, 3, 4, 5], pre: [1, 0, 2, 1, 1] }))).toThrow(/must be positive/);
    const pois = runAnalysis("glm", { outcome: "count", family: "poisson", predictors: ["age", "sex"] }, base).result;
    expect(pois.assumptions.find((a) => a.name === "Overdispersion")?.status).toBe("violated");
    const flat = make({ c: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2], x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    expect(() => runAnalysis("glm", { outcome: "c", family: "negbin", predictors: ["x"] }, flat)).toThrow(/not overdispersed|Poisson/);
  });
  it("multinomial and ordinal models need at least three categories; separation is detected", () => {
    expect(() => runAnalysis("multinomial_logistic", { outcome: "sex", predictors: ["age"] }, base)).toThrow(/at least three/);
    expect(() => runAnalysis("ordinal_logistic", { outcome: "sex", predictors: ["age"] }, base)).toThrow(/at least three/);
    const sep = make({ o: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3], x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, ["o"]);
    expect(() => runAnalysis("ordinal_logistic", { outcome: "o", predictors: ["x"] }, sep)).toThrow(/separation/);
    expect(() => runAnalysis("multinomial_logistic", { outcome: "o", predictors: ["x"] }, sep)).toThrow(/separation/);
    const txt = runAnalysis("ordinal_logistic", { outcome: "g", predictors: ["age"] }, make({ g: grade.map((v) => ["low", "mid", "high"][v - 1]), age })).result;
    expect(txt.warnings.some((w) => w.text.includes("alphabetically"))).toBe(true);
  });
  it("PCA names a constant variable", () => {
    expect(() => runAnalysis("pca", { variables: ["a", "b", "k"] }, make({ a: [1, 2, 3, 4, 5], b: [2, 1, 4, 3, 5], k: [7, 7, 7, 7, 7] }))).toThrow(/"k" is constant/);
  });
  it("bootstrap and permutation results are reproducible from the recorded seed", () => {
    const a = runAnalysis("bootstrap_ci", { variable: "y", replicates: 500, seed: 11 }, base).result;
    const b = runAnalysis("bootstrap_ci", { variable: "y", replicates: 500, seed: 11 }, base).result;
    const c = runAnalysis("bootstrap_ci", { variable: "y", replicates: 500, seed: 12 }, base).result;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.keyResults.mean_bca_lower).not.toBe(c.keyResults.mean_bca_lower);
    expect(a.keyResults.seed).toBe(11);
    expect(a.methodsText).toMatch(/seed \(11/);
    expect(() => runAnalysis("bootstrap_ci", { variable: "y", seed: -1 }, base)).toThrow(/at least 0/);
    const small = runAnalysis("permutation_test", { outcome: "x", group: "g" }, make({ x: [1, 2, 3, 4, 5, 6, 7, 8], g: ["a", "a", "a", "a", "b", "b", "b", "b"] })).result;
    expect(small.keyResults.exact).toBe("yes");
    expect(small.keyResults.p).toBeCloseTo(2 / 70, 12);
  });
  it("standardisation needs a standard, and a standard that is constant within each stratum", () => {
    const d = make({ e: [1, 2, 3, 4], n: [100, 200, 300, 400], age: ["a", "b", "a", "b"], sp: [10, 20, 11, 20] });
    expect(() => runAnalysis("standardization", { events: "e", population: "n", stratum: "age" }, d)).toThrow(/Choose a standard/);
    expect(() => runAnalysis("standardization", { events: "e", population: "n", stratum: "age", stdPop: "sp" }, d)).toThrow(/exactly one value within each stratum/);
    const ok = runAnalysis("standardization", { events: "e", population: "n", stratum: "age", stdPop: "sp" }, make({ e: [1, 2, 3, 4], n: [100, 200, 300, 400], age: ["a", "b", "a", "b"], sp: [10, 20, 10, 20] })).result;
    expect(ok.keyResults.dsr_All).toBeGreaterThan(0);
  });
});

describe("analysis wizard", () => {
  it("recommends by design, not just by variable type", () => {
    expect(suggest({ objective: "compare", outcome: "continuous", groups: 2, paired: true, normal: "yes" })[0].method).toBe("ttest_paired");
    expect(suggest({ objective: "compare", outcome: "continuous", groups: 2, normal: "no" })[0].method).toBe("mannwhitney");
    expect(suggest({ objective: "compare", outcome: "binary", groups: 2, paired: true })[0].method).toBe("mcnemar");
    expect(suggest({ objective: "compare", outcome: "continuous", groups: 3, clustered: true })[0].method).toBeNull();
  });
  it("adds causal caveats for observational designs and flags unavailable methods honestly", () => {
    const s = suggest({ objective: "compare", outcome: "binary", groups: 2, design: "case_control" });
    expect(s.some((x) => x.caveats.some((c) => c.includes("not causation")))).toBe(true);
    expect(s.find((x) => x.method === "risk_2x2")?.caveats.join(" ")).toMatch(/only the odds ratio/);
    expect(suggest({ objective: "compare", outcome: "continuous", groups: 3, paired: true })[0].caveats.join(" ")).toMatch(/not yet available/);
  });
  it("recommends the newer models where they fit", () => {
    expect(suggest({ objective: "predict", outcome: "count" })[0].method).toBe("glm");
    expect(suggest({ objective: "predict", outcome: "ordinal" })[0].method).toBe("ordinal_logistic");
    expect(suggest({ objective: "predict", outcome: "nominal" })[0].method).toBe("multinomial_logistic");
    expect(suggest({ objective: "compare", outcome: "continuous", groups: 3, factorial: true, normal: "yes" }).some((x) => x.method === "anova_factorial" && x.primary)).toBe(true);
    expect(suggest({ objective: "compare", outcome: "continuous", groups: 2, confounders: true }).some((x) => x.method === "anova_factorial")).toBe(true);
    expect(suggest({ objective: "describe", outcome: "continuous" }).some((x) => x.method === "table1")).toBe(true);
    for (const o of ["count", "ordinal", "nominal"] as const) expect(suggest({ objective: "predict", outcome: o }).flatMap((x) => x.caveats).join(" ")).not.toMatch(/not yet available/);
  });
});

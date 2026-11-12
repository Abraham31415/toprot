import { publicSlugFor } from "../aliases";
import { describe, expect, it } from "vitest";
import { ALL_TOOLS, CALCULATORS, CATEGORIES, getCalculator, toolHref } from "../registry";
import { parseList, parseNumbers } from "../helpers";

const defaults = (slug: string) => {
  const t = getCalculator(slug)!;
  return Object.fromEntries(t.fields.map((f) => [f.id, f.default]));
};

const runWith = (slug: string, over: Record<string, string> = {}) => {
  const t = getCalculator(slug)!;
  const raw = { ...defaults(slug), ...over };
  const parsed = parseNumbers(t.fields, raw);
  if ("error" in parsed) return { error: parsed.error };
  return t.run(parsed.n, raw);
};

describe("tool registry", () => {
  it("has unique slugs, known categories and complete methodology for every calculator", () => {
    const slugs = ALL_TOOLS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const t of ALL_TOOLS) expect(cats.has(t.category)).toBe(true);
    for (const c of CALCULATORS) {
      expect(c.references.length, c.slug).toBeGreaterThan(0);
      expect(c.assumptions.length, c.slug).toBeGreaterThan(0);
      expect(c.limitations.length, c.slug).toBeGreaterThan(0);
      expect(c.formula.length, c.slug).toBeGreaterThan(10);
      expect(c.keywords.length, c.slug).toBeGreaterThan(0);
    }
  });

  it("covers every category and links non-calculator entries honestly", () => {
    for (const cat of CATEGORIES) expect(ALL_TOOLS.some((t) => t.category === cat.id), cat.id).toBe(true);
    for (const t of ALL_TOOLS.filter((x) => x.kind === "planned")) expect(toolHref(t)).toBeNull();
    for (const t of ALL_TOOLS.filter((x) => x.kind === "calculator")) expect(toolHref(t)).toBe(`/tools/${publicSlugFor(t.slug)}`);
  });

  it("every calculator runs on its default inputs without error and explains itself", () => {
    for (const c of CALCULATORS) {
      const r = runWith(c.slug);
      expect(r.error, `${c.slug}: ${r.error}`).toBeUndefined();
      expect(r.headline?.value, c.slug).toBeTruthy();
      expect(r.methods, c.slug).toBeTruthy();
      expect(JSON.stringify(r), c.slug).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it("sample size tools show working steps", () => {
    for (const c of CALCULATORS.filter((x) => x.category === "sample-size")) {
      const r = runWith(c.slug);
      expect(r.steps?.length, c.slug).toBeGreaterThan(0);
    }
  });
});

describe("input validation", () => {
  it("rejects blank, non-numeric and out-of-range fields with the field name", () => {
    const t = getCalculator("sample-size-proportion")!;
    const base = defaults("sample-size-proportion");
    expect(parseNumbers(t.fields, { ...base, p: "" })).toEqual({ error: "Expected proportion is required." });
    expect(parseNumbers(t.fields, { ...base, p: "abc" })).toEqual({ error: "Expected proportion must be a number." });
    expect(parseNumbers(t.fields, { ...base, p: "1.5" })).toEqual({ error: "Expected proportion must be at most 0.999." });
    expect(parseNumbers(t.fields, { ...base, d: "0" })).toEqual({ error: "Margin of error (absolute) must be at least 0.001." });
  });

  it("only validates fields that are visible", () => {
    const t = getCalculator("sample-size-cluster-trial")!;
    const base = { ...defaults("sample-size-cluster-trial"), outcome: "mean", p1: "", p2: "" };
    expect("error" in parseNumbers(t.fields, base)).toBe(false);
  });

  it("parseList reports the offending token and too-few values", () => {
    expect(parseList("1 2 x", "Values")).toBe('Values: "x" is not a number.');
    expect(parseList("5", "Values")).toBe("Values needs at least 2 values.");
    expect(parseList("1, 2;3\n4", "Values")).toEqual([1, 2, 3, 4]);
  });

  it("data tools return friendly errors for bad data", () => {
    expect(runWith("paired-t-test", { x: "1 2 3", y: "1 2" }).error).toMatch(/same number of values/);
    expect(runWith("two-sample-t-test", { x: "1 2 3", y: "a b" }).error).toMatch(/not a number/);
    expect(runWith("one-way-anova", { groups: "1 2 3\n4 5 6" }).error).toMatch(/at least three groups/);
    expect(runWith("simple-logistic-regression", { x: "1 2 3 4 5 6", y: "0 0 0 1 1 1" }).error).toMatch(/separation/);
    expect(runWith("chi-square-test", { a: "-1" }).error).toBeDefined();
    expect(runWith("epidemiology-2x2-table", { a: "0", b: "0" }).error).toMatch(/at least one observation/);
    expect(runWith("sample-size-proportion", { nonresponse: "0.99" }).error).toMatch(/at most 0.95/);
  });
});

describe("headline results on known inputs", () => {
  it("single proportion defaults give 385", () => {
    expect(runWith("sample-size-proportion").headline?.value).toBe("385");
  });
  it("two means defaults (delta 5, SD 10) give 63 per group, 126 total", () => {
    expect(runWith("sample-size-two-means").headline?.value).toBe("126");
  });
  it("nonresponse adjustment divides rather than multiplies: 300 at 10% -> 334", () => {
    expect(runWith("nonresponse-adjustment").headline?.value).toBe("334");
  });
  it("finite population correction 384 in 1000 -> 278", () => {
    expect(runWith("finite-population-correction").headline?.value).toBe("278");
  });
  it("2x2 defaults report RR 2 and OR 2.667", () => {
    const r = runWith("epidemiology-2x2-table");
    expect(r.headline?.value).toMatch(/^2 \(/);
    expect(r.rows?.find(([k]) => k === "Odds ratio")?.[1]).toMatch(/^2\.667/);
  });
  it("diagnostic table gives sensitivity 90% and specificity 85%", () => {
    expect(runWith("diagnostic-test-calculator").headline?.value).toBe("90.0% / 85.0%");
  });
  it("missing-data summary counts NA, blanks and complete cases", () => {
    const r = runWith("missing-data-summary");
    expect(r.headline?.value).toBe("3 of 5 (60.0%)");
    expect(r.table?.rows.find((row) => row[0] === "age")?.[1]).toBe("1");
    expect(r.table?.rows.find((row) => row[0] === "hb")?.[1]).toBe("1");
  });
  it("cumulative incidence and incidence rate", () => {
    expect(runWith("prevalence-calculator").headline?.value).toBe("8.40%");
    expect(runWith("incidence-rate-calculator").headline?.value).toBe("3.529");
  });
});

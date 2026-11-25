import { describe, expect, it } from "vitest";
import { METHODS } from "../engine/registry";
import {
  PLAN_KEYS, PLAN_METHOD_TIER, canUseMethod, checkMethodAccess, methodsForTier, normalizeTier, planComparison, upgradePrompt, type PlanKey,
} from "../entitlements";

// The full access matrix, written out by hand so any reclassification of a method is a deliberate, reviewed change to this file.
const FREE = ["describe", "frequencies", "normality", "crosstab", "ttest_one", "ttest_ind", "ttest_paired", "anova_oneway", "mannwhitney", "wilcoxon", "kruskal", "correlation", "table1"];
const PRO = [...FREE, "friedman", "mcnemar", "cochran_q", "partial_correlation", "linear_regression", "logistic_regression", "risk_2x2", "diagnostic", "roc", "kappa",
  "reliability", "bland_altman", "anova_factorial", "glm", "multinomial_logistic", "ordinal_logistic", "bootstrap_ci", "permutation_test", "standardization"];
const ADVANCED_ONLY = ["kaplan_meier", "cox", "mantel_haenszel", "pca"];
const EXPECTED: Record<PlanKey, string[]> = { free: FREE, pro: PRO, advanced: [...PRO, ...ADVANCED_ONLY], team: [...PRO, ...ADVANCED_ONLY] };
const ALL = METHODS.map((m) => m.id);

describe("statistical entitlements by subscription tier", () => {
  it("covers every registered method exactly once in the expected matrix", () => {
    expect([...EXPECTED.advanced].sort()).toEqual([...ALL].sort());
  });

  for (const plan of PLAN_KEYS) {
    it(`${plan}: allows exactly its methods and refuses every other`, () => {
      const tier = PLAN_METHOD_TIER[plan];
      for (const id of ALL) expect(canUseMethod(tier, id), `${plan} / ${id}`).toBe(EXPECTED[plan].includes(id));
      expect(methodsForTier(tier).map((m) => m.id).sort()).toEqual([...EXPECTED[plan]].sort());
    });

    it(`${plan}: the server check agrees with the browser check for every method`, () => {
      const limits = { plan, method_tier: PLAN_METHOD_TIER[plan] };
      for (const id of ALL) {
        const r = checkMethodAccess(limits, id);
        expect(r.ok, `${plan} / ${id}`).toBe(canUseMethod(limits.method_tier, id));
      }
    });
  }

  it("gives individual Advanced subscribers every method, with no Teams-only statistics", () => {
    expect(methodsForTier(PLAN_METHOD_TIER.advanced)).toHaveLength(METHODS.length);
    expect(PLAN_METHOD_TIER.team).toBe(PLAN_METHOD_TIER.advanced);
    for (const id of ADVANCED_ONLY) expect(canUseMethod(PLAN_METHOD_TIER.advanced, id)).toBe(true);
  });

  it("puts reliability analysis and Bland-Altman agreement in Pro", () => {
    for (const id of ["reliability", "bland_altman"]) {
      expect(canUseMethod(PLAN_METHOD_TIER.free, id)).toBe(false);
      expect(canUseMethod(PLAN_METHOD_TIER.pro, id)).toBe(true);
    }
  });

  it("keeps survival, Cox, Mantel-Haenszel and PCA out of Free and Pro", () => {
    for (const id of ADVANCED_ONLY) for (const plan of ["free", "pro"] as const) expect(canUseMethod(PLAN_METHOD_TIER[plan], id)).toBe(false);
  });

  it("fails closed on an unknown tier or an unknown method", () => {
    expect(normalizeTier("enterprise")).toBe("basic");
    expect(normalizeTier(undefined)).toBe("basic");
    expect(canUseMethod("enterprise", "cox")).toBe(false);
    expect(canUseMethod("advanced", "not_a_method")).toBe(false);
    expect(checkMethodAccess({ plan: "team", method_tier: "advanced" }, "not_a_method")).toEqual({ ok: false, error: "Unknown analysis." });
  });

  it("upgrade prompts name the right plans and never call a method Teams-only", () => {
    const cox = METHODS.find((m) => m.id === "cox")!;
    const r = checkMethodAccess({ plan: "pro", method_tier: "standard" }, "cox");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("Cox proportional hazards is included in Advanced and Teams. This project is on the Pro plan. Upgrade to Advanced to run it.");
    expect(upgradePrompt(METHODS.find((m) => m.id === "bland_altman")!, "free")).toContain("included in Pro, Advanced and Teams");
    expect(upgradePrompt(cox)).toContain("Upgrade to Advanced");
  });

  it("builds the plan comparison from the same rules", () => {
    const { columns, rows } = planComparison();
    expect(columns).toEqual(["Free", "Pro", "Advanced", "Teams"]);
    const row = (label: string) => rows.find((r) => r.label === label)!.values;
    expect(row("Kaplan-Meier and log-rank")).toEqual([false, false, true, true]);
    expect(row("Bland-Altman agreement")).toEqual([false, true, true, true]);
    expect(row("Principal component analysis")).toEqual([false, false, true, true]);
    expect(row("Shared projects and datasets")).toEqual([false, false, false, true]);
    // Teams never has a statistics row that Advanced lacks.
    for (const r of rows.filter((x) => x.group === "Data Studio statistics")) expect(r.values[3]).toBe(r.values[2]);
  });
});

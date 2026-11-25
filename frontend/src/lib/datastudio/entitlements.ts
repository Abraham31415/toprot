// Statistical entitlements for Data Studio: the one place that decides which analyses a subscription tier may run.
//
// Principle: statistical capability follows the researcher's subscription tier. The Teams plan adds collaboration (shared projects,
// datasets and workspaces, roles, team administration), not exclusive access to standard statistical methods, so Teams has exactly the
// statistical access of Advanced.
//
//   Free      basic     essential descriptive and common inferential statistics
//   Pro       standard  + regression, diagnostic accuracy, reliability, Bland-Altman agreement, bootstrapping and other expanded methods
//   Advanced  advanced  every implemented method, including survival analysis, Cox regression, Mantel-Haenszel and PCA
//   Teams     advanced  the same statistics as Advanced, plus collaboration
//
// Which tier each method needs is the `tier` field of its entry in engine/registry.ts. Which tier each plan grants is the method_tier column
// of ds_plan_limits (seeded to match PLAN_METHOD_TIER below, and checked against it by the database tests). The browser uses this module to
// show locks and upgrade prompts; the server action that runs analyses uses the same functions to refuse, so the two cannot disagree.

import { METHOD_BY_ID, METHODS, type MethodDef } from "./engine/registry";

export type Tier = "basic" | "standard" | "advanced";
export const TIERS: readonly Tier[] = ["basic", "standard", "advanced"];
export const TIER_RANK: Record<Tier, number> = { basic: 0, standard: 1, advanced: 2 };

/** Subscription plans, in upgrade order. Keys match public.plans.plan_key. */
export type PlanKey = "free" | "pro" | "advanced" | "team";
export const PLAN_KEYS: readonly PlanKey[] = ["free", "pro", "advanced", "team"];
export const PLAN_NAME: Record<PlanKey, string> = { free: "Free", pro: "Pro", advanced: "Advanced", team: "Teams" };

/** The method tier each plan grants. Teams grants the same statistics as Advanced. */
export const PLAN_METHOD_TIER: Record<PlanKey, Tier> = { free: "basic", pro: "standard", advanced: "advanced", team: "advanced" };

/** The individual plan that first includes a tier (the upgrade target for a locked method). */
export const TIER_MIN_PLAN: Record<Tier, PlanKey> = { basic: "free", standard: "pro", advanced: "advanced" };

/** The statistics level a tier grants, named after the individual plan that introduces it. */
export const TIER_NAME: Record<Tier, string> = { basic: "Free", standard: "Pro", advanced: "Advanced" };

/** Short "who can use this" label for a method tier, for badges and lists. */
export const TIER_LABEL: Record<Tier, string> = { basic: "All plans", standard: "Pro and above", advanced: "Advanced and Teams" };

/** What a tier of statistics covers, for plan comparisons. */
export const TIER_SUMMARY: Record<Tier, string> = {
  basic: "Essential descriptive and common inferential statistics",
  standard: "Adds regression, diagnostic accuracy, reliability, Bland-Altman agreement, bootstrapping and other expanded methods",
  advanced: "Every implemented method, including survival analysis, Cox regression, Mantel-Haenszel and PCA",
};

const isTier = (x: unknown): x is Tier => typeof x === "string" && (TIERS as readonly string[]).includes(x);

/** Reads a tier from untrusted input (a database row, a prop). Anything unrecognised is the lowest tier, so a bad value never grants more. */
export function normalizeTier(x: unknown): Tier { return isTier(x) ? x : "basic"; }

export function planName(planKey: string | null | undefined): string {
  return planKey && planKey in PLAN_NAME ? PLAN_NAME[planKey as PlanKey] : planKey ? planKey.charAt(0).toUpperCase() + planKey.slice(1) : "Free";
}

/** True when a granted tier includes a required tier. */
export function tierIncludes(granted: unknown, required: Tier): boolean { return TIER_RANK[normalizeTier(granted)] >= TIER_RANK[required]; }

/** The tier a method needs, or null for an unknown method. */
export function requiredTier(methodId: string): Tier | null { return METHOD_BY_ID.get(methodId)?.tier ?? null; }

/** True when the granted tier may run the method. Unknown methods are never allowed. */
export function canUseMethod(granted: unknown, methodId: string): boolean {
  const t = requiredTier(methodId);
  return t !== null && tierIncludes(granted, t);
}

/** Every method a tier may run, in registry order. */
export function methodsForTier(granted: unknown): MethodDef[] { return METHODS.filter((m) => tierIncludes(granted, m.tier)); }

/** Plans whose statistics include a tier, in upgrade order (for "Available on ..." text). */
export function plansWithTier(tier: Tier): PlanKey[] { return PLAN_KEYS.filter((p) => tierIncludes(PLAN_METHOD_TIER[p], tier)); }

/** The upgrade prompt for a locked method: which plans include it, and what to upgrade to. */
export function upgradePrompt(def: Pick<MethodDef, "label" | "tier">, currentPlan?: string | null): string {
  const target = PLAN_NAME[TIER_MIN_PLAN[def.tier]];
  const names = plansWithTier(def.tier).map((p) => PLAN_NAME[p]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const on = currentPlan ? ` This project is on the ${planName(currentPlan)} plan.` : "";
  return `${def.label} is included in ${list}.${on} Upgrade to ${target} to run it.`;
}

export type MethodAccess = { ok: true; def: MethodDef } | { ok: false; error: string };

/**
 * The server-side check: may a project whose limits grant `granted` run `methodId`? Used by the analysis server action before anything is
 * loaded or metered, and mirrored in the browser by canUseMethod.
 */
export function checkMethodAccess(limits: { plan?: string | null; method_tier?: unknown }, methodId: string): MethodAccess {
  const def = METHOD_BY_ID.get(methodId);
  if (!def) return { ok: false, error: "Unknown analysis." };
  if (!tierIncludes(limits.method_tier, def.tier)) return { ok: false, error: upgradePrompt(def, limits.plan) };
  return { ok: true, def };
}

/** Methods called out by name in plan comparisons. Their availability is read from the registry, never restated here. */
const HIGHLIGHTED_METHODS = ["linear_regression", "diagnostic", "reliability", "bland_altman", "bootstrap_ci", "kaplan_meier", "cox", "mantel_haenszel", "pca"];

/** Data Studio rows for the plan comparison table: statistics by tier, then what Teams adds. Columns are PLAN_KEYS. */
export function planComparison(): { columns: string[]; rows: { group: string; label: string; values: boolean[] }[] } {
  const rows: { group: string; label: string; values: boolean[] }[] = [];
  for (const t of TIERS) rows.push({ group: "Data Studio statistics", label: TIER_SUMMARY[t], values: PLAN_KEYS.map((p) => tierIncludes(PLAN_METHOD_TIER[p], t)) });
  for (const id of HIGHLIGHTED_METHODS) {
    const def = METHOD_BY_ID.get(id);
    if (def) rows.push({ group: "Data Studio statistics", label: def.label, values: PLAN_KEYS.map((p) => canUseMethod(PLAN_METHOD_TIER[p], id)) });
  }
  for (const label of ["Shared projects and datasets", "Team workspaces and role-based permissions", "Team administration and seat management"]) {
    rows.push({ group: "Collaboration", label, values: PLAN_KEYS.map((p) => p === "team") });
  }
  return { columns: PLAN_KEYS.map((p) => PLAN_NAME[p]), rows };
}

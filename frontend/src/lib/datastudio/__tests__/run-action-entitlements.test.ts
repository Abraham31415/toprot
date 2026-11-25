import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_KEYS, PLAN_METHOD_TIER, type PlanKey } from "../entitlements";

// The backend API (the runAnalysisAction server action) enforces the same entitlements as the browser, before any data is loaded or metered.
const state = vi.hoisted(() => ({ plan: "free" as string, tier: "basic" as string, loaded: 0, complete: false, rpcs: [] as string[], tables: [] as string[] }));
const STUDY = "11111111-1111-4111-8111-111111111111";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/collab/access", () => ({ requireProject: async () => ({ ok: true, userId: "u1", role: "owner", supabase: {} }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ ok: true }) }));
// Any AI ledger call from an analysis would show up here (and fail the "no AI credits" test).
vi.mock("@/lib/ai", () => new Proxy({}, { get: (_t, k) => () => { state.rpcs.push(`ai:${String(k)}`); throw new Error("AI must not be called"); } }));
vi.mock("@/lib/datastudio/server", () => ({
  projectLimits: async () => ({ plan: state.plan, method_tier: state.tier }),
  // Reached only when access is granted. Unless a test asks for a complete run, failing here stops the action without touching storage.
  getVersion: async () => {
    state.loaded++;
    if (!state.complete) throw Object.assign(new Error("stop"), { stop: true });
    return { id: "33333333-3333-4333-8333-333333333333" };
  },
  loadVersionData: async () => ({ variables: [{ name: "x", type: "numeric", measure: "scale", role: "none" }], columns: [[1, 2, 3, 4, 5, 6, 7, 8]] }),
  admin: () => ({
    rpc: async (fn: string) => { state.rpcs.push(fn); return { data: fn === "ds_meter_analysis" ? { ok: true, used: 1, limit: 60 } : null }; },
    from: (table: string) => {
      state.tables.push(table);
      const row = { id: "a1", method: "describe", title: "t", config: {}, result: {}, status: "completed", error: null, version_id: "v", created_at: "", pinned: false, duration_ms: 1, engine_version: "e" };
      const chain = { insert: () => chain, select: () => chain, single: async () => ({ data: row, error: null }) };
      return chain;
    },
  }),
  audit: vi.fn(), usage: vi.fn(), writeVersion: vi.fn(),
}));

const { runAnalysisAction } = await import("@/app/studies/[id]/data/actions");

async function attempt(plan: PlanKey, method: string) {
  state.plan = plan; state.tier = PLAN_METHOD_TIER[plan]; state.loaded = 0;
  const r = await runAnalysisAction(STUDY, "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", method, {});
  return { refused: !r.ok && /is included in/.test(r.error), reachedData: state.loaded > 0, error: r.ok ? "" : r.error };
}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("runAnalysisAction enforces statistical entitlements", () => {
  const cases: [string, PlanKey[]][] = [
    ["describe", ["free", "pro", "advanced", "team"]],
    ["linear_regression", ["pro", "advanced", "team"]],
    ["diagnostic", ["pro", "advanced", "team"]],
    ["reliability", ["pro", "advanced", "team"]],
    ["bland_altman", ["pro", "advanced", "team"]],
    ["bootstrap_ci", ["pro", "advanced", "team"]],
    ["kaplan_meier", ["advanced", "team"]],
    ["cox", ["advanced", "team"]],
    ["mantel_haenszel", ["advanced", "team"]],
    ["pca", ["advanced", "team"]],
  ];
  for (const [method, allowed] of cases) {
    for (const plan of PLAN_KEYS) {
      const ok = allowed.includes(plan);
      it(`${plan} ${ok ? "may" : "may not"} run ${method}`, async () => {
        const r = await attempt(plan, method);
        expect(r.refused).toBe(!ok);
        expect(r.reachedData).toBe(ok);
      });
    }
  }

  it("meters a completed analysis as Data Studio compute and never charges AI credits", async () => {
    state.plan = "advanced"; state.tier = PLAN_METHOD_TIER.advanced; state.loaded = 0; state.complete = true; state.rpcs = []; state.tables = [];
    try {
      const r = await runAnalysisAction(STUDY, "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "describe", { variables: ["x"] });
      expect(r.ok, r.ok ? "" : r.error).toBe(true);
      expect(state.rpcs).toEqual(["ds_meter_analysis"]);
      expect(state.tables).toEqual(["ds_analyses"]);
      expect(state.rpcs.some((x) => x.startsWith("ai"))).toBe(false);
    } finally { state.complete = false; }
  });

  it("refuses an unknown method", async () => {
    const r = await attempt("team", "made_up_method");
    expect(r.error).toBe("Unknown analysis.");
    expect(r.reachedData).toBe(false);
  });

  it("treats an unrecognised tier from the database as the lowest", async () => {
    state.plan = "legacy"; state.tier = "platinum"; state.loaded = 0;
    const r = await runAnalysisAction(STUDY, "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "linear_regression", {});
    expect(!r.ok && r.error).toMatch(/is included in Pro, Advanced and Teams/);
    expect(state.loaded).toBe(0);
  });
});

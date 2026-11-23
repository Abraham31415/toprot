import { describe, expect, it } from "vitest";
import { runAiOperation } from "@/lib/ai/run";
import { AiCallFailure, type RpcClient } from "@/lib/ai/types";

// The funding choice in runAiOperation: own credits by default, a team pool only when chosen, always settled on every exit.
const TEAM = "11111111-1111-4111-8111-111111111111";
const config = {
  feature: { feature_key: "f", max_output_tokens: 1000, max_input_chars: 10000, max_iterations: 1, max_tool_calls: 0, max_op_cost_micro_usd: 100000, enabled: true },
  models: [{ model_id: "m", display_name: "M", tier: "light", input_micro_per_mtok: 1000000, output_micro_per_mtok: 5000000, cache_read_micro_per_mtok: 0, cache_write_5m_micro_per_mtok: 0, cache_write_1h_micro_per_mtok: 0, max_input_tokens: 100000 }],
  credit_value_micro_usd: 1000,
};
const usage = { input: 100, output: 50, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, toolUsage: {}, iterations: 1 };

function fake(opts: { funding?: string | null; teamReserve?: Record<string, unknown>; ownReserve?: Record<string, unknown> } = {}) {
  const calls: string[] = [];
  const rpc: RpcClient["rpc"] = async (fn) => {
    calls.push(fn);
    switch (fn) {
      case "ai_load_config": return { data: config, error: null };
      case "ai_platform_month_status": return { data: { exceeded: false }, error: null };
      case "team_ai_user_funding": return { data: opts.funding ?? null, error: null };
      case "ai_reserve": return { data: opts.ownReserve ?? { ok: true, event_id: "e1", period_id: "p1", plan: "intro", reserved_mcr: 10 }, error: null };
      case "team_ai_reserve": return { data: opts.teamReserve ?? { ok: true, event_id: "e2", period_id: "p1", plan: "intro", reserved_mcr: 10 }, error: null };
      case "ai_commit": return { data: { ok: true, charged_mcr: 5, cost_micro_usd: 500 }, error: null };
      case "ai_release": return { data: { ok: true }, error: null };
      case "team_ai_settle": return { data: { ok: true }, error: null };
      default: return { data: null, error: null };
    }
  };
  return { calls, db: { rpc } as RpcClient };
}
const base = { userId: "u1", feature: "f", idempotencyKey: "key-12345678", inputChars: 100, settleRetryDelayMs: 0 };

describe("AI funding", () => {
  it("charges the requester's own credits by default and never touches a pool", async () => {
    const { db, calls } = fake();
    const r = await runAiOperation({ ...base, db, call: async () => ({ value: "ok", usage }) });
    expect(r.ok).toBe(true);
    expect(calls).toContain("ai_reserve");
    expect(calls).not.toContain("team_ai_reserve");
    expect(calls).not.toContain("team_ai_settle");
  });

  it("uses the team pool only when the person chose it, and settles it after the charge", async () => {
    const { db, calls } = fake({ funding: TEAM });
    const r = await runAiOperation({ ...base, db, call: async () => ({ value: "ok", usage }) });
    expect(r.ok).toBe(true);
    expect(calls).toContain("team_ai_reserve");
    expect(calls).not.toContain("ai_reserve");
    expect(calls.indexOf("ai_commit")).toBeLessThan(calls.indexOf("team_ai_settle"));
  });

  it("settles the pool when the provider fails and when it times out, so no hold is left behind", async () => {
    const a = fake({ funding: TEAM });
    const failed = await runAiOperation({ ...base, db: a.db, call: async () => { throw new AiCallFailure("boom", "provider_error"); } });
    expect(failed.ok).toBe(false);
    expect(a.calls).toEqual(expect.arrayContaining(["ai_release", "team_ai_settle"]));
    const b = fake({ funding: TEAM });
    const slow = await runAiOperation({ ...base, db: b.db, timeoutMs: 5, call: ({ signal }) => new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))) });
    expect(!slow.ok && slow.code).toBe("timeout");
    expect(b.calls).toContain("team_ai_settle");
  });

  it("does not fall back to personal credits when the pool refuses, and says why", async () => {
    const { db, calls } = fake({ funding: TEAM, teamReserve: { ok: false, code: "team_pool_exhausted" } });
    const r = await runAiOperation({ ...base, db, call: async () => ({ value: "never", usage }) });
    expect(!r.ok && r.code).toBe("team_pool_exhausted");
    expect(!r.ok && r.message).toMatch(/switch back to your own credits/i);
    expect(calls).not.toContain("ai_reserve");
    expect(calls).not.toContain("ai_commit");
  });

  it("lets a caller force own-credit funding even if a pool was chosen", async () => {
    const { db, calls } = fake({ funding: TEAM });
    const r = await runAiOperation({ ...base, db, fundingTeamId: null, call: async () => ({ value: "ok", usage }) });
    expect(r.ok).toBe(true);
    expect(calls).toContain("ai_reserve");
    expect(calls).not.toContain("team_ai_user_funding");
  });
});

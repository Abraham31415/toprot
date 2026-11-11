import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAiOperation } from "@/lib/ai/run";
import { TestDb } from "@/lib/ai/__tests__/helpers";
import { loadConfig } from "@/lib/ai/ledger";
import { runAgent, type CreateFn, type ModelResponse } from "../agent";
import { newEvidence } from "../answer";
import type { ProjectData } from "../tools";

// The agent loop running inside the REAL metering path (Postgres credit ledger on a scratch database): reservation,
// the cost ceiling, and charging of actual usage across several passes.

let db: TestDb;
let seq = 0;
const key = () => `assistant-key-${Date.now()}-${++seq}`;

beforeAll(async () => {
  db = await TestDb.create();
  const mig = path.resolve(__dirname, "../../../../../supabase/migrations/20261114090000_ai_research_assistant.sql");
  // Only the tier and settings sections: this scratch database has no studies table for the conversation tables.
  await db.pool.query(readFileSync(mig, "utf8").split("-- 3. Conversations")[0]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.resetState(); });

const FINAL = { summary: "Done.", blocks: [{ heading: null, text: "Answer text.", kind: "analysis", sources: [] }], suggested_searches: [], caveats: [] };
const data: ProjectData = {
  protocolText: async () => "Study title: T", references: async () => [], reference: async () => null, searchPdfs: async () => [], pdfs: async () => [], manuscript: async () => null,
};
const resp = (blocks: ModelResponse["content"], input: number, output: number): ModelResponse => ({ content: blocks, usage: { input_tokens: input, output_tokens: output } });

async function run(userId: string, feature: string, create: CreateFn, inputChars = 20000) {
  const cfg = (await loadConfig(db, feature))!;
  const calls: number[] = [];
  const outcome = await runAiOperation({
    db, userId, feature, idempotencyKey: key(), inputChars, settleRetryDelayMs: 0,
    call: async ({ model, maxOutputTokens, signal, guard }) => {
      const r = await runAgent({
        create: async (req) => { calls.push(req.max_tokens); return create(req); }, model, system: "s", initialUser: "q", tools: ["get_protocol"],
        toolContext: { data, studyId: "s1", documentIds: null, manuscriptIds: [], maxToolOutputChars: 6000, maxDocumentChars: 40000, evidence: newEvidence() },
        guard, signal, maxIterations: cfg.feature.max_iterations, maxOutputTokens, inputBudgetChars: inputChars, maxTotalToolOutputChars: 30000,
      });
      return { value: r, usage: r.usage };
    },
  });
  return { outcome, calls };
}

describe("agent inside the credit ledger", () => {
  it("charges the real usage summed over every pass, on the first model of the tier's chain", async () => {
    const u = await db.newUser();
    let n = 0;
    const create: CreateFn = async () => (++n === 1
      ? resp([{ type: "tool_use", id: "t1", name: "get_protocol", input: {} }], 3000, 200)
      : resp([{ type: "tool_use", id: "t2", name: "final_answer", input: FINAL }], 4000, 400));
    const { outcome } = await run(u, "assistant_standard", create);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.model).toBe("claude-sonnet-5-5");
    expect(outcome.value.stop).toBe("answered");
    // 7,000 input at $2/MTok + 600 output at $10/MTok = 14,000 + 6,000 micro-USD = 20 credits.
    expect(outcome.chargedCredits).toBe(20);
    const p = await db.period(u);
    expect(Number(p.used_mcr)).toBe(20_000);
    expect(Number(p.reserved_mcr)).toBe(0);
    await db.assertConsistent();
  });

  it("uses the lighter model for the light tier", async () => {
    const u = await db.newUser();
    const { outcome } = await run(u, "assistant_light", async () => resp([{ type: "tool_use", id: "t", name: "final_answer", input: FINAL }], 2000, 200));
    expect(outcome.ok && outcome.model).toBe("claude-haiku-5-5");
  });

  it("stops a spendy run at the cost ceiling instead of letting it continue, and records the real usage", async () => {
    const u = await db.newUser();
    let calls = 0;
    const create: CreateFn = async () => { calls++; return resp([{ type: "tool_use", id: `t${calls}`, name: "get_protocol", input: {} }], 30_000, 2_000); };
    const { outcome } = await run(u, "assistant_standard", create);
    expect(calls).toBe(1);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.stop).toBe("cost");
    expect(outcome.chargedCredits).toBe(80); // 30,000 in + 2,000 out
    await db.assertConsistent();
  });

  it("never exceeds the tier's iteration limit even if the model keeps asking for tools", async () => {
    const u = await db.newUser();
    let calls = 0;
    const create: CreateFn = async () => { calls++; return resp([{ type: "tool_use", id: `t${calls}`, name: "get_protocol", input: {} }], 500, 50); };
    const { outcome } = await run(u, "assistant_light", create);
    expect(calls).toBeLessThanOrEqual(3);
    expect(outcome.ok && outcome.value.stop).toBe("iterations");
  });

  it("rate limits a user who sends too many requests, whatever the agent does", async () => {
    const u = await db.newUser();
    const ok: CreateFn = async () => resp([{ type: "tool_use", id: "t", name: "final_answer", input: FINAL }], 500, 50);
    const results = [];
    for (let i = 0; i < 8; i++) results.push((await run(u, "assistant_light", ok)).outcome);
    expect(results.filter((r) => r.ok)).toHaveLength(6);
    expect(results.filter((r) => !r.ok && r.code === "rate_limited")).toHaveLength(2);
  });

  it("rejects an oversize request before any model call", async () => {
    const u = await db.newUser();
    let calls = 0;
    const { outcome } = await run(u, "assistant_light", async () => { calls++; return resp([], 0, 0); }, 31_000);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.code).toBe("input_too_large");
    expect(calls).toBe(0);
  });

  it("does not charge the user when the provider fails on the first call", async () => {
    const u = await db.newUser();
    const { outcome } = await run(u, "assistant_standard", async () => { throw new Error("overloaded"); });
    expect(outcome.ok).toBe(false);
    expect(Number((await db.period(u))?.used_mcr ?? 0)).toBe(0);
    await db.assertConsistent();
  });
});

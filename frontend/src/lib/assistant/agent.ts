import { BudgetExceededError, type BudgetGuard } from "@/lib/ai/limits";
import { addUsage, usageFromAnthropic } from "@/lib/ai/anthropic-usage";
import { estimateInputTokens } from "@/lib/ai/cost";
import type { UsageReport } from "@/lib/ai/types";
import { FinalAnswerSchema, type FinalAnswer } from "./answer";
import { runTool, toolSchemas, type ToolContext } from "./tools";
import type { ToolName } from "./tasks";
import { z } from "zod";

// A bounded agent loop. It cannot run away: every pass goes through BudgetGuard (iterations, tool calls, cost), total
// output tokens, total input size and total tool output are each capped here, and the last allowed pass is forced to
// give an answer. The provider call is injected so the loop can be tested without a network.

export type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };
export type ModelResponse = { content: Block[]; stop_reason?: string | null; usage?: Parameters<typeof usageFromAnthropic>[0] };
type Message = { role: "user" | "assistant"; content: unknown };

export type CreateRequest = {
  model: string;
  max_tokens: number;
  system: string;
  messages: Message[];
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
  tool_choice?: { type: "auto" } | { type: "tool"; name: string };
  signal: AbortSignal;
};
export type CreateFn = (req: CreateRequest) => Promise<ModelResponse>;

export type AgentStop = "answered" | "iterations" | "tool_calls" | "cost" | "output_tokens" | "input_budget" | "no_final_answer" | "interrupted";

export type AgentResult = {
  answer: FinalAnswer | null;
  /** Plain text the model wrote if it never produced a structured answer. */
  looseText: string;
  stop: AgentStop;
  usage: UsageReport;
  iterations: number;
  toolCalls: number;
};

export type AgentOptions = {
  create: CreateFn;
  model: string;
  system: string;
  initialUser: string;
  history?: { role: "user" | "assistant"; content: string }[];
  tools: ToolName[];
  toolContext: ToolContext;
  guard: BudgetGuard;
  signal: AbortSignal;
  maxIterations: number;
  /** Total output tokens the whole run may use. */
  maxOutputTokens: number;
  /** Total characters the model may be sent across all passes. */
  inputBudgetChars: number;
  maxTotalToolOutputChars: number;
};

const FINAL = "final_answer";
const FINAL_SCHEMA = z.toJSONSchema(FinalAnswerSchema) as Record<string, unknown>;
const zero = (): UsageReport => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, toolUsage: {}, iterations: 0 });
const charsOf = (m: Message[]) => JSON.stringify(m).length;

export async function runAgent(o: AgentOptions): Promise<AgentResult> {
  const messages: Message[] = [...(o.history ?? []).map((h) => ({ role: h.role, content: h.content })), { role: "user", content: o.initialUser }];
  const tools = [...toolSchemas(o.tools), { name: FINAL, description: "Give the final answer to the user. Call this exactly once, when you are done.", input_schema: FINAL_SCHEMA }];
  let usage = zero();
  let toolCalls = 0;
  let iterations = 0;
  let toolOutputChars = 0;
  let looseText = "";
  let corrections = 0;

  const done = (stop: AgentStop, answer: FinalAnswer | null = null): AgentResult => ({ answer, looseText, stop, usage, iterations, toolCalls });

  for (;;) {
    try { o.guard.beforeIteration(); }
    catch (e) { if (e instanceof BudgetExceededError) return done(e.limit === "iterations" ? "iterations" : "cost"); throw e; }
    iterations++;

    const outputLeft = o.maxOutputTokens - usage.output;
    if (outputLeft < 200) return done("output_tokens");
    const overInput = estimateInputTokens(charsOf(messages) + o.system.length) > estimateInputTokens(o.inputBudgetChars);
    // The last allowed pass, or an exhausted input or tool budget, must produce the answer now.
    const mustAnswer = iterations >= o.maxIterations || overInput || toolOutputChars >= o.maxTotalToolOutputChars;
    if (overInput && iterations === 1) return done("input_budget");

    let resp: ModelResponse;
    try {
      resp = await o.create({
        model: o.model, max_tokens: Math.min(outputLeft, 4096), system: o.system, messages: messages.slice(), tools, signal: o.signal,
        tool_choice: mustAnswer ? { type: "tool", name: FINAL } : { type: "auto" },
      });
    } catch (e) {
      if (o.signal.aborted) throw e;
      // Keep the usage already incurred; the caller reports the run as interrupted.
      if (iterations > 1) return done("interrupted");
      throw e;
    }
    usage = addUsage(usage, usageFromAnthropic(resp.usage));
    try { o.guard.addUsage(usageFromAnthropic(resp.usage)); }
    catch (e) { if (e instanceof BudgetExceededError) { return finishFromText(resp, "cost"); } throw e; }

    messages.push({ role: "assistant", content: resp.content });
    const uses = resp.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    const text = resp.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) looseText = text;

    if (!uses.length) return done("no_final_answer");

    const results: unknown[] = [];
    let answer: FinalAnswer | null = null;
    for (const u of uses) {
      if (u.name === FINAL) {
        const parsed = FinalAnswerSchema.safeParse(u.input);
        if (parsed.success) { answer = parsed.data; results.push({ type: "tool_result", tool_use_id: u.id, content: "Received." }); }
        else if (corrections < 1 && iterations < o.maxIterations) { corrections++; results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "The answer did not match the required format. Call final_answer again with a valid structure." }); }
        else results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "Invalid answer format." });
        continue;
      }
      try { o.guard.beforeToolCall(); }
      catch (e) {
        if (e instanceof BudgetExceededError) { results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "Tool call limit reached. Give your final answer now with what you have." }); toolOutputChars = o.maxTotalToolOutputChars; continue; }
        throw e;
      }
      toolCalls++;
      let content: string;
      if (toolOutputChars >= o.maxTotalToolOutputChars) content = "Tool output budget used up. Give your final answer now with what you have.";
      else { content = await runTool(u.name, u.input, o.toolContext, o.tools); toolOutputChars += content.length; }
      results.push({ type: "tool_result", tool_use_id: u.id, content });
    }
    if (answer) return done("answered", answer);
    messages.push({ role: "user", content: results });
  }

  function finishFromText(resp: ModelResponse, stop: AgentStop): AgentResult {
    const t = resp.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
    if (t) looseText = t;
    const fin = resp.content.find((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use" && b.name === FINAL);
    const parsed = fin ? FinalAnswerSchema.safeParse(fin.input) : null;
    return done(parsed?.success ? "answered" : stop, parsed?.success ? parsed.data : null);
  }
}

import type { UsageReport } from "./types";

// Maps the `usage` object of an Anthropic Messages response (or the final message of a
// stream) to our UsageReport. Counts come from the provider, never from the model's text.

interface AnthropicUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
  server_tool_use?: { web_search_requests?: number | null; web_fetch_requests?: number | null } | null;
}

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function usageFromAnthropic(u: AnthropicUsageLike | null | undefined, iterations = 1): UsageReport {
  const breakdown = u?.cache_creation;
  const write5m = breakdown ? n(breakdown.ephemeral_5m_input_tokens) : 0;
  const write1h = breakdown ? n(breakdown.ephemeral_1h_input_tokens) : 0;
  const totalWrite = n(u?.cache_creation_input_tokens);
  // If the provider gave only a total, price it at the 5-minute rate; any gap between the
  // total and the breakdown is also priced at the 5-minute rate (never under-count).
  const unassigned = Math.max(totalWrite - write5m - write1h, 0);

  const toolUsage: Record<string, number> = {};
  const search = n(u?.server_tool_use?.web_search_requests);
  const fetchN = n(u?.server_tool_use?.web_fetch_requests);
  if (search) toolUsage.web_search = search;
  if (fetchN) toolUsage.web_fetch = fetchN;

  return {
    input: n(u?.input_tokens),
    output: n(u?.output_tokens),
    cacheRead: n(u?.cache_read_input_tokens),
    cacheWrite5m: write5m + unassigned,
    cacheWrite1h: write1h,
    toolUsage,
    iterations,
  };
}

export function addUsage(a: UsageReport, b: UsageReport): UsageReport {
  const toolUsage = { ...a.toolUsage };
  for (const [k, v] of Object.entries(b.toolUsage)) toolUsage[k] = (toolUsage[k] ?? 0) + v;
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    toolUsage,
    iterations: a.iterations + b.iterations,
  };
}

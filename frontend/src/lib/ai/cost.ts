import type { ModelPrice, UsageReport } from "./types";

// Conservative token estimate used ONLY to size reservations and pick a model.
// The amount charged is always computed in Postgres from the provider's reported usage.
const CHARS_PER_TOKEN = 2.5;
const REQUEST_OVERHEAD_TOKENS = 500;

export function estimateInputTokens(totalInputChars: number): number {
  return Math.ceil(totalInputChars / CHARS_PER_TOKEN) + REQUEST_OVERHEAD_TOKENS;
}

/** Mirrors ai_cost_micro_usd() in SQL (rounded up). Used for estimates and tests, never to bill. */
export function costMicroUsd(
  p: ModelPrice,
  u: Pick<UsageReport, "input" | "output" | "cacheRead" | "cacheWrite5m" | "cacheWrite1h">,
): number {
  const total =
    u.input * p.input_micro_per_mtok +
    u.output * p.output_micro_per_mtok +
    u.cacheRead * p.cache_read_micro_per_mtok +
    u.cacheWrite5m * p.cache_write_5m_micro_per_mtok +
    u.cacheWrite1h * p.cache_write_1h_micro_per_mtok;
  return Math.ceil(total / 1_000_000);
}

/** Worst-case cost of one call: estimated input plus the full output allowance. */
export function worstCaseMicroUsd(p: ModelPrice, inputTokens: number, maxOutputTokens: number): number {
  return costMicroUsd(p, { input: inputTokens, output: maxOutputTokens, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
}

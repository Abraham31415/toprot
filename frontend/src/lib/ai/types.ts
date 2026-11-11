// Shared types for the AI usage / credit system. Server-side only.

export type RpcResult = { data: unknown; error: { message: string } | null };

/** The slice of a Supabase client the ledger needs. Tests supply a pg-backed fake. */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
}

export interface ModelPrice {
  model_id: string;
  display_name: string;
  tier: "light" | "standard" | "deep";
  input_micro_per_mtok: number;
  output_micro_per_mtok: number;
  cache_read_micro_per_mtok: number;
  cache_write_5m_micro_per_mtok: number;
  cache_write_1h_micro_per_mtok: number;
  max_input_tokens: number;
}

export interface FeatureConfig {
  feature_key: string;
  max_output_tokens: number;
  max_input_chars: number;
  max_iterations: number;
  max_tool_calls: number;
  max_op_cost_micro_usd: number;
  enabled: boolean;
}

export interface AiConfig {
  feature: FeatureConfig;
  models: ModelPrice[]; // preference order, active only
  credit_value_micro_usd: number;
}

/** Token and tool usage exactly as reported by the provider response. */
export interface UsageReport {
  input: number; // uncached input tokens
  output: number; // includes thinking tokens
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  toolUsage: Record<string, number>;
  iterations: number;
}

export type AiErrorCode =
  | "unauthenticated"
  | "unavailable" // config could not be loaded: fail closed
  | "feature_disabled"
  | "plan_required" // the user's plan does not include this AI feature
  | "invalid_request"
  | "input_too_large"
  | "insufficient_credits"
  | "platform_budget_exceeded"
  | "op_cost_too_high"
  | "too_many_concurrent"
  | "rate_limited"
  | "duplicate_in_flight"
  | "duplicate_completed"
  | "duplicate_failed"
  | "provider_error"
  | "timeout"
  | "stream_interrupted"
  | "invalid_output"
  | "internal";

export type AiOutcome<T> =
  | { ok: true; value: T; model: string; chargedCredits: number; eventId: string }
  | { ok: false; code: AiErrorCode; message: string; eventId?: string };

/** Throw from a call to say how it failed, optionally with usage that is already known. */
export class AiCallFailure extends Error {
  constructor(
    message: string,
    public readonly kind: "provider_error" | "timeout" | "stream_interrupted" | "invalid_output",
    public readonly usage?: UsageReport,
  ) {
    super(message);
    this.name = "AiCallFailure";
  }
}

export const USER_MESSAGES: Record<AiErrorCode, string> = {
  unauthenticated: "Please sign in to use AI features.",
  unavailable: "AI features are temporarily unavailable. Everything else in ToProt still works.",
  feature_disabled: "This AI feature is currently switched off.",
  plan_required: "This feature is part of Toprot Pro. Open Billing to see the plans.",
  invalid_request: "That request could not be processed.",
  input_too_large: "This is too long for AI review. Shorten the text and try again.",
  insufficient_credits:
    "You don't have enough AI credits for this. Free research tools are unaffected. Credits reset with your next billing period.",
  platform_budget_exceeded: "AI features have reached today's capacity. Please try again tomorrow. Nothing was charged.",
  op_cost_too_high: "This request is too large for a single AI operation.",
  too_many_concurrent: "You already have AI requests running. Wait for them to finish and try again.",
  rate_limited: "You're sending AI requests too quickly. Wait a minute and try again.",
  duplicate_in_flight: "This request is already being processed.",
  duplicate_completed: "This request was already completed. Refresh to see the result.",
  duplicate_failed: "This request already ended without a result. Start a new one.",
  provider_error: "The AI service had a problem. You were not charged. Please try again.",
  timeout: "The AI service took too long to respond. You were not charged. Please try again.",
  stream_interrupted: "The AI response was interrupted. Only the input already processed was charged.",
  invalid_output: "The AI response could not be read. Please try again.",
  internal: "Something went wrong. You were not charged.",
};

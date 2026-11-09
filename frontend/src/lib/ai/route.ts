import { estimateInputTokens, worstCaseMicroUsd } from "./cost";
import type { AiConfig, ModelPrice } from "./types";

export interface Candidate {
  model: ModelPrice;
  worstCaseMicroUsd: number;
}

/**
 * Cost-efficient routing: walk the feature's model chain (preferred model first) and keep
 * the models that can handle the input size and whose worst-case cost fits the per-operation
 * ceiling. The caller tries to reserve them in order, so a user or a platform budget that
 * cannot afford the best model automatically falls back to a cheaper one.
 */
export function routeCandidates(config: AiConfig, totalInputChars: number): Candidate[] {
  const inputTokens = estimateInputTokens(totalInputChars);
  const out: Candidate[] = [];
  for (const model of config.models) {
    if (inputTokens > model.max_input_tokens) continue;
    const worst = worstCaseMicroUsd(model, inputTokens, config.feature.max_output_tokens);
    if (worst > config.feature.max_op_cost_micro_usd) continue;
    out.push({ model, worstCaseMicroUsd: worst });
  }
  return out;
}

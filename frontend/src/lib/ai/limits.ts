import { costMicroUsd } from "./cost";
import type { FeatureConfig, ModelPrice, UsageReport } from "./types";

export class BudgetExceededError extends Error {
  constructor(public readonly limit: "iterations" | "tool_calls" | "cost", message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/**
 * In-process guard for multi-step (agent) operations. Call `beforeIteration` / `beforeToolCall`
 * before doing the work and `addUsage` after each provider response; each throws
 * BudgetExceededError as soon as a limit would be crossed so the loop stops. It never trusts
 * model output: limits come from the feature config, enforced here in backend code.
 */
export class BudgetGuard {
  private iterations = 0;
  private toolCalls = 0;
  private costMicro = 0;

  constructor(
    private readonly feature: Pick<FeatureConfig, "max_iterations" | "max_tool_calls">,
    private readonly model: ModelPrice,
    private readonly costCeilingMicroUsd: number,
  ) {}

  beforeIteration(): void {
    if (this.iterations + 1 > this.feature.max_iterations) {
      throw new BudgetExceededError("iterations", `iteration limit ${this.feature.max_iterations} reached`);
    }
    this.assertCostHeadroom();
    this.iterations += 1;
  }

  beforeToolCall(count = 1): void {
    if (this.toolCalls + count > this.feature.max_tool_calls) {
      throw new BudgetExceededError("tool_calls", `tool call limit ${this.feature.max_tool_calls} reached`);
    }
    this.toolCalls += count;
  }

  addUsage(u: UsageReport): void {
    this.costMicro += costMicroUsd(this.model, u);
    this.assertCostHeadroom();
  }

  get spentMicroUsd(): number {
    return this.costMicro;
  }

  private assertCostHeadroom(): void {
    if (this.costMicro >= this.costCeilingMicroUsd) {
      throw new BudgetExceededError("cost", "operation cost ceiling reached");
    }
  }
}

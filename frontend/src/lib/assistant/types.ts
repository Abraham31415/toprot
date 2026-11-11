import type { VerifiedAnswer } from "./answer";
import type { AgentStop } from "./agent";
import type { Tier } from "./tasks";

export type AssistantAnswerMessage = {
  id: string | null;
  role: "assistant";
  task: string;
  answer: VerifiedAnswer;
  stop: AgentStop;
  tier: Tier;
  model: string;
  routeReasons: string[];
  downgraded: boolean;
  iterations: number;
  toolCalls: number;
  chargedCredits: number;
  createdAt: string;
};
export type AssistantUserMessage = { id: string | null; role: "user"; task: string; text: string; createdAt: string };
export type AssistantMessage = AssistantAnswerMessage | AssistantUserMessage;

export type ThreadSummary = { id: string; title: string; studyId: string | null; updatedAt: string };

export const STOP_NOTICE: Record<AgentStop, string | null> = {
  answered: null,
  iterations: "The assistant stopped because it reached the step limit for this request. The answer may be incomplete.",
  tool_calls: "The assistant stopped because it reached the limit on reading your documents. The answer may be incomplete.",
  cost: "The assistant stopped because it reached the cost limit for one request. The answer may be incomplete.",
  output_tokens: "The assistant stopped because it reached the length limit for one request. The answer may be incomplete.",
  input_budget: "This request involves more material than one request may use. Narrow it (fewer documents or a shorter question) and try again.",
  no_final_answer: "The assistant did not finish in the expected format, so this is its unstructured text.",
  interrupted: "The AI service was interrupted partway. This is what was produced before that.",
};

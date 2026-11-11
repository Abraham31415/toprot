import type { RpcClient } from "@/lib/ai/types";

// Assistant limits that live in ai_settings (editable with SQL). Every value is clamped to a ceiling in code, so a
// mistaken setting can lower a limit but can never remove it.

export type AssistantLimits = {
  maxMessageChars: number;
  maxContextChars: number;
  maxToolOutputChars: number;
  maxTotalToolOutputChars: number;
  maxDocumentChars: number;
  maxDocuments: number;
  dailyRequestsPerUser: number;
  historyMessages: number;
  maxThreads: number;
  maxMessagesPerThread: number;
  deepRequiresPro: boolean;
};

type Spec = { key: string; field: keyof AssistantLimits; def: number; min: number; max: number };
const SPECS: Spec[] = [
  { key: "assistant_max_message_chars", field: "maxMessageChars", def: 4000, min: 200, max: 8000 },
  { key: "assistant_max_context_chars", field: "maxContextChars", def: 24000, min: 2000, max: 60000 },
  { key: "assistant_max_tool_output_chars", field: "maxToolOutputChars", def: 6000, min: 500, max: 12000 },
  { key: "assistant_max_total_tool_output_chars", field: "maxTotalToolOutputChars", def: 30000, min: 2000, max: 80000 },
  { key: "assistant_max_document_chars", field: "maxDocumentChars", def: 40000, min: 2000, max: 100000 },
  { key: "assistant_max_documents", field: "maxDocuments", def: 8, min: 1, max: 20 },
  { key: "assistant_daily_requests_per_user", field: "dailyRequestsPerUser", def: 40, min: 1, max: 500 },
  { key: "assistant_history_messages", field: "historyMessages", def: 6, min: 0, max: 20 },
  { key: "assistant_max_threads", field: "maxThreads", def: 50, min: 1, max: 500 },
  { key: "assistant_max_messages_per_thread", field: "maxMessagesPerThread", def: 40, min: 2, max: 200 },
];

export const DEFAULT_LIMITS: AssistantLimits = {
  maxMessageChars: 4000, maxContextChars: 24000, maxToolOutputChars: 6000, maxTotalToolOutputChars: 30000, maxDocumentChars: 40000,
  maxDocuments: 8, dailyRequestsPerUser: 40, historyMessages: 6, maxThreads: 50, maxMessagesPerThread: 40, deepRequiresPro: false,
};

export function limitsFromSettings(rows: { key: string; value_num: number | string }[]): AssistantLimits {
  const out: AssistantLimits = { ...DEFAULT_LIMITS };
  const byKey = new Map(rows.map((r) => [r.key, Number(r.value_num)]));
  for (const s of SPECS) {
    const v = byKey.get(s.key);
    (out[s.field] as number) = Number.isFinite(v) ? Math.min(Math.max(Math.floor(v as number), s.min), s.max) : s.def;
  }
  out.deepRequiresPro = byKey.get("assistant_deep_requires_pro") === 1;
  return out;
}

type SettingsReader = { from(table: string): { select(cols: string): PromiseLike<{ data: unknown; error: unknown }> } };

/** Loads limits with the service role. If settings cannot be read, safe defaults apply (never "no limit"). */
export async function loadAssistantLimits(db: SettingsReader): Promise<AssistantLimits> {
  try {
    const { data, error } = await db.from("ai_settings").select("key, value_num");
    if (error || !Array.isArray(data)) return DEFAULT_LIMITS;
    return limitsFromSettings(data as { key: string; value_num: number }[]);
  } catch {
    return DEFAULT_LIMITS;
  }
}

export type { RpcClient };

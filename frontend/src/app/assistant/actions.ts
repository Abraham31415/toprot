"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { USER_MESSAGES, runAiOperation } from "@/lib/ai";
import { loadConfig } from "@/lib/ai/ledger";
import { isUuid } from "@/lib/refs/validate";
import { runAgent, type CreateFn } from "@/lib/assistant/agent";
import { newEvidence, verifiedFromText, verifyFinalAnswer, type VerifiedAnswer } from "@/lib/assistant/answer";
import { knownRefsFor, supabaseProjectData } from "@/lib/assistant/data";
import { loadAssistantLimits } from "@/lib/assistant/limits";
import { buildSystem } from "@/lib/assistant/prompts";
import { routeRequest } from "@/lib/assistant/router";
import { getTask } from "@/lib/assistant/tasks";
import { STOP_NOTICE, type AssistantAnswerMessage, type AssistantMessage, type ThreadSummary } from "@/lib/assistant/types";

// The assistant request pipeline. Order matters: authenticate, validate and bound every input, check access to each
// project item through the user's own session, route to a tier, reserve credits, run the bounded agent, verify the
// answer, then store it. Everything the model returns is verified against what it actually read before the user sees it.

export type AskInput = {
  threadId?: string | null; studyId?: string | null; task: string; message: string;
  manuscriptId?: string | null; documentIds?: string[]; thorough?: boolean; idempotencyKey: string;
};
export type AskResult = { error: string } | { threadId: string; message: AssistantAnswerMessage };

const utcDayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

export async function askAssistant(input: AskInput): Promise<AskResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { error: "The AI assistant is not configured yet (the ANTHROPIC_API_KEY environment variable is missing)." };
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: USER_MESSAGES.unauthenticated };
  const admin = createAdminClient();
  const limits = await loadAssistantLimits(admin);

  // ---- Validate and bound the request ----
  const task = getTask(input.task);
  if (!task) return { error: "Choose what you want help with." };
  const message = (input.message ?? "").replace(/\s+/g, " ").trim();
  if (message.length < 3) return { error: "Write your question first." };
  if (message.length > limits.maxMessageChars) return { error: `Your message is over ${limits.maxMessageChars} characters. Shorten it.` };
  if (!input.idempotencyKey || input.idempotencyKey.length > 100) return { error: "Invalid request." };
  const studyId = input.studyId && isUuid(input.studyId) ? input.studyId : null;
  if (input.studyId && !studyId) return { error: "Invalid project." };
  if (task.needsStudy && !studyId) return { error: "Choose the project this is about." };
  const manuscriptId = input.manuscriptId && isUuid(input.manuscriptId) ? input.manuscriptId : null;
  if (task.needsManuscript && !manuscriptId) return { error: "Choose the manuscript this is about." };
  const picked = [...new Set((input.documentIds ?? []).filter(isUuid))];
  if (picked.length > limits.maxDocuments) return { error: `Select at most ${limits.maxDocuments} PDFs.` };

  // ---- Access: everything is checked through the user's own session (row-level security) ----
  let studyTitle = "";
  if (studyId) {
    const { data: study } = await db.from("studies").select("title").eq("id", studyId).single();
    if (!study) return { error: "That project was not found." };
    studyTitle = study.title as string;
  }
  let manuscriptTitle = "";
  if (manuscriptId) {
    const { data: ms } = await db.from("manuscripts").select("title").eq("id", manuscriptId).eq("study_id", studyId ?? "").single();
    if (!ms) return { error: "That manuscript was not found in this project." };
    manuscriptTitle = ms.title as string;
  }
  let scope: string[] = [];
  if (picked.length) {
    const { data: docs } = await db.from("pdf_documents").select("id").eq("status", "ready").in("id", picked);
    if ((docs ?? []).length !== picked.length) return { error: "Some selected PDFs were not found or have no searchable text." };
    scope = picked;
  } else if (studyId) {
    const { data: docs } = await db.from("pdf_documents").select("id").eq("status", "ready").eq("study_id", studyId).limit(limits.maxDocuments);
    scope = (docs ?? []).map((d) => d.id as string);
  }

  // ---- Frequency and conversation limits ----
  const { count: today } = await admin.from("assistant_messages").select("id", { count: "exact", head: true }).eq("owner_id", user.id).eq("role", "assistant").gte("created_at", utcDayStart());
  if ((today ?? 0) >= limits.dailyRequestsPerUser) return { error: `You have reached today's limit of ${limits.dailyRequestsPerUser} assistant requests. It resets at midnight UTC.` };
  let threadId: string | null = null;
  let history: { role: "user" | "assistant"; content: string }[] = [];
  if (input.threadId) {
    if (!isUuid(input.threadId)) return { error: "Invalid conversation." };
    const { data: t } = await db.from("assistant_threads").select("id").eq("id", input.threadId).single();
    if (!t) return { error: "That conversation was not found." };
    const { data: msgs } = await db.from("assistant_messages").select("role, content").eq("thread_id", input.threadId).order("created_at", { ascending: false }).limit(Math.max(limits.maxMessagesPerThread, limits.historyMessages) + 1);
    if ((msgs ?? []).length >= limits.maxMessagesPerThread) return { error: "This conversation is full. Start a new one." };
    threadId = input.threadId;
    history = (msgs ?? []).slice(0, limits.historyMessages).reverse().map((m) => {
      const c = m.content as { text?: string; answer?: VerifiedAnswer };
      const text = m.role === "user" ? (c.text ?? "") : [c.answer?.summary, ...(c.answer?.blocks ?? []).map((b) => b.text)].filter(Boolean).join("\n").slice(0, 1500);
      return { role: m.role as "user" | "assistant", content: text || "(empty)" };
    });
    // The API requires the conversation to start with a user turn and alternate.
    while (history.length && history[0].role !== "user") history.shift();
    history = history.filter((h, i) => i === 0 || h.role !== history[i - 1].role);
  } else {
    const { count: threads } = await admin.from("assistant_threads").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
    if ((threads ?? 0) >= limits.maxThreads) return { error: "You have the maximum number of conversations. Delete some to start a new one." };
  }

  // ---- Route ----
  const card = [
    studyTitle ? `Project: ${studyTitle} (id ${studyId})` : "No project selected.",
    manuscriptId ? `Manuscript for this request: "${manuscriptTitle}" (id ${manuscriptId})` : "",
    scope.length ? `${scope.length} uploaded PDF(s) are in scope; use list_pdfs and search_pdfs.` : "",
  ].filter(Boolean).join("\n");
  const userText = `${card}\n\nRequest: ${message}`;
  const contextChars = userText.length + history.reduce((n, h) => n + h.content.length, 0);
  // The plan (a row in the plans table, resolved in Postgres) decides whether the deep tier is allowed.
  let deepByPlan = !limits.deepRequiresPro;
  try { const r = await admin.rpc("ai_plan_allows", { p_user: user.id, p_feature: "assistant_deep" }); if (!r.error) deepByPlan = r.data === true; } catch { /* keep the setting-based default */ }
  const route = routeRequest(
    { task: task.id, messageChars: message.length, contextChars, documentCount: scope.length + (manuscriptId ? 1 : 0), thorough: !!input.thorough, deepAllowed: deepByPlan },
    !!studyId, scope.length > 0, !!manuscriptId,
  );

  const cfg = await loadConfig(admin, route.featureKey);
  if (!cfg) return { error: USER_MESSAGES.unavailable };
  const system = buildSystem(task, route.tools);
  const perPassChars = system.length + contextChars + (route.tools.length ? limits.maxTotalToolOutputChars : 0);
  const reserveChars = Math.min(cfg.feature.max_input_chars, perPassChars * Math.min(cfg.feature.max_iterations, 4));
  if (perPassChars > cfg.feature.max_input_chars) return { error: USER_MESSAGES.input_too_large };

  const known = await knownRefsFor(db, studyId);
  const evidence = newEvidence();
  const client = new Anthropic();
  const create: CreateFn = async (req) => {
    const r = await client.messages.create(
      { model: req.model, max_tokens: req.max_tokens, system: req.system, messages: req.messages as never, tools: req.tools as never, tool_choice: req.tool_choice as never },
      { signal: req.signal },
    );
    return { content: r.content as never, stop_reason: r.stop_reason, usage: r.usage };
  };

  const outcome = await runAiOperation({
    db: admin, userId: user.id, feature: route.featureKey, idempotencyKey: input.idempotencyKey,
    inputChars: reserveChars, untrustedText: message, timeoutMs: 55_000,
    call: async ({ model, maxOutputTokens, signal, guard }) => {
      const run = await runAgent({
        create, model, system, initialUser: userText, history, tools: route.tools,
        toolContext: { data: supabaseProjectData(db), studyId, documentIds: scope.length ? scope : null, manuscriptIds: manuscriptId ? [manuscriptId] : [], maxToolOutputChars: limits.maxToolOutputChars, maxDocumentChars: limits.maxDocumentChars, evidence },
        guard, signal, maxIterations: cfg.feature.max_iterations, maxOutputTokens, inputBudgetChars: perPassChars, maxTotalToolOutputChars: limits.maxTotalToolOutputChars,
      });
      const notice = STOP_NOTICE[run.stop];
      const answer: VerifiedAnswer = run.answer
        ? verifyFinalAnswer(run.answer, evidence, known)
        : verifiedFromText(run.looseText, known, notice ?? "The assistant did not produce an answer.");
      if (run.answer && notice) answer.caveats.unshift(notice);
      return { value: { answer, run }, usage: run.usage };
    },
  });
  if (!outcome.ok) return { error: outcome.message };

  // ---- Store ----
  const now = new Date().toISOString();
  const { answer, run } = outcome.value;
  const out: AssistantAnswerMessage = {
    id: null, role: "assistant", task: task.id, answer, stop: run.stop, tier: route.tier, model: outcome.model, routeReasons: route.reasons,
    downgraded: route.downgraded, iterations: run.iterations, toolCalls: run.toolCalls, chargedCredits: outcome.chargedCredits, createdAt: now,
  };
  try {
    if (!threadId) {
      const { data: t, error } = await admin.from("assistant_threads").insert({ owner_id: user.id, study_id: studyId, title: message.slice(0, 120) }).select("id").single();
      if (error || !t) throw new Error("thread");
      threadId = t.id as string;
    }
    await admin.from("assistant_messages").insert({ thread_id: threadId, owner_id: user.id, role: "user", task: task.id, content: { text: message }, created_at: new Date(Date.now() - 1000).toISOString() });
    const { data: saved } = await admin.from("assistant_messages").insert({
      thread_id: threadId, owner_id: user.id, role: "assistant", task: task.id, model: outcome.model, tier: route.tier, charged_credits: outcome.chargedCredits,
      content: { answer, stop: run.stop, routeReasons: route.reasons, downgraded: route.downgraded, iterations: run.iterations, toolCalls: run.toolCalls },
    }).select("id").single();
    out.id = (saved?.id as string | undefined) ?? null;
    await admin.from("assistant_threads").update({ updated_at: now }).eq("id", threadId);
  } catch {
    // The answer is still shown; it just was not saved to the history.
  }
  revalidatePath("/assistant");
  return { threadId: threadId ?? "", message: out };
}

export async function listThreads(): Promise<ThreadSummary[]> {
  const db = await createClient();
  const { data } = await db.from("assistant_threads").select("id, title, study_id, updated_at").order("updated_at", { ascending: false }).limit(50);
  return (data ?? []).map((t) => ({ id: t.id as string, title: t.title as string, studyId: (t.study_id as string | null) ?? null, updatedAt: t.updated_at as string }));
}

export async function getThread(id: string): Promise<{ messages: AssistantMessage[] } | { error: string }> {
  if (!isUuid(id)) return { error: "Invalid conversation." };
  const db = await createClient();
  const { data, error } = await db.from("assistant_messages").select("id, role, task, content, model, tier, charged_credits, created_at").eq("thread_id", id).order("created_at");
  if (error) return { error: "Could not load the conversation." };
  const messages: AssistantMessage[] = (data ?? []).map((m) => {
    const c = m.content as Record<string, unknown>;
    if (m.role === "user") return { id: m.id as string, role: "user", task: (m.task as string) ?? "", text: String(c.text ?? ""), createdAt: m.created_at as string };
    return {
      id: m.id as string, role: "assistant", task: (m.task as string) ?? "", answer: c.answer as VerifiedAnswer, stop: (c.stop as AssistantAnswerMessage["stop"]) ?? "answered",
      tier: (m.tier as AssistantAnswerMessage["tier"]) ?? "standard", model: (m.model as string) ?? "", routeReasons: (c.routeReasons as string[]) ?? [], downgraded: !!c.downgraded,
      iterations: Number(c.iterations ?? 0), toolCalls: Number(c.toolCalls ?? 0), chargedCredits: Number(m.charged_credits ?? 0), createdAt: m.created_at as string,
    };
  });
  return { messages };
}

export async function deleteThread(id: string): Promise<{ error?: string }> {
  if (!isUuid(id)) return { error: "Invalid conversation." };
  const db = await createClient();
  const { error } = await db.from("assistant_threads").delete().eq("id", id);
  if (error) return { error: "Could not delete the conversation." };
  revalidatePath("/assistant");
  return {};
}

export type ProjectOptions = { studies: { id: string; title: string }[]; manuscripts: { id: string; study_id: string; title: string }[]; pdfs: { id: string; title: string; study_id: string | null }[] };

export async function loadProjectOptions(): Promise<ProjectOptions> {
  const db = await createClient();
  const [{ data: studies }, { data: manuscripts }, { data: pdfs }] = await Promise.all([
    db.from("studies").select("id, title").order("title"),
    db.from("manuscripts").select("id, study_id, title").order("updated_at", { ascending: false }).limit(100),
    db.from("pdf_documents").select("id, title, study_id").eq("status", "ready").order("created_at", { ascending: false }).limit(100),
  ]);
  return { studies: (studies ?? []) as ProjectOptions["studies"], manuscripts: (manuscripts ?? []) as ProjectOptions["manuscripts"], pdfs: (pdfs ?? []) as ProjectOptions["pdfs"] };
}

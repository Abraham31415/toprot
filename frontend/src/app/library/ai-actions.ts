"use server";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AiCallFailure, USER_MESSAGES, UNTRUSTED_SYSTEM_NOTICE, runAiOperation, usageFromAnthropic } from "@/lib/ai";
import {
  ASK_SYSTEM, AskSchema, buildAskUser, buildCompareUser, COMPARE_SYSTEM, CompareSchema, takeWithinBudget, verifyAnswer, verifyComparison,
  type AskResult, type ComparePaper, type Passage, type VerifiedPaper,
} from "@/lib/pdf/qa";
import { isUuid } from "@/lib/refs/validate";

// Questions are answered only from passages retrieved (by full-text search) from the caller's own PDFs. The model's
// output is then checked against the stored text: see lib/pdf/qa.ts. Metered like every other AI feature.

type Db = Awaited<ReturnType<typeof createClient>>;
type Row = { chunk_id: number; document_id: string; page: number; idx: number; text: string };

const ASK_CHARS = 16_000, ASK_COUNT = 10;
const COMPARE_QUERY = "study design setting participants population sample size exposure intervention outcome measured results findings conclusion limitations";

async function loadDocs(db: Db, ids: string[]): Promise<{ id: string; title: string; status: string }[]> {
  const q = db.from("pdf_documents").select("id, title, status").eq("status", "ready");
  const { data } = ids.length ? await q.in("id", ids) : await q.limit(100);
  return (data ?? []) as { id: string; title: string; status: string }[];
}

async function search(db: Db, query: string, ids: string[], limit: number): Promise<Row[]> {
  const { data } = await db.rpc("search_pdf_chunks", { p_query: query, p_document_ids: ids.length ? ids : null, p_limit: limit });
  return (data ?? []) as Row[];
}

async function auth(): Promise<{ db: Db; userId: string } | { error: string }> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: USER_MESSAGES.unauthenticated };
  if (!process.env.ANTHROPIC_API_KEY) return { error: "Document questions are not configured yet (the ANTHROPIC_API_KEY environment variable is missing)." };
  return { db, userId: user.id };
}

export type AskResponse = { error: string } | { result: AskResult; usedAi: boolean };

export async function askDocuments(question: string, documentIds: string[], idempotencyKey: string): Promise<AskResponse> {
  const a = await auth();
  if ("error" in a) return a;
  const q = question.replace(/\s+/g, " ").trim();
  if (q.length < 5 || q.length > 1000) return { error: "Ask a question of 5 to 1000 characters." };
  if (!idempotencyKey || idempotencyKey.length > 100) return { error: "Invalid request." };
  const ids = documentIds.filter(isUuid).slice(0, 20);

  const docs = await loadDocs(a.db, ids);
  if (!docs.length) return { error: ids.length ? "None of the selected PDFs has searchable text." : "Your library has no PDFs with searchable text yet." };
  const titles = new Map(docs.map((d) => [d.id, d.title]));
  const rows = await search(a.db, q, docs.map((d) => d.id), 14);
  const picked = takeWithinBudget(rows, ASK_CHARS, ASK_COUNT);
  if (!picked.length) {
    // Nothing matched, so there is nothing to ground an answer in and no AI call (and no charge) is made.
    return { usedAi: false, result: { found: false, note: "No passage in the selected PDFs matches your question. Try different words, or select more documents.", points: [], sources: [] } };
  }
  const passages: Passage[] = picked.map((r, i) => ({ n: i + 1, documentId: r.document_id, title: titles.get(r.document_id) ?? "PDF", page: r.page, text: r.text }));

  const system = ASK_SYSTEM + UNTRUSTED_SYSTEM_NOTICE;
  const user = buildAskUser(q, passages);
  const client = new Anthropic();
  const outcome = await runAiOperation({
    db: createAdminClient(), userId: a.userId, feature: "pdf_qa", idempotencyKey,
    inputChars: system.length + user.length, untrustedText: passages.map((p) => p.text).join("\n") + "\n" + q,
    call: async ({ model, maxOutputTokens, signal }) => {
      let response;
      try {
        response = await client.messages.parse({ model, max_tokens: maxOutputTokens, system, messages: [{ role: "user", content: user }], output_config: { format: zodOutputFormat(AskSchema) } }, { signal });
      } catch (err) { throw new AiCallFailure((err as Error).message, "provider_error"); }
      const usage = usageFromAnthropic(response.usage);
      if (!response.parsed_output) throw new AiCallFailure("unparseable model output", "invalid_output", usage);
      return { value: verifyAnswer(response.parsed_output, passages), usage };
    },
  });
  if (!outcome.ok) return { error: outcome.message };
  return { result: outcome.value, usedAi: true };
}

export type CompareResponse = { error: string } | { papers: VerifiedPaper[] };

export async function compareDocuments(documentIds: string[], idempotencyKey: string): Promise<CompareResponse> {
  const a = await auth();
  if ("error" in a) return a;
  if (!idempotencyKey || idempotencyKey.length > 100) return { error: "Invalid request." };
  const ids = [...new Set(documentIds.filter(isUuid))];
  if (ids.length < 2 || ids.length > 4) return { error: "Choose 2 to 4 PDFs to compare." };
  const docs = await loadDocs(a.db, ids);
  if (docs.length !== ids.length) return { error: "Every PDF you compare needs searchable text. A scanned PDF cannot be compared." };

  const perDocChars = Math.floor(60_000 / ids.length);
  const passages: Passage[] = [];
  const papers: ComparePaper[] = [];
  for (const [i, d] of ids.map((id) => docs.find((x) => x.id === id)!).entries()) {
    const [top, opening] = await Promise.all([
      search(a.db, COMPARE_QUERY, [d.id], 12),
      a.db.from("pdf_chunks").select("id, document_id, page, idx, text").eq("document_id", d.id).order("page", { ascending: true }).order("idx", { ascending: true }).limit(3),
    ]);
    const seen = new Set<number>();
    const merged: Row[] = [];
    for (const r of [...((opening.data ?? []).map((c) => ({ chunk_id: c.id as number, document_id: c.document_id as string, page: c.page as number, idx: c.idx as number, text: c.text as string }))), ...top]) {
      if (!seen.has(r.chunk_id)) { seen.add(r.chunk_id); merged.push(r); }
    }
    merged.sort((x, y) => x.page - y.page || x.idx - y.idx);
    const chosen = takeWithinBudget(merged, perDocChars, 10);
    papers.push({ n: i + 1, documentId: d.id, title: d.title });
    for (const r of chosen) passages.push({ n: passages.length + 1, documentId: d.id, title: d.title, page: r.page, text: r.text });
  }

  const system = COMPARE_SYSTEM + UNTRUSTED_SYSTEM_NOTICE;
  const user = buildCompareUser(papers, passages);
  const client = new Anthropic();
  const outcome = await runAiOperation({
    db: createAdminClient(), userId: a.userId, feature: "pdf_compare", idempotencyKey,
    inputChars: system.length + user.length, untrustedText: passages.map((p) => p.text).join("\n"),
    call: async ({ model, maxOutputTokens, signal }) => {
      let response;
      try {
        response = await client.messages.parse({ model, max_tokens: maxOutputTokens, system, messages: [{ role: "user", content: user }], output_config: { format: zodOutputFormat(CompareSchema) } }, { signal });
      } catch (err) { throw new AiCallFailure((err as Error).message, "provider_error"); }
      const usage = usageFromAnthropic(response.usage);
      if (!response.parsed_output) throw new AiCallFailure("unparseable model output", "invalid_output", usage);
      return { value: verifyComparison(response.parsed_output, papers, passages), usage };
    },
  });
  if (!outcome.ok) return { error: outcome.message };
  return { papers: outcome.value };
}

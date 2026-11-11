import { z } from "zod";
import { wrapUntrusted } from "@/lib/ai/untrusted";

// Grounded question answering over the user's own PDFs.
//
// The model is only ever given numbered excerpts. For each point it makes it must also copy the exact words from the
// excerpt that support it. This module then CHECKS that copy against the stored text. A point whose quote is found is
// "verified source information" (with its document and PDF page); anything else is shown as AI interpretation. The
// model's own wording is never presented as a quotation, and nothing is verified because the model says it is.

export type Passage = { n: number; documentId: string; title: string; page: number; text: string };

// ---- Matching a quote against a passage ----

const LIGATURES: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl" };
const DASHES = /[‐-―−]/;

/** Lower-cases and normalises quotes, dashes, ligatures and whitespace, and records where each output character came from. */
export function normalizeWithMap(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "­" || ch === "​" || ch === "‌" || ch === "‍" || ch === "﻿") continue;
    let out: string;
    if (/\s/.test(ch)) { if (lastSpace) continue; out = " "; lastSpace = true; }
    else {
      lastSpace = false;
      out = LIGATURES[ch] ?? (/[‘’‛]/.test(ch) ? "'" : /[“”„]/.test(ch) ? '"' : DASHES.test(ch) ? "-" : ch.toLowerCase());
    }
    for (const c of out) { text += c; map.push(i); }
  }
  return { text, map };
}

export const MIN_FRAGMENT = 12;
const ELLIPSIS = /\s*(?:\.{3}|…)\s*/;

/**
 * Finds a quote in a passage. A quote may skip text with "..." as long as each fragment appears in order.
 * Returns the passage's own words for the quoted span, or null if any fragment is missing or too short to mean anything.
 */
export function locateQuote(passage: string, quote: string): string | null {
  const fragments = quote.trim().split(ELLIPSIS).map((f) => f.trim()).filter(Boolean);
  if (!fragments.length) return null;
  const hay = normalizeWithMap(passage);
  let from = 0;
  let start = -1, end = -1;
  const out: string[] = [];
  for (const f of fragments) {
    const needle = normalizeWithMap(f).text.replace(/^[\s"'.,;:]+|[\s"'.,;:]+$/g, "");
    if (needle.length < MIN_FRAGMENT) return null;
    const at = hay.text.indexOf(needle, from);
    if (at < 0) return null;
    const s = hay.map[at], e = hay.map[at + needle.length - 1] + 1;
    if (start < 0) start = s;
    end = e;
    out.push(passage.slice(s, e));
    from = at + needle.length;
  }
  return start < 0 ? null : out.join(" ... ");
}

const NUM = /\d+(?:[.,]\d+)?/g;
/** Numbers the AI wrote that do not appear in the quote it relies on. A mismatch is shown to the user. */
export function unmatchedNumbers(statement: string, quote: string): string[] {
  const inQuote = new Set((quote.match(NUM) ?? []).map((n) => n.replace(",", ".")));
  return [...new Set((statement.match(NUM) ?? []).map((n) => n.replace(",", ".")))].filter((n) => !inQuote.has(n));
}

// ---- Question answering ----

export const AskSchema = z.object({
  found: z.boolean().describe("true only if the excerpts contain information that answers the question"),
  points: z.array(z.object({
    statement: z.string().describe("One claim, in your own words, that the excerpts support"),
    passage: z.number().int().nullable().describe("The number of the excerpt that supports it, or null"),
    quote: z.string().nullable().describe("Words copied exactly from that excerpt, at most 300 characters, or null if you cannot quote support"),
  })).max(8),
  note: z.string().nullable().describe("A limitation the reader should know, for example that the excerpts only cover part of the paper"),
});
export type AskModelOutput = z.infer<typeof AskSchema>;

export const ASK_SYSTEM = `You answer questions about documents a researcher uploaded to their private library. You are given numbered excerpts taken from those documents, each with its document title and PDF page.

Rules:
- Use ONLY the excerpts. Never add facts from your own knowledge, even if you are sure of them.
- If the excerpts do not answer the question, set found to false, return no points, and say in note what is missing. Do not guess.
- Each point has a statement (a claim in your own words) and a quote. The quote must be copied EXACTLY, character for character, from the excerpt you cite in passage, at most 300 characters and at least a full phrase (about 15 characters or more). You may join separated parts of one excerpt with "...". Never paraphrase inside a quote.
- If no excerpt supports a claim, do not make the claim. If you can state the support only loosely, set quote to null.
- Do not state numbers, units, p-values or percentages that are not in your quote.
- Say nothing that is clinical advice or a judgement of the study's quality unless an excerpt says it.
- Keep it short: at most 8 points.`;

export function formatPassages(passages: Passage[]): string {
  return passages.map((p) => `[Excerpt ${p.n}] ${p.title} (PDF page ${p.page})\n${p.text}`).join("\n\n");
}

export function buildAskUser(question: string, passages: Passage[]): string {
  return wrapUntrusted(`Question: ${question}\n\nExcerpts:\n\n${formatPassages(passages)}`);
}

export type VerifiedPoint = {
  statement: string;
  status: "verified" | "unverified";
  /** The document's own words, taken from the stored text (never the model's copy). */
  quote?: string;
  documentId?: string;
  title?: string;
  page?: number;
  numbersNotInQuote: string[];
};
export type AskResult = { found: boolean; note: string | null; points: VerifiedPoint[]; sources: Passage[] };

function verifyOne(statement: string, passageN: number | null, quote: string | null, passages: Passage[]): VerifiedPoint {
  const base = { statement: statement.trim().slice(0, 1200), numbersNotInQuote: [] as string[] };
  const cited = passageN === null ? undefined : passages.find((p) => p.n === passageN);
  const q = quote?.trim().slice(0, 600);
  if (q) {
    // Prefer the passage the model cited, but accept the same words anywhere in the excerpts it was given.
    for (const p of cited ? [cited, ...passages.filter((x) => x !== cited)] : passages) {
      const found = locateQuote(p.text, q);
      if (found) return { ...base, status: "verified", quote: found, documentId: p.documentId, title: p.title, page: p.page, numbersNotInQuote: unmatchedNumbers(base.statement, found) };
    }
  }
  return { ...base, status: "unverified", ...(cited ? { documentId: cited.documentId, title: cited.title, page: cited.page } : {}) };
}

export function verifyAnswer(out: AskModelOutput, passages: Passage[]): AskResult {
  const points = out.found ? out.points.filter((p) => p.statement.trim()).map((p) => verifyOne(p.statement, p.passage, p.quote, passages)) : [];
  const used = new Set<number>();
  for (const p of points.filter((x) => x.status === "verified")) { const src = passages.find((x) => x.documentId === p.documentId && x.page === p.page); if (src) used.add(src.n); }
  return { found: out.found && points.length > 0, note: out.note?.trim().slice(0, 600) || null, points, sources: passages.filter((p) => used.has(p.n)) };
}

// ---- Comparing papers ----

export const COMPARE_FIELDS = [
  { id: "design", label: "Study design" },
  { id: "setting_population", label: "Setting and population" },
  { id: "sample_size", label: "Sample size" },
  { id: "exposure_or_intervention", label: "Exposure or intervention" },
  { id: "outcomes", label: "Outcomes measured" },
  { id: "main_findings", label: "Main findings" },
  { id: "limitations", label: "Limitations stated by the authors" },
] as const;
export type CompareField = (typeof COMPARE_FIELDS)[number]["id"];

export const CompareSchema = z.object({
  papers: z.array(z.object({
    paper: z.number().int().describe("The paper number from the excerpts"),
    cells: z.array(z.object({
      field: z.enum(COMPARE_FIELDS.map((f) => f.id) as [CompareField, ...CompareField[]]),
      value: z.string().describe("What the paper states, briefly, or exactly 'Not stated in the excerpts'"),
      passage: z.number().int().nullable(),
      quote: z.string().nullable().describe("Words copied exactly from that excerpt, at most 300 characters, or null"),
    })),
  })),
});
export type CompareModelOutput = z.infer<typeof CompareSchema>;

export const NOT_STATED = "Not stated in the excerpts";

export const COMPARE_SYSTEM = `You build a side-by-side comparison of research papers a user uploaded. You are given numbered excerpts for each numbered paper, with PDF page numbers.

Rules:
- Use ONLY the excerpts. Never add facts from your own knowledge.
- For every paper return one cell for each of these fields: ${COMPARE_FIELDS.map((f) => f.id).join(", ")}.
- A cell's value is a brief statement of what THAT paper says. If the excerpts do not state it, the value must be exactly "${NOT_STATED}" and quote must be null. Never guess or fill gaps.
- Each cell with content needs a quote copied EXACTLY, character for character, from the excerpt you cite in passage (at most 300 characters; parts may be joined with "..."). Do not paraphrase inside a quote.
- Do not state numbers that are not in your quote. Do not judge which paper is better or whether findings are correct.`;

export type ComparePaper = { n: number; documentId: string; title: string };
export function buildCompareUser(papers: ComparePaper[], passages: Passage[]): string {
  const body = papers.map((p) => `=== Paper ${p.n}: ${p.title} ===\n${formatPassages(passages.filter((x) => x.documentId === p.documentId))}`).join("\n\n");
  return wrapUntrusted(body);
}

export type VerifiedCell = { field: CompareField; label: string; value: string; status: "verified" | "unverified" | "not_stated"; quote?: string; page?: number; numbersNotInQuote: string[] };
export type VerifiedPaper = { n: number; documentId: string; title: string; cells: VerifiedCell[] };

export function verifyComparison(out: CompareModelOutput, papers: ComparePaper[], passages: Passage[]): VerifiedPaper[] {
  return papers.map((paper) => {
    const mine = passages.filter((p) => p.documentId === paper.documentId);
    const given = out.papers.find((x) => x.paper === paper.n);
    const cells: VerifiedCell[] = COMPARE_FIELDS.map((f) => {
      const c = given?.cells.find((x) => x.field === f.id);
      if (!c || !c.value.trim() || c.value.trim().toLowerCase() === NOT_STATED.toLowerCase()) return { field: f.id, label: f.label, value: NOT_STATED, status: "not_stated" as const, numbersNotInQuote: [] };
      const v = verifyOne(c.value, c.passage, c.quote, mine); // only this paper's own excerpts can support its cell
      return { field: f.id, label: f.label, value: v.statement, status: v.status, quote: v.quote, page: v.page, numbersNotInQuote: v.numbersNotInQuote };
    });
    return { n: paper.n, documentId: paper.documentId, title: paper.title, cells };
  });
}

// ---- Choosing excerpts within a size budget ----

/** Takes passages in the order given until the character budget is used, never splitting one. Renumbers from 1. */
export function takeWithinBudget<T extends { text: string }>(items: T[], maxChars: number, maxCount: number): T[] {
  const out: T[] = [];
  let used = 0;
  for (const it of items) {
    if (out.length >= maxCount) break;
    if (used + it.text.length > maxChars) continue;
    out.push(it);
    used += it.text.length;
  }
  return out;
}

import { z } from "zod";
import { locateQuote } from "@/lib/pdf/qa";
import { redactUnverifiedCitations, type KnownRef } from "./citations";

// The structured answer the agent must finish with, and the checks that turn it into something safe to show.
// The model proposes sources; this module keeps only those that point at things the agent actually read in this run,
// resolves their details from our own data (never from the model's words), and verifies quotes against the real text.

export const SOURCE_TYPES = ["reference", "pdf", "manuscript", "protocol"] as const;

export const FinalAnswerSchema = z.object({
  summary: z.string().describe("A direct answer in at most three sentences."),
  blocks: z.array(z.object({
    heading: z.string().nullable(),
    text: z.string().describe("The content of this part of the answer."),
    kind: z.enum(["analysis", "suggestion", "rewrite", "question", "plan"]),
    sources: z.array(z.object({
      type: z.enum(SOURCE_TYPES),
      id: z.string().nullable().describe("The id returned by a tool for this reference, PDF or manuscript; the study id for the protocol."),
      page: z.number().int().nullable().describe("PDF page, for PDFs"),
      quote: z.string().nullable().describe("Words copied exactly from what the tool returned, at most 300 characters"),
    })).max(6),
  })).max(10),
  suggested_searches: z.array(z.string()).max(5).describe("Literature search queries the user could run. Never citations."),
  caveats: z.array(z.string()).max(5),
});
export type FinalAnswer = z.infer<typeof FinalAnswerSchema>;

// ---- What the agent has read (the only things it may cite) ----

export type EvidenceRef = { id: string; title: string; authors: string[]; year?: number | null; journal?: string | null; doi?: string | null; abstract?: string | null };
export type Evidence = {
  refs: Map<string, EvidenceRef>;
  pdfs: Map<string, { id: string; title: string }>;
  pdfChunks: { documentId: string; page: number; text: string }[];
  manuscripts: Map<string, { id: string; title: string; text: string }>;
  protocol?: { studyId: string; text: string };
};
export const newEvidence = (): Evidence => ({ refs: new Map(), pdfs: new Map(), pdfChunks: [], manuscripts: new Map() });

// ---- Verified output ----

export type VerifiedSource = {
  type: (typeof SOURCE_TYPES)[number];
  id: string;
  label: string;
  /** verified = the quote was found in the real text. cited = the thing exists in your project, but no quote was verified. */
  status: "verified" | "cited";
  page?: number;
  quote?: string;
  note?: string;
};
export type VerifiedBlock = { heading: string | null; text: string; kind: FinalAnswer["blocks"][number]["kind"]; sources: VerifiedSource[] };
export type VerifiedAnswer = {
  summary: string;
  blocks: VerifiedBlock[];
  suggestedSearches: string[];
  caveats: string[];
  /** Sources the model named that it never read, removed from the answer. */
  removedSources: number;
  /** Citation-shaped text that was not in the user's saved references, removed from the prose. */
  redactedCitations: string[];
};

const authorLabel = (r: EvidenceRef) => {
  const a = r.authors[0] ? r.authors[0].split(",")[0].trim() : "Unknown author";
  return `${a}${r.authors.length > 1 ? " et al." : ""}${r.year ? ` (${r.year})` : ""}: ${r.title}`.slice(0, 220);
};

function resolveSource(s: FinalAnswer["blocks"][number]["sources"][number], ev: Evidence): VerifiedSource | null {
  const id = s.id ?? "";
  const quote = s.quote?.trim() ? s.quote.trim().slice(0, 600) : undefined;
  const base = (type: VerifiedSource["type"], label: string): VerifiedSource => ({ type, id, label, status: "cited" });
  const checkQuote = (out: VerifiedSource, text: string | null | undefined, what: string): VerifiedSource => {
    if (!quote) return out;
    const found = text ? locateQuote(text, quote) : null;
    return found ? { ...out, status: "verified", quote: found } : { ...out, note: `The quoted words were not found in ${what}, so no quotation is shown.` };
  };
  switch (s.type) {
    case "reference": {
      const r = ev.refs.get(id);
      if (!r) return null;
      const out = base("reference", authorLabel(r));
      return checkQuote(out, r.abstract, r.abstract ? "the saved abstract" : "the saved record (no abstract is stored)");
    }
    case "pdf": {
      const d = ev.pdfs.get(id);
      if (!d) return null;
      const chunks = ev.pdfChunks.filter((c) => c.documentId === id);
      const onPage = s.page ? chunks.filter((c) => c.page === s.page) : [];
      const label = `${d.title}${s.page ? `, PDF page ${s.page}` : ""}`;
      const out: VerifiedSource = { ...base("pdf", label), ...(s.page && onPage.length ? { page: s.page } : {}) };
      if (!quote) return out;
      for (const c of onPage.length ? onPage : chunks) {
        const found = locateQuote(c.text, quote);
        if (found) return { ...out, status: "verified", quote: found, page: c.page, label: `${d.title}, PDF page ${c.page}` };
      }
      return { ...out, note: "The quoted words were not found in the passages the assistant read, so no quotation is shown." };
    }
    case "manuscript": {
      const m = ev.manuscripts.get(id);
      if (!m) return null;
      return checkQuote(base("manuscript", m.title), m.text, "your manuscript");
    }
    case "protocol": {
      if (!ev.protocol || ev.protocol.studyId !== id) return null;
      return checkQuote(base("protocol", "Your protocol"), ev.protocol.text, "your protocol");
    }
  }
}

export function verifyFinalAnswer(raw: FinalAnswer, ev: Evidence, known: KnownRef[]): VerifiedAnswer {
  const redacted: string[] = [];
  const clean = (t: string) => { const r = redactUnverifiedCitations(t, known); redacted.push(...r.removed); return r.text; };
  let removedSources = 0;
  const blocks: VerifiedBlock[] = raw.blocks.map((b) => {
    const sources: VerifiedSource[] = [];
    for (const s of b.sources) {
      const r = resolveSource(s, ev);
      if (r) sources.push(r); else removedSources++;
    }
    return { heading: b.heading ? clean(b.heading).slice(0, 200) : null, text: clean(b.text).slice(0, 6000), kind: b.kind, sources };
  });
  return {
    summary: clean(raw.summary).slice(0, 1200),
    blocks: blocks.filter((b) => b.text.trim()),
    suggestedSearches: raw.suggested_searches.map((q) => q.trim().slice(0, 200)).filter(Boolean),
    caveats: raw.caveats.map((c) => clean(c).slice(0, 500)).filter(Boolean),
    removedSources,
    redactedCitations: [...new Set(redacted)],
  };
}

/** Used when the agent stopped before giving a structured answer: plain text, with citation-shaped text removed. */
export function verifiedFromText(text: string, known: KnownRef[], caveat: string): VerifiedAnswer {
  const r = redactUnverifiedCitations(text.trim().slice(0, 6000), known);
  return {
    summary: "",
    blocks: r.text ? [{ heading: null, text: r.text, kind: "analysis", sources: [] }] : [],
    suggestedSearches: [],
    caveats: [caveat],
    removedSources: 0,
    redactedCitations: r.removed,
  };
}

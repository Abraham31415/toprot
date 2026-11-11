import { z } from "zod";
import { wrapUntrusted } from "@/lib/ai/untrusted";
import type { Evidence, EvidenceRef } from "./answer";
import type { ToolName } from "./tasks";

// The agent's tools. All are READ-ONLY and scoped to one study and the user's own PDFs; they run with the user's own
// database permissions (row-level security), so the agent can never see more than the user can. Every result is size
// capped, wrapped as untrusted data, and recorded as evidence: a source can only be cited if it was read here.

export interface ProjectData {
  protocolText(studyId: string): Promise<string | null>;
  references(studyId: string): Promise<EvidenceRef[]>;
  reference(studyId: string, id: string): Promise<EvidenceRef | null>;
  searchPdfs(query: string, documentIds: string[] | null, limit: number): Promise<{ documentId: string; title: string; page: number; text: string }[]>;
  pdfs(documentIds: string[] | null): Promise<{ id: string; title: string; pages: number | null }[]>;
  manuscript(studyId: string, id: string): Promise<{ id: string; title: string; text: string; headings: string[] } | null>;
}

export type ToolContext = {
  data: ProjectData;
  studyId: string | null;
  /** PDFs the agent may search. null = all of the user's PDFs. */
  documentIds: string[] | null;
  manuscriptIds: string[];
  maxToolOutputChars: number;
  maxDocumentChars: number;
  evidence: Evidence;
};

const Empty = z.object({});
export const TOOL_SPECS: Record<ToolName, { description: string; schema: z.ZodType }> = {
  get_protocol: { description: "Read the current protocol of this study (title, design, question, objectives, population, variables, methods, ethics).", schema: Empty },
  list_references: { description: "List the references the user has saved in this study, with their ids. Only these can be cited.", schema: Empty },
  get_reference: { description: "Read one saved reference's details and saved abstract by id.", schema: z.object({ id: z.string() }) },
  search_pdfs: { description: "Search the text of the user's uploaded PDFs. Returns passages with document id and PDF page.", schema: z.object({ query: z.string().min(2).max(300), document_ids: z.array(z.string()).max(20).optional() }) },
  list_pdfs: { description: "List the uploaded PDFs available to search, with their ids.", schema: Empty },
  get_manuscript: { description: "Read the user's manuscript, optionally only the section under one heading.", schema: z.object({ manuscript_id: z.string(), heading: z.string().max(200).optional() }) },
};

export function toolSchemas(allowed: ToolName[]) {
  return allowed.map((name) => ({ name, description: TOOL_SPECS[name].description, input_schema: z.toJSONSchema(TOOL_SPECS[name].schema) as Record<string, unknown> }));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[truncated: ${s.length - n} more characters not shown]` : s);
const refLine = (r: EvidenceRef) => `id: ${r.id} | ${r.authors.slice(0, 3).join("; ") || "no authors"}${r.authors.length > 3 ? " et al." : ""} | ${r.year ?? "n.d."} | ${r.title}${r.journal ? ` | ${r.journal}` : ""}${r.doi ? ` | DOI ${r.doi}` : ""}`;

/** Runs one tool. Errors are returned as text for the model (and do not crash the run). */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext, allowed: ToolName[]): Promise<string> {
  if (!(allowed as string[]).includes(name)) return "Error: this tool is not available for this request.";
  const spec = TOOL_SPECS[name as ToolName];
  const parsed = spec.schema.safeParse(rawInput ?? {});
  if (!parsed.success) return "Error: invalid tool input.";
  const input = parsed.data as Record<string, unknown>;
  const ev = ctx.evidence;
  const out = (s: string) => wrapUntrusted(clip(s, ctx.maxToolOutputChars));
  try {
    switch (name as ToolName) {
      case "get_protocol": {
        if (!ctx.studyId) return "Error: no study is selected.";
        const text = await ctx.data.protocolText(ctx.studyId);
        if (!text) return "No protocol was found for this study.";
        ev.protocol = { studyId: ctx.studyId, text };
        return out(text);
      }
      case "list_references": {
        if (!ctx.studyId) return "Error: no study is selected.";
        const refs = await ctx.data.references(ctx.studyId);
        if (!refs.length) return "This study has no saved references. Do not cite any; suggest literature searches instead.";
        const shown = refs.slice(0, 80);
        for (const r of shown) if (!ev.refs.has(r.id)) ev.refs.set(r.id, { ...r, abstract: undefined });
        return out(`${shown.length} of ${refs.length} saved references:\n${shown.map(refLine).join("\n")}`);
      }
      case "get_reference": {
        if (!ctx.studyId) return "Error: no study is selected.";
        const r = await ctx.data.reference(ctx.studyId, String(input.id));
        if (!r) return "No saved reference has that id in this study.";
        ev.refs.set(r.id, r);
        return out(`${refLine(r)}\nabstract: ${r.abstract ? r.abstract : "none saved (do not describe the paper's findings)"}`);
      }
      case "list_pdfs": {
        const list = await ctx.data.pdfs(ctx.documentIds);
        if (!list.length) return "There are no uploaded PDFs with searchable text.";
        for (const d of list) ev.pdfs.set(d.id, { id: d.id, title: d.title });
        return out(list.slice(0, 40).map((d) => `id: ${d.id} | ${d.title} | ${d.pages ?? "?"} pages`).join("\n"));
      }
      case "search_pdfs": {
        const asked = Array.isArray(input.document_ids) ? (input.document_ids as string[]) : null;
        // The agent may only narrow the scope, never widen it.
        const scope = ctx.documentIds ? (asked ? asked.filter((d) => ctx.documentIds!.includes(d)) : ctx.documentIds) : asked;
        if (scope && scope.length === 0) return "No searchable PDF matches that scope.";
        const hits = await ctx.data.searchPdfs(String(input.query), scope, 8);
        if (!hits.length) return "No passages matched.";
        const lines: string[] = [];
        for (const h of hits) {
          ev.pdfs.set(h.documentId, { id: h.documentId, title: h.title });
          ev.pdfChunks.push({ documentId: h.documentId, page: h.page, text: h.text });
          lines.push(`[document id: ${h.documentId} | ${h.title} | PDF page ${h.page}]\n${h.text}`);
        }
        return out(lines.join("\n\n"));
      }
      case "get_manuscript": {
        if (!ctx.studyId) return "Error: no study is selected.";
        const id = String(input.manuscript_id);
        if (!ctx.manuscriptIds.includes(id)) return "Error: that manuscript is not available for this request.";
        const m = await ctx.data.manuscript(ctx.studyId, id);
        if (!m) return "That manuscript was not found.";
        let text = m.text;
        const heading = typeof input.heading === "string" ? input.heading.trim().toLowerCase() : "";
        if (heading) {
          const section = sectionText(m.text, m.headings, heading);
          if (section === null) return `No heading matches "${input.heading}". Headings: ${m.headings.slice(0, 40).join("; ")}`;
          text = section;
        }
        const capped = text.slice(0, ctx.maxDocumentChars);
        ev.manuscripts.set(m.id, { id: m.id, title: m.title, text: capped });
        return out(`${text.length > capped.length ? `[manuscript text cut at ${ctx.maxDocumentChars} characters]\n` : ""}Manuscript "${m.title}". Headings: ${m.headings.slice(0, 40).join("; ")}\n\n${capped}`);
      }
    }
  } catch {
    return "Error: the tool could not complete. Continue with what you have.";
  }
}

/** Text under the first heading whose text matches, up to the next heading in the manuscript's heading list. */
export function sectionText(text: string, headings: string[], wanted: string): string | null {
  const idx = headings.findIndex((h) => h.trim().toLowerCase() === wanted) >= 0 ? headings.findIndex((h) => h.trim().toLowerCase() === wanted) : headings.findIndex((h) => h.trim().toLowerCase().includes(wanted));
  if (idx < 0) return null;
  const lines = text.split("\n");
  const isHeading = (l: string, from: number) => headings.slice(from).some((h) => h === l);
  const start = lines.findIndex((l) => l === headings[idx]);
  if (start < 0) return null;
  const out: string[] = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeading(lines[i], idx + 1)) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildInitialSnapshot, type QualitySnapshot } from "@/lib/protocol/quality";
import { rowToRef, type RefRow } from "@/lib/refs/convert";
import { plainText, outline, type Doc } from "@/lib/writing/doc";
import type { EvidenceRef } from "./answer";
import type { KnownRef } from "./citations";
import type { ProjectData } from "./tools";

// ProjectData over Supabase, running with the USER's session, so row-level security decides what the agent can read.

export function protocolToText(s: QualitySnapshot): string {
  const l: string[] = [];
  const f = (label: string, v: string | number | null | undefined) => l.push(`${label}: ${v === null || v === undefined || v === "" ? "(not provided)" : v}`);
  f("Study title", s.study_title); f("Study design", s.study_design); f("Research question", s.research_question);
  l.push("Objectives:");
  if (s.objectives.length) for (const o of s.objectives) l.push(`  - [${o.objective_type}] ${o.description}`); else l.push("  (none)");
  f("Target population", s.target_population); f("Setting", s.setting);
  if (s.inclusion_criteria.length) l.push(`Inclusion criteria: ${s.inclusion_criteria.join("; ")}`);
  if (s.exclusion_criteria.length) l.push(`Exclusion criteria: ${s.exclusion_criteria.join("; ")}`);
  l.push("Variables:");
  if (s.variables.length) for (const v of s.variables) l.push(`  - ${v.variable_name} (${v.variable_type}, role: ${v.role})`); else l.push("  (none)");
  f("Statistical methods", s.statistical_methods); f("Primary analysis", s.primary_analysis); f("Significance level", s.significance_level);
  if (s.sample_size_inputs?.design_type) f("Sample size design", s.sample_size_inputs.design_type);
  f("Calculated sample size", s.calculated_sample_size); f("Data collection methods", s.data_collection_methods);
  f("Data sources", s.data_sources); f("Data management plan", s.data_management_plan);
  f("Ethical approval body", s.ethical_approval_body); f("Consent process", s.consent_process);
  return l.join("\n");
}

type Row = Record<string, unknown>;
function toEvidence(row: RefRow & { id?: string }, withAbstract: boolean): EvidenceRef {
  const r = rowToRef(row);
  return {
    id: String(row.id), title: r.title, authors: r.authors.map((a) => a.literal ?? [a.family, a.given].filter(Boolean).join(", ")).filter(Boolean),
    year: r.year ?? null, journal: r.journal ?? null, doi: r.doi ?? null, abstract: withAbstract ? (r.abstract ?? null) : undefined,
  };
}

export function supabaseProjectData(db: SupabaseClient): ProjectData {
  return {
    async protocolText(studyId) {
      const { data: study } = await db.from("studies").select("current_enrollment").eq("id", studyId).single();
      const { data: version } = await db.from("protocol_versions").select("*").eq("study_id", studyId).in("status", ["draft", "registered"]).order("version_number", { ascending: false }).limit(1).maybeSingle();
      if (!version) return null;
      const [{ data: objectives }, { data: variables }] = await Promise.all([
        db.from("protocol_objectives").select("*").eq("protocol_version_id", version.id).order("display_order"),
        db.from("protocol_variables").select("*").eq("protocol_version_id", version.id).order("display_order"),
      ]);
      return protocolToText(buildInitialSnapshot(version, objectives ?? [], variables ?? [], (study?.current_enrollment as number | null) ?? null));
    },
    async references(studyId) {
      const { data } = await db.from("study_references").select("*").eq("study_id", studyId).order("display_order").limit(500);
      return ((data ?? []) as (RefRow & { id: string })[]).map((r) => toEvidence(r, false));
    },
    async reference(studyId, id) {
      const { data } = await db.from("study_references").select("*").eq("study_id", studyId).eq("id", id).maybeSingle();
      return data ? toEvidence(data as RefRow & { id: string }, true) : null;
    },
    async searchPdfs(query, documentIds, limit) {
      const { data } = await db.rpc("search_pdf_chunks", { p_query: query, p_document_ids: documentIds, p_limit: limit });
      const rows = (data ?? []) as { document_id: string; page: number; text: string }[];
      const ids = [...new Set(rows.map((r) => r.document_id))];
      const titles = new Map<string, string>();
      if (ids.length) { const { data: docs } = await db.from("pdf_documents").select("id, title").in("id", ids); for (const d of docs ?? []) titles.set(d.id as string, d.title as string); }
      return rows.map((r) => ({ documentId: r.document_id, title: titles.get(r.document_id) ?? "PDF", page: r.page, text: r.text }));
    },
    async pdfs(documentIds) {
      let q = db.from("pdf_documents").select("id, title, page_count").eq("status", "ready").limit(40);
      if (documentIds) q = q.in("id", documentIds);
      const { data } = await q;
      return ((data ?? []) as Row[]).map((d) => ({ id: d.id as string, title: d.title as string, pages: (d.page_count as number | null) ?? null }));
    },
    async manuscript(studyId, id) {
      const { data } = await db.from("manuscripts").select("id, title, content").eq("study_id", studyId).eq("id", id).maybeSingle();
      if (!data) return null;
      const doc = data.content as Doc;
      return { id: data.id as string, title: data.title as string, text: plainText(doc), headings: outline(doc).map((h) => h.text) };
    },
  };
}

/** Every saved reference of a study in the shape the citation checker needs. Includes DOIs and PMIDs. */
export async function knownRefsFor(db: SupabaseClient, studyId: string | null): Promise<KnownRef[]> {
  if (!studyId) return [];
  const { data } = await db.from("study_references").select("*").eq("study_id", studyId).limit(500);
  return ((data ?? []) as (RefRow & { id: string })[]).map((row) => {
    const r = rowToRef(row);
    return { id: String(row.id), doi: r.doi ?? null, pmid: r.pmid ?? null, year: r.year ?? null, families: r.authors.map((a) => a.family || a.literal || "").filter(Boolean) };
  });
}

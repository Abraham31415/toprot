"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { parseNumbers } from "@/lib/tools/helpers";
import { getCalculator } from "@/lib/tools/registry";
import { MILESTONE_TYPES } from "@/lib/protocol/milestones";
import { uniqueSlug } from "@/lib/protocol/slug";
import type { Calculator, ToolResult } from "@/lib/tools/types";

export type ToolActionResult = { error?: string; message?: string };

const MAX_INPUT_CHARS = 20000;

/** Recompute on the server from the raw inputs. The browser's copy of the result is never trusted. */
function recompute(slug: string, raw: Record<string, string>): { calc: Calculator; result: ToolResult } | { error: string } {
  const calc = getCalculator(slug);
  if (!calc) return { error: "Unknown calculator." };
  const entries = Object.entries(raw ?? {});
  const known = new Set(calc.fields.map((f) => f.id));
  if (entries.some(([k, v]) => !known.has(k) || typeof v !== "string")) return { error: "Unexpected input." };
  if (entries.reduce((n, [, v]) => n + v.length, 0) > MAX_INPUT_CHARS) return { error: "Inputs are too large to save." };
  const parsed = parseNumbers(calc.fields, raw);
  if ("error" in parsed) return { error: parsed.error };
  let result: ToolResult;
  try {
    result = calc.run(parsed.n, raw);
  } catch (e) {
    return { error: (e as Error).message || "The calculation failed." };
  }
  if (result.error) return { error: result.error };
  return { calc, result };
}

/** The signed-in student's studies, or an empty list when signed out (so the page can stay static). */
export async function listMyStudiesForTools(): Promise<{ id: string; title: string }[]> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "student") return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("studies")
    .select("id, title")
    .eq("owner_id", profile.id)
    .order("last_activity_at", { ascending: false });
  return data ?? [];
}

export async function deleteSavedCalculation(studyId: string, id: string): Promise<ToolActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in to delete calculations." };
  const supabase = await createClient();
  // Row-level security limits this to the study owner; filtering by study as well keeps the URL honest.
  const { error } = await supabase.from("saved_calculations").delete().eq("id", id).eq("study_id", studyId);
  if (error) return { error: error.message };
  revalidatePath(`/studies/${studyId}/calculations`);
  return { message: "Deleted." };
}

export async function saveCalculationToStudy(studyId: string, slug: string, raw: Record<string, string>): Promise<ToolActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in to save calculations." };
  if (profile.role !== "student") return { error: "Only students can save calculations to a study." };
  const r = recompute(slug, raw);
  if ("error" in r) return { error: r.error };

  const supabase = await createClient();
  const { error } = await supabase.from("saved_calculations").insert({
    study_id: studyId,
    tool_slug: r.calc.slug,
    tool_name: r.calc.name,
    inputs: raw,
    result: { headline: r.result.headline, rows: r.result.rows, steps: r.result.steps, methods: r.result.methods },
    created_by: profile.id,
  });
  if (error) return { error: error.message };
  return { message: "Saved to your study." };
}

/** Append the calculator's methods sentence to the draft protocol. Never overwrites existing text. */
export async function insertMethodsIntoProtocol(studyId: string, slug: string, raw: Record<string, string>): Promise<ToolActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in to insert into a protocol." };
  if (profile.role !== "student") return { error: "Only students can edit a protocol." };
  const r = recompute(slug, raw);
  if ("error" in r) return { error: r.error };
  const text = r.result.methods;
  if (!text) return { error: "This calculator has no methods text to insert." };

  // Statistical methods is the section shown in the protocol builder; sample-size wording belongs there too.
  const column = "statistical_methods";
  const supabase = await createClient();
  const { data: version } = await supabase
    .from("protocol_versions")
    .select(`id, status, ${column}`)
    .eq("study_id", studyId)
    .eq("status", "draft")
    .order("version_number", { ascending: false })
    .limit(1)
    .single();
  if (!version) return { error: "This study has no draft protocol to edit. Locked protocols cannot be changed." };

  const existing = ((version as unknown as Record<string, string | null>)[column] ?? "").trim();
  if (existing.includes(text)) return { message: "That text is already in the protocol." };
  const next = existing ? `${existing}\n\n${text}` : text;

  const { error } = await supabase.from("protocol_versions").update({ [column]: next }).eq("id", version.id);
  if (error) return { error: error.message };
  revalidatePath(`/studies/${studyId}/protocol`);
  return { message: "Added to the Statistics section of your protocol." };
}

const TEXT_FIELDS = new Set(["research_question", "study_design", "target_population", "setting", "statistical_methods", "primary_analysis", "data_collection_methods", "data_sources", "data_management_plan", "consent_process", "risks_and_benefits", "confidentiality_plan"]);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const FIELD_NAMES: Record<string, string> = {
  research_question: "Research question", study_design: "Study design", target_population: "Target population", setting: "Setting", statistical_methods: "Statistics",
  primary_analysis: "Primary analysis", data_collection_methods: "Data collection methods", data_sources: "Data sources",
  data_management_plan: "Data management plan", consent_process: "Consent process", risks_and_benefits: "Risks and benefits", confidentiality_plan: "Confidentiality plan",
};

/**
 * Apply one change a builder proposed to the study's draft protocol. The result is recomputed on the server from the
 * inputs, so only changes the builder itself would produce can be applied. Existing content is never overwritten:
 * text is appended, lists and tables gain only items that are not already there.
 */
export async function applyToolAction(studyId: string, slug: string, raw: Record<string, string>, index: number): Promise<ToolActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in to add to a protocol." };
  if (profile.role !== "student") return { error: "Only students can edit a protocol." };
  const r = recompute(slug, raw);
  if ("error" in r) return { error: r.error };
  const action = r.result.apply?.[Number.isInteger(index) ? index : -1];
  if (!action) return { error: "That action is not available for this result." };

  const supabase = await createClient();
  const { data: version } = await supabase
    .from("protocol_versions")
    .select("*")
    .eq("study_id", studyId)
    .eq("status", "draft")
    .order("version_number", { ascending: false })
    .limit(1)
    .single();
  if (!version) return { error: "This study has no draft protocol to edit. Locked protocols cannot be changed." };
  const v = version as unknown as Record<string, unknown> & { id: string };
  const done = (message: string): ToolActionResult => { revalidatePath(`/studies/${studyId}/protocol`); return { message }; };

  if (action.kind === "text") {
    if (!TEXT_FIELDS.has(action.field)) return { error: "That field cannot be edited here." };
    const existing = String(v[action.field] ?? "").trim();
    const text = action.text.trim();
    if (!text) return { error: "There is nothing to add." };
    if (action.field === "research_question" || action.field === "study_design") {
      const name = action.field === "research_question" ? "research question" : "study design";
      if (existing) return { error: `Your protocol already has a ${name}. Copy the generated text and edit it yourself so nothing is overwritten.` };
      const { error } = await supabase.from("protocol_versions").update({ [action.field]: text }).eq("id", v.id);
      return error ? { error: error.message } : done(`${name[0].toUpperCase()}${name.slice(1)} set.`);
    }
    if (existing.includes(text)) return { message: "That text is already in the protocol." };
    const { error } = await supabase.from("protocol_versions").update({ [action.field]: existing ? `${existing}\n\n${text}` : text }).eq("id", v.id);
    return error ? { error: error.message } : done(`Added to ${FIELD_NAMES[action.field]}.`);
  }

  if (action.kind === "list") {
    if (action.field !== "inclusion_criteria" && action.field !== "exclusion_criteria") return { error: "That field cannot be edited here." };
    const existing = Array.isArray(v[action.field]) ? (v[action.field] as string[]) : [];
    const have = new Set(existing.map(norm));
    const fresh = action.items.filter((i) => !have.has(norm(i)));
    if (!fresh.length) return { message: "Those criteria are already in the protocol." };
    const { error } = await supabase.from("protocol_versions").update({ [action.field]: [...existing, ...fresh] }).eq("id", v.id);
    return error ? { error: error.message } : done(`Added ${fresh.length} ${action.field === "inclusion_criteria" ? "inclusion" : "exclusion"} criteri${fresh.length === 1 ? "on" : "a"}.`);
  }

  if (action.kind === "objectives") {
    const { data: existingRows } = await supabase.from("protocol_objectives").select("objective_type, description, display_order").eq("protocol_version_id", v.id).order("display_order");
    const existing = (existingRows ?? []) as { objective_type: "primary" | "secondary"; description: string }[];
    const have = new Set(existing.map((o) => norm(o.description)));
    const hasPrimary = existing.some((o) => o.objective_type === "primary");
    const fresh = action.items.filter((i) => !have.has(norm(i.description))).map((i) => ({ ...i, objective_type: hasPrimary && i.objective_type === "primary" ? ("secondary" as const) : i.objective_type }));
    if (!fresh.length) return { message: "Those objectives are already in the protocol." };
    if (existing.length + fresh.length > 50) return { error: "A protocol can hold at most 50 objectives." };
    const rows = [...existing.map((o) => ({ objective_type: o.objective_type, description: o.description })), ...fresh];
    const { error } = await supabase.rpc("replace_protocol_objectives", { version_id: v.id, rows });
    return error ? { error: error.message } : done(`Added ${fresh.length} objective${fresh.length === 1 ? "" : "s"}${hasPrimary && action.items.some((i) => i.objective_type === "primary") ? " (the new primary objective was added as secondary because one already exists)" : ""}.`);
  }

  if (action.kind === "variables") {
    const { data: existingRows } = await supabase.from("protocol_variables").select("variable_name, variable_slug, variable_type, role, unit, value_labels, measurement_timepoint, description, display_order").eq("protocol_version_id", v.id).order("display_order");
    const existing = (existingRows ?? []) as { variable_name: string; variable_slug: string; variable_type: string; role: string; unit: string | null; value_labels: Record<string, string> | null; measurement_timepoint: string | null; description: string | null }[];
    const haveNames = new Set(existing.map((x) => norm(x.variable_name)));
    const taken = new Set(existing.map((x) => x.variable_slug));
    const fresh = action.items.filter((i) => !haveNames.has(norm(i.variable_name)));
    if (!fresh.length) return { message: "Those variables are already in the protocol." };
    if (existing.length + fresh.length > 200) return { error: "A protocol can hold at most 200 variables." };
    const added = fresh.map((i) => {
      const slug = uniqueSlug(i.variable_name, taken);
      taken.add(slug);
      return { variable_name: i.variable_name.trim(), variable_slug: slug, variable_type: i.variable_type, role: i.role, unit: i.unit ?? null, value_labels: null, measurement_timepoint: i.measurement_timepoint ?? null, description: i.description ?? null };
    });
    const { error } = await supabase.rpc("replace_protocol_variables", { version_id: v.id, rows: [...existing, ...added] });
    return error ? { error: error.message } : done(`Added ${added.length} variable${added.length === 1 ? "" : "s"}.`);
  }

  if (action.kind === "timeline") {
    const isDate = (s?: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!isDate(action.start) || !isDate(action.end)) return { error: "Dates must be in YYYY-MM-DD form." };
    const patch: Record<string, string> = {};
    if (action.start && !v.anticipated_start_date) patch.anticipated_start_date = action.start;
    if (action.end && !v.anticipated_end_date) patch.anticipated_end_date = action.end;
    if (Object.keys(patch).length) {
      const { error } = await supabase.from("protocol_versions").update(patch).eq("id", v.id);
      if (error) return { error: error.message };
    }
    let updated = 0;
    for (const m of action.milestones) {
      if (!(MILESTONE_TYPES as readonly string[]).includes(m.milestone_type) || !isDate(m.target_date)) continue;
      const { data, error } = await supabase.from("milestones").update({ target_date: m.target_date }).eq("study_id", studyId).eq("milestone_type", m.milestone_type).neq("status", "complete").select("id");
      if (error) return { error: error.message };
      updated += data?.length ?? 0;
    }
    revalidatePath(`/studies/${studyId}/milestones`);
    return done(`Set ${updated} milestone target date${updated === 1 ? "" : "s"}${Object.keys(patch).length ? " and the study dates (only blank dates are filled)" : ""}.`);
  }
  return { error: "Unsupported action." };
}

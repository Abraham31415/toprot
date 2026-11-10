"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { parseNumbers } from "@/lib/tools/helpers";
import { getCalculator } from "@/lib/tools/registry";
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

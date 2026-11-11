"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { countWords, validateDoc, DocError, type Doc } from "@/lib/writing/doc";
import { buildTemplateDoc, isTemplateId } from "@/lib/writing/templates";
import { isUuid } from "@/lib/refs/validate";

// Every write goes through row-level security (only the study's owner can write) and the Postgres functions
// save_manuscript / restore_manuscript_version, which refuse a stale revision. Content is validated here first,
// and the word count is recomputed on the server rather than trusted from the browser.

export type SaveResult = { ok: true; revision: number; wordCount: number } | { ok: false; error: string; conflict?: boolean };

type Student = { supabase: Awaited<ReturnType<typeof createClient>>; userId: string };

async function student(): Promise<Student | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in to edit manuscripts." };
  if (profile.role !== "student") return { error: "Only the student who owns a study can edit its manuscripts." };
  return { supabase: await createClient(), userId: profile.id };
}

function cleanTitle(title: unknown): string | null {
  if (typeof title !== "string") return null;
  const t = title.replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= 200 ? t : null;
}
const STYLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function mapDbError(message: string): { error: string; conflict?: boolean } {
  if (message.includes("revision_conflict")) return { error: "This manuscript was changed somewhere else (another tab or device).", conflict: true };
  if (message.includes("manuscript_not_found")) return { error: "That manuscript no longer exists." };
  if (message.includes("manuscript_forbidden")) return { error: "You do not have permission to edit this manuscript." };
  if (message.includes("content_size")) return { error: "This manuscript is too large to save. Split it into chapters or remove large tables." };
  return { error: "Could not save. Your text is still in the editor; try again in a moment." };
}

export async function createManuscript(studyId: string, template: string, title: string, styleId: string): Promise<{ id?: string; error?: string }> {
  const s = await student();
  if ("error" in s) return s;
  if (!isUuid(studyId)) return { error: "Unknown study." };
  if (!isTemplateId(template)) return { error: "Unknown template." };
  const t = cleanTitle(title);
  if (!t) return { error: "Give the manuscript a title (up to 200 characters)." };
  const style = STYLE_ID.test(styleId) && styleId.length <= 120 ? styleId : "apa";
  const { data, error } = await s.supabase
    .from("manuscripts")
    .insert({ study_id: studyId, title: t, template, style_id: style, content: buildTemplateDoc(template), created_by: s.userId })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not create the manuscript. Check that you own this study." };
  revalidatePath(`/studies/${studyId}/writing`);
  revalidatePath("/writing");
  return { id: data.id as string };
}

export async function saveManuscript(
  studyId: string, id: string, baseRevision: number, title: string, content: unknown,
  opts: { snapshot?: boolean; label?: string } = {},
): Promise<SaveResult> {
  const s = await student();
  if ("error" in s) return { ok: false, error: s.error };
  if (!isUuid(id) || !Number.isInteger(baseRevision) || baseRevision < 1) return { ok: false, error: "Invalid request." };
  let doc: Doc;
  try { doc = validateDoc(content, id); } catch (e) { return { ok: false, error: e instanceof DocError ? e.message : "Invalid content." }; }
  const t = cleanTitle(title);
  if (!t) return { ok: false, error: "The title must be 1 to 200 characters." };
  const wordCount = countWords(doc);
  const label = opts.snapshot ? (opts.label ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "Saved version" : null;
  const { data, error } = await s.supabase.rpc("save_manuscript", {
    p_id: id, p_base_revision: baseRevision, p_title: t, p_content: doc, p_word_count: wordCount, p_snapshot: !!opts.snapshot, p_label: label,
  });
  if (error) return { ok: false, ...mapDbError(error.message) };
  if (opts.snapshot) revalidatePath(`/studies/${studyId}/writing/${id}`);
  return { ok: true, revision: data as number, wordCount };
}

/**
 * The user chose to keep this tab's text over a newer saved copy. The newer copy is kept as a restore point first,
 * so nothing is lost, then this text is saved on top of it.
 */
export async function overwriteManuscript(studyId: string, id: string, title: string, content: unknown): Promise<SaveResult> {
  const s = await student();
  if ("error" in s) return { ok: false, error: s.error };
  if (!isUuid(id)) return { ok: false, error: "Invalid request." };
  const { data: current, error: readError } = await s.supabase.from("manuscripts").select("revision, title, content, word_count").eq("id", id).single();
  if (readError || !current) return { ok: false, error: "That manuscript no longer exists." };
  const { error: keepError } = await s.supabase.from("manuscript_versions").insert({
    manuscript_id: id, revision: current.revision, title: current.title, content: current.content, word_count: current.word_count, kind: "restore", label: "Other session (before overwrite)",
  });
  if (keepError) return { ok: false, error: "Could not keep the other copy, so nothing was overwritten." };
  return saveManuscript(studyId, id, current.revision as number, title, content, { snapshot: true, label: "Kept this copy over another session" });
}

export async function loadLatest(id: string): Promise<{ title: string; content: Doc; revision: number } | { error: string }> {
  if (!isUuid(id)) return { error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("manuscripts").select("title, content, revision").eq("id", id).single();
  if (error || !data) return { error: "That manuscript no longer exists." };
  return { title: data.title as string, content: data.content as Doc, revision: data.revision as number };
}

export type VersionRow = { id: string; revision: number; kind: "auto" | "manual" | "restore"; label: string | null; word_count: number; created_at: string };

export async function listVersions(id: string): Promise<{ versions: VersionRow[] } | { error: string }> {
  if (!isUuid(id)) return { error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("manuscript_versions").select("id, revision, kind, label, word_count, created_at").eq("manuscript_id", id).order("created_at", { ascending: false }).limit(100);
  if (error) return { error: "Could not load the version history." };
  return { versions: (data ?? []) as VersionRow[] };
}

export async function getVersion(versionId: string): Promise<{ content: Doc; title: string } | { error: string }> {
  if (!isUuid(versionId)) return { error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("manuscript_versions").select("content, title").eq("id", versionId).single();
  if (error || !data) return { error: "That version no longer exists." };
  return { content: data.content as Doc, title: data.title as string };
}

export async function restoreVersion(studyId: string, versionId: string, baseRevision: number): Promise<{ ok: true; revision: number; title: string; content: Doc } | { ok: false; error: string; conflict?: boolean }> {
  const s = await student();
  if ("error" in s) return { ok: false, error: s.error };
  if (!isUuid(versionId) || !Number.isInteger(baseRevision)) return { ok: false, error: "Invalid request." };
  const { data, error } = await s.supabase.rpc("restore_manuscript_version", { p_version_id: versionId, p_base_revision: baseRevision });
  if (error) return { ok: false, ...mapDbError(error.message) };
  const r = data as { revision: number; title: string; content: Doc };
  revalidatePath(`/studies/${studyId}/writing`);
  return { ok: true, revision: r.revision, title: r.title, content: r.content };
}

export async function setManuscriptStyle(id: string, styleId: string): Promise<{ error?: string }> {
  const s = await student();
  if ("error" in s) return s;
  if (!isUuid(id) || !STYLE_ID.test(styleId) || styleId.length > 120) return { error: "Invalid style." };
  const { error } = await s.supabase.from("manuscripts").update({ style_id: styleId }).eq("id", id);
  return error ? { error: "Could not save the style choice." } : {};
}

export async function deleteManuscript(studyId: string, id: string): Promise<{ error?: string }> {
  const s = await student();
  if ("error" in s) return s;
  if (!isUuid(id)) return { error: "Invalid request." };
  // Remove the manuscript's figures from storage first (best effort), then the manuscript and its history.
  const folder = `${s.userId}/${id}`;
  const { data: files } = await s.supabase.storage.from("manuscript-figures").list(folder, { limit: 200 });
  if (files?.length) await s.supabase.storage.from("manuscript-figures").remove(files.map((f) => `${folder}/${f.name}`));
  const { error } = await s.supabase.from("manuscripts").delete().eq("id", id);
  if (error) return { error: "Could not delete the manuscript." };
  revalidatePath(`/studies/${studyId}/writing`);
  revalidatePath("/writing");
  return {};
}

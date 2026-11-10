"use server";

import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { rowToRef, type RefRow } from "@/lib/refs/convert";
import type { Ref } from "@/lib/refs/model";

/** The signed-in student's studies, or none when signed out (so the page stays static and public). */
export async function listProjectsForCitations(): Promise<{ id: string; title: string }[]> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "student") return [];
  const supabase = await createClient();
  const { data } = await supabase.from("studies").select("id, title").eq("owner_id", profile.id).order("last_activity_at", { ascending: false });
  return data ?? [];
}

/** References of one study. Row-level security limits this to the study's owner and attached supervisors. */
export async function getProjectReferences(studyId: string): Promise<Ref[]> {
  const profile = await getCurrentProfile();
  if (!profile || typeof studyId !== "string") return [];
  const supabase = await createClient();
  const { data } = await supabase.from("study_references").select("*").eq("study_id", studyId).order("display_order");
  return ((data ?? []) as RefRow[]).map(rowToRef);
}

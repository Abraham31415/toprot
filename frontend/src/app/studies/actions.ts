"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { MILESTONE_TYPES } from "@/lib/protocol/milestones";
import { redirect } from "next/navigation";

export type CreateStudyState = { error?: string } | undefined;

export async function createStudy(
  _prevState: CreateStudyState,
  formData: FormData,
): Promise<CreateStudyState> {
  const title = (formData.get("title") as string)?.trim();
  if (!title) return { error: "Study title is required." };

  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "student") {
    return { error: "Only students can create studies." };
  }

  const supabase = await createClient();

  const { data: study, error: studyError } = await supabase
    .from("studies")
    .insert({ owner_id: profile.id, title })
    .select("id")
    .single();

  if (studyError || !study) {
    return { error: studyError?.message ?? "Could not create study." };
  }

  const { error: versionError } = await supabase
    .from("protocol_versions")
    .insert({ study_id: study.id, version_number: 1, status: "draft", study_title: title });

  if (versionError) {
    return { error: versionError.message };
  }

  const { error: milestonesError } = await supabase
    .from("milestones")
    .insert(MILESTONE_TYPES.map((milestone_type) => ({ study_id: study.id, milestone_type })));

  if (milestonesError) {
    return { error: milestonesError.message };
  }

  redirect(`/studies/${study.id}/protocol`);
}

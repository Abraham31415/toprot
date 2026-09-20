"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { revalidatePath } from "next/cache";
import type { DeviationCategory } from "@/lib/protocol/deviations";

export type AddDeviationResult = { error?: string };

export async function addDeviation(
  studyId: string,
  versionId: string,
  input: { category: DeviationCategory; description: string; occurred_at: string; impact_assessment: string },
): Promise<AddDeviationResult> {
  if (!input.description.trim()) return { error: "Description is required." };
  if (!input.occurred_at) return { error: "Date is required." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();

  const { error } = await supabase.from("deviations").insert({
    study_id: studyId,
    protocol_version_id: versionId,
    category: input.category,
    description: input.description.trim(),
    occurred_at: input.occurred_at,
    impact_assessment: input.impact_assessment.trim() || null,
    reported_by: profile.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/studies/${studyId}/deviations`);
  return {};
}

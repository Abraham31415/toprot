"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { revalidatePath } from "next/cache";
import type { MilestoneStatus } from "@/lib/protocol/milestones";

export type UpdateMilestoneResult = { error?: string };

export async function updateMilestone(
  studyId: string,
  milestoneId: string,
  patch: { status: MilestoneStatus; target_date: string | null; notes: string },
): Promise<UpdateMilestoneResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();

  const { error } = await supabase
    .from("milestones")
    .update({
      status: patch.status,
      target_date: patch.target_date || null,
      notes: patch.notes || null,
      completed_at: patch.status === "complete" ? new Date().toISOString() : null,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", milestoneId);

  if (error) return { error: error.message };

  revalidatePath(`/studies/${studyId}/milestones`);
  revalidatePath(`/dashboard`);
  return {};
}

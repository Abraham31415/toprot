"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { revalidatePath } from "next/cache";
import type { SampleSizeInput, SampleSizeResult } from "@/lib/protocol/sample-size";
import { runSampleSizeCalculation } from "@/lib/protocol/sample-size-engine";

export type { SampleSizeCalcResult } from "@/lib/protocol/sample-size-engine";

/** Thin wrapper so the standalone calculator page calls the same shared engine
 * as the protocol-embedded one, just without persisting anything. */
export async function calculateStandalone(input: SampleSizeInput) {
  return runSampleSizeCalculation(input);
}

export async function listMyStudies(): Promise<{ id: string; title: string }[]> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "student") return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("studies")
    .select("id, title")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false });

  return data ?? [];
}

export type SaveToStudyResult = { error?: string };

export async function saveSampleSizeToStudy(
  studyId: string,
  input: SampleSizeInput,
  result: SampleSizeResult,
): Promise<SaveToStudyResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();

  const { data: version } = await supabase
    .from("protocol_versions")
    .select("id")
    .eq("study_id", studyId)
    .in("status", ["draft", "registered"])
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (!version) return { error: "This study has no draft protocol to save into." };

  const { error } = await supabase
    .from("protocol_versions")
    .update({
      sample_size_inputs: input,
      calculated_sample_size: result.n_total,
      stress_test_results: { ...result.stress_test, formula_label: result.formula_label, citation: result.citation },
    })
    .eq("id", version.id);

  if (error) return { error: error.message };

  revalidatePath(`/studies/${studyId}/protocol`);
  return {};
}

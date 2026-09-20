"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { ObjectiveType, VariableRole, VariableType } from "@/lib/protocol/types";
import type { SampleSizeInput, SampleSizeResult } from "@/lib/protocol/sample-size";

export type SaveResult = { error?: string; savedAt?: number };

export async function saveProtocolSection(
  versionId: string,
  studyId: string,
  patch: Record<string, unknown>,
): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("protocol_versions").update(patch).eq("id", versionId);

  if (error) return { error: error.message };

  revalidatePath(`/studies/${studyId}/protocol`);
  return { savedAt: Date.now() };
}

export async function saveObjectives(
  versionId: string,
  studyId: string,
  objectives: { objective_type: ObjectiveType; description: string }[],
): Promise<SaveResult> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from("protocol_objectives")
    .delete()
    .eq("protocol_version_id", versionId);
  if (deleteError) return { error: deleteError.message };

  const rows = objectives
    .filter((o) => o.description.trim())
    .map((o, i) => ({
      protocol_version_id: versionId,
      objective_type: o.objective_type,
      description: o.description.trim(),
      display_order: i,
    }));

  if (rows.length) {
    const { error: insertError } = await supabase.from("protocol_objectives").insert(rows);
    if (insertError) return { error: insertError.message };
  }

  revalidatePath(`/studies/${studyId}/protocol`);
  return { savedAt: Date.now() };
}

export type VariableInput = {
  variable_name: string;
  variable_slug: string;
  variable_type: VariableType;
  role: VariableRole;
  unit: string | null;
  value_labels: Record<string, string> | null;
  measurement_timepoint: string | null;
  description: string | null;
};

export async function saveVariables(
  versionId: string,
  studyId: string,
  variables: VariableInput[],
): Promise<SaveResult> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from("protocol_variables")
    .delete()
    .eq("protocol_version_id", versionId);
  if (deleteError) return { error: deleteError.message };

  const rows = variables
    .filter((v) => v.variable_name.trim())
    .map((v, i) => ({
      protocol_version_id: versionId,
      variable_name: v.variable_name.trim(),
      variable_slug: v.variable_slug,
      variable_type: v.variable_type,
      role: v.role,
      unit: v.unit,
      value_labels: v.value_labels,
      measurement_timepoint: v.measurement_timepoint,
      description: v.description,
      display_order: i,
    }));

  if (rows.length) {
    const { error: insertError } = await supabase.from("protocol_variables").insert(rows);
    if (insertError) return { error: insertError.message };
  }

  revalidatePath(`/studies/${studyId}/protocol`);
  return { savedAt: Date.now() };
}

export type SampleSizeCalcResult = { error?: string; result?: SampleSizeResult };

export async function calculateSampleSize(
  versionId: string,
  studyId: string,
  input: SampleSizeInput,
): Promise<SampleSizeCalcResult> {
  const serviceUrl = process.env.NEXT_PUBLIC_DOC_SERVICE_URL;
  if (!serviceUrl) return { error: "Document service URL is not configured." };

  let response: Response;
  try {
    response = await fetch(`${serviceUrl}/sample-size/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch (err) {
    return { error: `Could not reach the document service: ${(err as Error).message}` };
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return {
      error: body?.detail ? JSON.stringify(body.detail) : `Calculation failed (HTTP ${response.status})`,
    };
  }

  const result: SampleSizeResult = await response.json();

  const supabase = await createClient();
  const { error } = await supabase
    .from("protocol_versions")
    .update({
      sample_size_inputs: input,
      calculated_sample_size: result.n_total,
      stress_test_results: result.stress_test,
    })
    .eq("id", versionId);

  if (error) return { error: error.message };

  revalidatePath(`/studies/${studyId}/protocol`);
  return { result };
}

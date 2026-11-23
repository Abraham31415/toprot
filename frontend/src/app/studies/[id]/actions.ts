"use server";

import type { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireProject } from "@/lib/collab/access";

export type ActionResult = { error?: string };

const CONTENT_COLUMNS = [
  "study_title",
  "short_title",
  "study_design",
  "site",
  "principal_investigator_name",
  "anticipated_start_date",
  "anticipated_end_date",
  "research_question",
  "target_population",
  "setting",
  "inclusion_criteria",
  "exclusion_criteria",
  "statistical_methods",
  "primary_analysis",
  "significance_level",
  "analysis_software",
  "sample_size_method",
  "sample_size_inputs",
  "calculated_sample_size",
  "stress_test_results",
  "data_collection_methods",
  "data_sources",
  "data_management_plan",
  "ethical_approval_body",
  "consent_process",
  "risks_and_benefits",
  "confidentiality_plan",
] as const;

async function supersedeCurrentlyRegistered(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studyId: string,
  exceptVersionId: string,
) {
  await supabase
    .from("protocol_versions")
    .update({ status: "superseded" })
    .eq("study_id", studyId)
    .eq("status", "registered")
    .neq("id", exceptVersionId);
}

export async function registerProtocolVersion(
  versionId: string,
  studyId: string,
): Promise<ActionResult> {
  const access = await requireProject(studyId, "lock_protocol");
  if (!access.ok) return { error: access.error };
  const { supabase, userId } = access;
  const profile = { id: userId };

  await supersedeCurrentlyRegistered(supabase, studyId, versionId);

  const { error } = await supabase
    .from("protocol_versions")
    .update({
      status: "registered",
      registered_at: new Date().toISOString(),
      registration_method: "self",
      registered_by: profile.id,
    })
    .eq("id", versionId)
    .eq("status", "draft");

  if (error) return { error: error.message };

  revalidatePath(`/studies/${studyId}/protocol`);
  return {};
}

export async function requestSupervisorApproval(
  versionId: string,
  studyId: string,
): Promise<ActionResult> {
  const access = await requireProject(studyId, "lock_protocol");
  if (!access.ok) return { error: access.error };
  const { supabase } = access;

  const { count } = await supabase
    .from("project_memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("study_id", studyId)
    .eq("role", "reviewer");

  if (!count) return { error: "No supervisor is attached to this study yet." };

  const { error } = await supabase
    .from("protocol_versions")
    .update({ approval_requested_at: new Date().toISOString() })
    .eq("id", versionId)
    .eq("status", "draft");

  if (error) return { error: error.message };

  revalidatePath(`/studies/${studyId}/protocol`);
  return {};
}

export async function approveAndLockProtocol(
  versionId: string,
  studyId: string,
): Promise<ActionResult> {
  const access = await requireProject(studyId, "review");
  if (!access.ok) return { error: access.error };
  const { supabase, userId } = access;
  const profile = { id: userId };

  await supersedeCurrentlyRegistered(supabase, studyId, versionId);

  const { error } = await supabase
    .from("protocol_versions")
    .update({
      status: "registered",
      registered_at: new Date().toISOString(),
      registration_method: "supervisor_approved",
      registered_by: profile.id,
      approved_by: profile.id,
    })
    .eq("id", versionId)
    .eq("status", "draft");

  if (error) return { error: error.message };

  revalidatePath(`/studies/${studyId}/protocol`);
  return {};
}

export async function createAmendment(
  studyId: string,
  currentVersionId: string,
  reason: string,
): Promise<ActionResult & { newVersionId?: string }> {
  if (!reason.trim()) return { error: "A reason for the amendment is required." };

  const access = await requireProject(studyId, "lock_protocol");
  if (!access.ok) return { error: access.error };
  const { supabase, userId } = access;
  const profile = { id: userId };

  const { data: current, error: currentError } = await supabase
    .from("protocol_versions")
    .select("*")
    .eq("id", currentVersionId)
    .single();

  if (currentError || !current) return { error: currentError?.message ?? "Version not found." };
  if (current.status !== "registered") {
    return { error: "Only a registered version can be amended." };
  }

  const contentPatch = Object.fromEntries(
    CONTENT_COLUMNS.map((col) => [col, current[col as keyof typeof current]]),
  );

  const { data: newVersion, error: insertError } = await supabase
    .from("protocol_versions")
    .insert({
      study_id: studyId,
      version_number: current.version_number + 1,
      status: "draft",
      ...contentPatch,
    })
    .select("id")
    .single();

  if (insertError || !newVersion) return { error: insertError?.message ?? "Could not create amendment." };

  const [{ data: objectives }, { data: variables }] = await Promise.all([
    supabase.from("protocol_objectives").select("*").eq("protocol_version_id", currentVersionId),
    supabase.from("protocol_variables").select("*").eq("protocol_version_id", currentVersionId),
  ]);

  if (objectives?.length) {
    await supabase.from("protocol_objectives").insert(
      objectives.map(({ objective_type, description, display_order }) => ({
        protocol_version_id: newVersion.id,
        objective_type,
        description,
        display_order,
      })),
    );
  }

  if (variables?.length) {
    await supabase.from("protocol_variables").insert(
      variables.map(
        ({
          variable_name,
          variable_slug,
          variable_type,
          role,
          unit,
          value_labels,
          measurement_timepoint,
          description,
          display_order,
        }) => ({
          protocol_version_id: newVersion.id,
          variable_name,
          variable_slug,
          variable_type,
          role,
          unit,
          value_labels,
          measurement_timepoint,
          description,
          display_order,
        }),
      ),
    );
  }

  const { count: supervisorCount } = await supabase
    .from("project_memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("study_id", studyId)
    .eq("role", "reviewer");

  const supervised = !!supervisorCount;

  await supabase.from("amendments").insert({
    study_id: studyId,
    previous_version_id: currentVersionId,
    new_version_id: newVersion.id,
    reason: reason.trim(),
    status: supervised ? "proposed" : "applied",
    proposed_by: profile.id,
    reviewed_by: supervised ? null : profile.id,
    reviewed_at: supervised ? null : new Date().toISOString(),
  });

  revalidatePath(`/studies/${studyId}/protocol`);
  return { newVersionId: newVersion.id };
}

export async function reviewAmendment(
  amendmentId: string,
  studyId: string,
  decision: "approved" | "rejected",
): Promise<ActionResult> {
  const access = await requireProject(studyId, "review");
  if (!access.ok) return { error: access.error };
  const { supabase, userId } = access;
  const profile = { id: userId };
  const { error } = await supabase
    .from("amendments")
    .update({ status: decision, reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq("id", amendmentId)
    .eq("status", "proposed");

  if (error) return { error: error.message };

  revalidatePath("/supervisor");
  revalidatePath(`/studies/${studyId}/protocol`);
  return {};
}

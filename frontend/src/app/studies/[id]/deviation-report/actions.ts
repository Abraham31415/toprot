"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { revalidatePath } from "next/cache";

export type ReportActionResult = { error?: string };

export async function uploadFinalAnalysis(studyId: string, formData: FormData): Promise<ReportActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a file first." };

  const supabase = await createClient();
  const path = `${studyId}/final-analysis/${Date.now()}_${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from("protocol-outputs")
    .upload(path, await file.arrayBuffer(), { contentType: file.type || "application/octet-stream" });

  if (uploadError) return { error: uploadError.message };

  revalidatePath(`/studies/${studyId}/deviation-report`);
  return {};
}

export async function generateDeviationReport(studyId: string, finalAnalysisPath: string | null): Promise<ReportActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!finalAnalysisPath) return { error: "Upload your final analysis output first." };

  const serviceUrl = process.env.NEXT_PUBLIC_DOC_SERVICE_URL;
  if (!serviceUrl) return { error: "Document service URL is not configured." };

  const supabase = await createClient();

  const { data: version, error: versionError } = await supabase
    .from("protocol_versions")
    .select("id, version_number, calculated_sample_size, study_design, primary_analysis, target_population, study_title")
    .eq("study_id", studyId)
    .in("status", ["registered", "superseded"])
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (versionError || !version) {
    return { error: "This study has no registered protocol yet — nothing to compare against." };
  }

  const [{ data: study }, { data: deviations }, { data: amendments }] = await Promise.all([
    supabase.from("studies").select("current_enrollment").eq("id", studyId).single(),
    supabase
      .from("deviations")
      .select("category, description, occurred_at, impact_assessment")
      .eq("study_id", studyId)
      .order("occurred_at"),
    supabase.from("amendments").select("reason, created_at").eq("study_id", studyId).order("created_at"),
  ]);

  let response: Response;
  try {
    response = await fetch(`${serviceUrl}/generate/deviation-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        study_title: version.study_title ?? "Untitled study",
        version_number: version.version_number,
        planned_sample_size: version.calculated_sample_size,
        actual_enrollment: study?.current_enrollment ?? 0,
        study_design: version.study_design,
        primary_analysis: version.primary_analysis,
        target_population: version.target_population,
        deviations: deviations ?? [],
        amendments: amendments ?? [],
      }),
      cache: "no-store",
    });
  } catch (err) {
    return { error: `Could not reach the document service: ${(err as Error).message}` };
  }

  if (!response.ok) return { error: `Generation failed (HTTP ${response.status})` };

  const bytes = await response.arrayBuffer();
  const exportPath = `${studyId}/deviation-report/${Date.now()}.docx`;

  const { error: uploadError } = await supabase.storage.from("protocol-outputs").upload(exportPath, bytes, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  if (uploadError) return { error: uploadError.message };

  const { error: insertError } = await supabase.from("deviation_reports").insert({
    study_id: studyId,
    protocol_version_id: version.id,
    final_analysis_file_path: finalAnalysisPath,
    comparison_result: {
      planned_sample_size: version.calculated_sample_size,
      actual_enrollment: study?.current_enrollment ?? 0,
      deviations: deviations ?? [],
      amendments: amendments ?? [],
    },
    export_docx_path: exportPath,
    generated_by: profile.id,
  });

  if (insertError) return { error: insertError.message };

  revalidatePath(`/studies/${studyId}/deviation-report`);
  return {};
}

export async function getReportDownloadUrl(path: string): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("protocol-outputs").createSignedUrl(path, 60);

  if (error) return { error: error.message };
  return { url: data.signedUrl };
}

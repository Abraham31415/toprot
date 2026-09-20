"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { revalidatePath } from "next/cache";
import type { OutputType } from "@/lib/protocol/outputs";

export type GenerateOutputResult = { error?: string };

const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const OUTPUT_CONFIG: Record<OutputType, { endpoint: string; ext: string; mime: string }> = {
  data_dictionary: { endpoint: "/generate/data-dictionary", ext: "docx", mime: DOCX_MEDIA_TYPE },
  stata_skeleton: { endpoint: "/generate/stata-skeleton", ext: "do", mime: "text/plain" },
  kobo_form: { endpoint: "/generate/kobo-form", ext: "xlsx", mime: XLSX_MEDIA_TYPE },
  redcap_form: { endpoint: "/generate/redcap-form", ext: "csv", mime: "text/csv" },
  table_shells: { endpoint: "/generate/table-shells", ext: "docx", mime: DOCX_MEDIA_TYPE },
  methods_paragraph: { endpoint: "/generate/methods-paragraph", ext: "docx", mime: DOCX_MEDIA_TYPE },
  ethics_package: { endpoint: "/generate/ethics-package", ext: "docx", mime: DOCX_MEDIA_TYPE },
  consent_form: { endpoint: "/generate/consent-form", ext: "docx", mime: DOCX_MEDIA_TYPE },
};

export async function generateOutput(
  studyId: string,
  versionId: string,
  outputType: OutputType,
): Promise<GenerateOutputResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const serviceUrl = process.env.NEXT_PUBLIC_DOC_SERVICE_URL;
  if (!serviceUrl) return { error: "Document service URL is not configured." };

  const supabase = await createClient();

  const { data: version, error: versionError } = await supabase
    .from("protocol_versions")
    .select(
      `id, study_id, version_number, study_title, principal_investigator_name, site, study_design,
       target_population, setting, inclusion_criteria, exclusion_criteria,
       statistical_methods, primary_analysis, significance_level, analysis_software,
       calculated_sample_size, sample_size_method,
       data_collection_methods, data_management_plan,
       ethical_approval_body, consent_process, risks_and_benefits, confidentiality_plan`,
    )
    .eq("id", versionId)
    .single();

  if (versionError || !version) return { error: versionError?.message ?? "Version not found." };

  const { data: variables, error: variablesError } = await supabase
    .from("protocol_variables")
    .select("variable_name, variable_slug, variable_type, role, unit, value_labels, measurement_timepoint, description")
    .eq("protocol_version_id", versionId)
    .order("display_order");

  if (variablesError) return { error: variablesError.message };

  const config = OUTPUT_CONFIG[outputType];

  let response: Response;
  try {
    response = await fetch(`${serviceUrl}${config.endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        study_title: version.study_title ?? "Untitled study",
        version_number: version.version_number,
        variables: variables ?? [],
        principal_investigator_name: version.principal_investigator_name,
        site: version.site,
        study_design: version.study_design,
        target_population: version.target_population,
        setting: version.setting,
        inclusion_criteria: version.inclusion_criteria ?? [],
        exclusion_criteria: version.exclusion_criteria ?? [],
        statistical_methods: version.statistical_methods,
        primary_analysis: version.primary_analysis,
        significance_level: version.significance_level,
        analysis_software: version.analysis_software,
        calculated_sample_size: version.calculated_sample_size,
        sample_size_method: version.sample_size_method,
        data_collection_methods: version.data_collection_methods,
        data_management_plan: version.data_management_plan,
        ethical_approval_body: version.ethical_approval_body,
        consent_process: version.consent_process,
        risks_and_benefits: version.risks_and_benefits,
        confidentiality_plan: version.confidentiality_plan,
      }),
      cache: "no-store",
    });
  } catch (err) {
    return { error: `Could not reach the document service: ${(err as Error).message}` };
  }

  if (!response.ok) {
    return { error: `Generation failed (HTTP ${response.status})` };
  }

  const bytes = await response.arrayBuffer();
  const timestamp = Date.now();
  const path = `${studyId}/${versionId}/${outputType}_${timestamp}.${config.ext}`;

  const { error: uploadError } = await supabase.storage
    .from("protocol-outputs")
    .upload(path, bytes, { contentType: config.mime });

  if (uploadError) return { error: uploadError.message };

  const { error: insertError } = await supabase.from("generated_outputs").insert({
    protocol_version_id: versionId,
    output_type: outputType,
    file_path: path,
    file_format: config.ext,
    generated_by: profile.id,
  });

  if (insertError) return { error: insertError.message };

  revalidatePath(`/studies/${studyId}/outputs`);
  return {};
}

export async function getDownloadUrl(path: string): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("protocol-outputs").createSignedUrl(path, 60);

  if (error) return { error: error.message };
  return { url: data.signedUrl };
}

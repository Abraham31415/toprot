"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { fetchVerifiedWork, type WorkRef } from "@/lib/literature/search";
import { LiteratureError } from "@/lib/literature/types";
import { workToRef } from "@/lib/literature/convert";
import { refToRowFields, rowToRef, type RefRow } from "@/lib/refs/convert";
import { findDuplicates } from "@/lib/refs/dedupe";

export type SaveWorksResult = {
  error?: string;
  saved: number;
  skipped: { title: string; reason: string }[];
  failed: { title: string; reason: string }[];
};

const MAX_BATCH = 25;

/**
 * Save literature results to a study. Each record is fetched again from its source by identifier, so what is
 * stored comes from a bibliographic source and not from the browser. Records already in the study are skipped.
 */
export async function saveWorksToStudy(studyId: string, items: (WorkRef & { title?: string })[]): Promise<SaveWorksResult> {
  const out: SaveWorksResult = { saved: 0, skipped: [], failed: [] };
  const profile = await getCurrentProfile();
  if (!profile) return { ...out, error: "Sign in to save references to a project." };
  if (profile.role !== "student") return { ...out, error: "Only students can save references to a study." };
  if (!Array.isArray(items) || !items.length) return { ...out, error: "Select at least one record." };
  if (items.length > MAX_BATCH) return { ...out, error: `Save at most ${MAX_BATCH} records at a time.` };

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase.from("study_references").select("*").eq("study_id", studyId).order("display_order");
  if (readError) return { ...out, error: readError.message };
  const have = (existing ?? []) as (RefRow & { display_order: number })[];
  const pool = have.map(rowToRef);
  let order = have.reduce((m, r) => Math.max(m, r.display_order ?? 0), -1) + 1;

  for (const item of items) {
    const label = (item.title ?? item.doi ?? item.pmid ?? item.openalexId ?? "record").slice(0, 140);
    let work;
    try {
      work = await fetchVerifiedWork({ doi: item.doi, pmid: item.pmid, openalexId: item.openalexId });
    } catch (e) {
      if (e instanceof LiteratureError && e.status === 429) { out.failed.push({ title: label, reason: e.message }); break; }
      out.failed.push({ title: label, reason: e instanceof LiteratureError ? e.message : "The source could not be reached." });
      continue;
    }
    if (!work) { out.failed.push({ title: label, reason: "No source returned this record, so it was not saved." }); continue; }
    const ref = workToRef(work);
    const dups = findDuplicates([...pool, ref]);
    if (dups.some((g) => g.indexes.includes(pool.length))) { out.skipped.push({ title: work.title, reason: "Already in this study." }); continue; }
    const fields = refToRowFields(ref, work.source);
    const { error } = await supabase.from("study_references").insert({
      study_id: studyId, ...fields,
      openalex_id: work.openalexId ?? null,
      is_open_access: work.openAccess ? work.openAccess.isOa : null,
      open_access_url: work.openAccess?.isOa ? work.openAccess.url ?? null : null,
      display_order: order++,
    });
    if (error) { out.failed.push({ title: work.title, reason: error.message }); continue; }
    pool.push(ref);
    out.saved++;
  }
  if (out.saved) revalidatePath(`/studies/${studyId}/references`);
  return out;
}


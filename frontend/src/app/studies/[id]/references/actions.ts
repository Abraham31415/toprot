"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { formatInitials, type ReferenceMetadata } from "@/lib/protocol/references";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { refToRowFields, rowToRef, type RefRow } from "@/lib/refs/convert";
import { findDuplicates, mergeInto } from "@/lib/refs/dedupe";
import { sanitizeRef, type Ref } from "@/lib/refs/model";
import { cleanCollectionName, cleanPatch, cleanTags, isUuid } from "@/lib/refs/validate";

export type LookupResult = { found: true; metadata: ReferenceMetadata } | { found: false; error?: string };

function looksLikeDoi(query: string): string | null {
  const cleaned = query.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  return /^10\.\d{4,9}\/\S+$/.test(cleaned) ? cleaned : null;
}

function looksLikePmid(query: string): string | null {
  const cleaned = query.trim().replace(/^pmid:?\s*/i, "");
  return /^\d{4,9}$/.test(cleaned) ? cleaned : null;
}

type CrossRefAuthor = { given?: string; family?: string };
type CrossRefMessage = {
  title?: string[];
  author?: CrossRefAuthor[];
  "container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  published?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
};

async function lookupCrossRef(doi: string): Promise<ReferenceMetadata | null> {
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: { "User-Agent": "ToProt/1.0 (https://toprot.vercel.app)" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data: { message?: CrossRefMessage } = await res.json();
  const msg = data.message;
  if (!msg) return null;

  const authors = (msg.author ?? [])
    .map((a) => {
      const surname = a.family ?? "";
      const initials = a.given ? formatInitials(a.given) : "";
      return [surname, initials].filter(Boolean).join(" ");
    })
    .filter((a) => a.trim());

  const dateParts =
    msg["published-print"]?.["date-parts"]?.[0] ??
    msg["published-online"]?.["date-parts"]?.[0] ??
    msg.published?.["date-parts"]?.[0];

  const title = msg.title?.[0];
  if (!title) return null;

  return {
    identifier_type: "doi",
    doi,
    pmid: null,
    authors,
    title,
    journal: msg["container-title"]?.[0] ?? null,
    year: dateParts?.[0] ?? null,
    volume: msg.volume ?? null,
    issue: msg.issue ?? null,
    pages: msg.page ?? null,
  };
}

type PubMedSummaryDoc = {
  error?: string;
  title?: string;
  fulljournalname?: string;
  source?: string;
  pubdate?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  authors?: { name?: string }[];
};

async function pubmedEsummary(pmid: string): Promise<ReferenceMetadata | null> {
  const res = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json&tool=toprot`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const data: { result?: Record<string, PubMedSummaryDoc> } = await res.json();
  const doc = data.result?.[pmid];
  if (!doc || doc.error || !doc.title) return null;

  const authors = (doc.authors ?? []).map((a) => a.name).filter((n): n is string => !!n);
  const yearMatch = /\d{4}/.exec(doc.pubdate ?? "");

  return {
    identifier_type: "pmid",
    doi: null,
    pmid,
    authors,
    title: doc.title,
    journal: doc.fulljournalname ?? doc.source ?? null,
    year: yearMatch ? parseInt(yearMatch[0], 10) : null,
    volume: doc.volume || null,
    issue: doc.issue || null,
    pages: doc.pages || null,
  };
}

async function pubmedSearchByTitle(title: string): Promise<string | null> {
  const res = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=1&term=${encodeURIComponent(title)}&tool=toprot`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const data: { esearchresult?: { idlist?: string[] } } = await res.json();
  return data.esearchresult?.idlist?.[0] ?? null;
}

/**
 * Absolute rule: metadata only ever comes from CrossRef or PubMed. If the identifier
 * doesn't resolve to a real record, this returns { found: false } -- never a guessed
 * or model-generated citation.
 */
export async function lookupReference(query: string): Promise<LookupResult> {
  const trimmed = query.trim();
  if (!trimmed) return { found: false, error: "Enter a DOI, PMID, or title." };

  try {
    const doi = looksLikeDoi(trimmed);
    if (doi) {
      const metadata = await lookupCrossRef(doi);
      return metadata ? { found: true, metadata } : { found: false };
    }

    const pmid = looksLikePmid(trimmed);
    if (pmid) {
      const metadata = await pubmedEsummary(pmid);
      return metadata ? { found: true, metadata } : { found: false };
    }

    const foundPmid = await pubmedSearchByTitle(trimmed);
    if (!foundPmid) return { found: false };
    const metadata = await pubmedEsummary(foundPmid);
    return metadata ? { found: true, metadata } : { found: false };
  } catch (err) {
    return { found: false, error: `Lookup failed: ${(err as Error).message}` };
  }
}

export type SaveResult = { error?: string };

export async function addReference(studyId: string, metadata: ReferenceMetadata): Promise<SaveResult> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("study_references")
    .select("id", { count: "exact", head: true })
    .eq("study_id", studyId);

  const { error } = await supabase.from("study_references").insert({
    study_id: studyId,
    identifier_type: metadata.identifier_type,
    source: metadata.identifier_type === "doi" ? "crossref" : metadata.identifier_type === "pmid" ? "pubmed" : "manual",
    doi: metadata.doi,
    pmid: metadata.pmid,
    authors: metadata.authors,
    title: metadata.title,
    journal: metadata.journal,
    year: metadata.year,
    volume: metadata.volume,
    issue: metadata.issue,
    pages: metadata.pages,
    display_order: count ?? 0,
  });

  if (error) return { error: error.message };
  revalidatePath(`/studies/${studyId}/references`);
  return {};
}

export async function deleteReference(studyId: string, referenceId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("study_references").delete().eq("id", referenceId);
  if (error) return { error: error.message };
  revalidatePath(`/studies/${studyId}/references`);
  return {};
}


// ---- Reference manager v2 -------------------------------------------------------------------------------------------
// Every write below goes through row-level security (only the study owner can write) and validates its input first.

type Writer = { supabase: Awaited<ReturnType<typeof createClient>>; profileId: string };

async function writer(): Promise<Writer | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in to change references." };
  if (profile.role !== "student") return { error: "Only the student who owns a study can change its references." };
  return { supabase: await createClient(), profileId: profile.id };
}

const touched = (studyId: string) => revalidatePath(`/studies/${studyId}/references`);

export type ImportItem = { ref: Ref; tags?: string[] };
export type ImportResult = { error?: string; saved: number; skipped: number; invalid: number };

/**
 * Add references from a file the user imported (RIS, BibTeX, EndNote XML) or from their own Zotero library. The source is
 * recorded as 'import' or 'zotero' so it is always clear these were supplied by the user, not looked up. Duplicates of
 * references already in the study, and repeats within the batch, are skipped.
 */
export async function importReferences(studyId: string, items: ImportItem[], source: "import" | "zotero" | "manual", collectionId?: string | null): Promise<ImportResult> {
  const out: ImportResult = { saved: 0, skipped: 0, invalid: 0 };
  const w = await writer();
  if ("error" in w) return { ...out, error: w.error };
  if (!Array.isArray(items) || !items.length) return { ...out, error: "There is nothing to import." };
  if (items.length > 500) return { ...out, error: "Import at most 500 references at a time." };
  if (collectionId != null && !isUuid(collectionId)) return { ...out, error: "Unknown collection." };

  const { data: existing, error: readError } = await w.supabase.from("study_references").select("*").eq("study_id", studyId);
  if (readError) return { ...out, error: readError.message };
  const rows = (existing ?? []) as (RefRow & { display_order: number })[];
  const pool: Ref[] = rows.map(rowToRef);
  let order = rows.reduce((m, r) => Math.max(m, r.display_order ?? 0), -1) + 1;
  const batch: Record<string, unknown>[] = [];

  const candidates: { ref: Ref; tags: string[] }[] = [];
  for (const it of items) {
    const ref = sanitizeRef({ ...it.ref, authors: Array.isArray(it.ref?.authors) ? it.ref.authors.slice(0, 100) : [] });
    if (!ref.title || ref.title.length > 500) { out.invalid++; continue; }
    candidates.push({ ref, tags: cleanTags(it.tags ?? []) });
  }
  // One duplicate check for the whole batch. In each group the earliest reference is kept, so a candidate is a duplicate
  // when it matches something already in the study or something earlier in the file.
  const dupes = new Set<number>();
  for (const g of findDuplicates([...pool, ...candidates.map((c) => c.ref)])) for (const i of g.indexes) if (i >= pool.length && i !== g.indexes[0]) dupes.add(i - pool.length);
  candidates.forEach((c, i) => {
    if (dupes.has(i)) { out.skipped++; return; }
    const fields = refToRowFields({ ...c.ref, abstract: c.ref.abstract?.slice(0, 20000), notes: c.ref.notes?.slice(0, 5000), keywords: (c.ref.keywords ?? []).slice(0, 50) }, source);
    batch.push({ study_id: studyId, ...fields, tags: c.tags, collection_id: collectionId ?? null, display_order: order++ });
  });
  for (let i = 0; i < batch.length; i += 100) {
    const { error } = await w.supabase.from("study_references").insert(batch.slice(i, i + 100));
    if (error) return { ...out, error: error.message };
    out.saved += Math.min(100, batch.length - i);
  }
  if (out.saved) touched(studyId);
  return out;
}

export async function updateReference(studyId: string, referenceId: string, patch: unknown): Promise<SaveResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isUuid(referenceId)) return { error: "Unknown reference." };
  const c = cleanPatch(patch);
  if (!c.ok) return { error: c.error };
  const { error } = await w.supabase.from("study_references").update(c.fields).eq("id", referenceId).eq("study_id", studyId);
  if (error) return { error: error.message };
  touched(studyId);
  return {};
}

export async function deleteReferences(studyId: string, ids: string[]): Promise<SaveResult & { deleted?: number }> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every(isUuid)) return { error: "Choose between 1 and 200 references." };
  const { error, count } = await w.supabase.from("study_references").delete({ count: "exact" }).in("id", ids).eq("study_id", studyId);
  if (error) return { error: error.message };
  touched(studyId);
  return { deleted: count ?? ids.length };
}

export async function createCollection(studyId: string, name: string): Promise<SaveResult & { id?: string }> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const n = cleanCollectionName(name);
  if (!n) return { error: "A collection name must be 1 to 80 characters." };
  const { data, error } = await w.supabase.from("reference_collections").insert({ study_id: studyId, name: n }).select("id").single();
  if (error) return { error: /duplicate|unique/i.test(error.message) ? "A collection with that name already exists." : error.message };
  touched(studyId);
  return { id: (data as { id: string }).id };
}

export async function renameCollection(studyId: string, collectionId: string, name: string): Promise<SaveResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const n = cleanCollectionName(name);
  if (!n || !isUuid(collectionId)) return { error: "A collection name must be 1 to 80 characters." };
  const { error } = await w.supabase.from("reference_collections").update({ name: n }).eq("id", collectionId).eq("study_id", studyId);
  if (error) return { error: /duplicate|unique/i.test(error.message) ? "A collection with that name already exists." : error.message };
  touched(studyId);
  return {};
}

/** Deleting a collection keeps its references; they become unfiled. */
export async function deleteCollection(studyId: string, collectionId: string): Promise<SaveResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isUuid(collectionId)) return { error: "Unknown collection." };
  const { error } = await w.supabase.from("reference_collections").delete().eq("id", collectionId).eq("study_id", studyId);
  if (error) return { error: error.message };
  touched(studyId);
  return {};
}

export async function assignCollection(studyId: string, ids: string[], collectionId: string | null): Promise<SaveResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every(isUuid)) return { error: "Choose between 1 and 200 references." };
  if (collectionId !== null && !isUuid(collectionId)) return { error: "Unknown collection." };
  const { error } = await w.supabase.from("study_references").update({ collection_id: collectionId, updated_at: new Date().toISOString() }).in("id", ids).eq("study_id", studyId);
  if (error) return { error: error.message };
  touched(studyId);
  return {};
}

/** Add tags to several references at once, keeping the tags they already have. */
export async function addTagsToReferences(studyId: string, ids: string[], tags: string[]): Promise<SaveResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const add = cleanTags(tags);
  if (!add.length) return { error: "Enter at least one tag." };
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every(isUuid)) return { error: "Choose between 1 and 200 references." };
  const { data, error: readError } = await w.supabase.from("study_references").select("id, tags").in("id", ids).eq("study_id", studyId);
  if (readError) return { error: readError.message };
  for (const row of (data ?? []) as { id: string; tags: string[] | null }[]) {
    const { error } = await w.supabase.from("study_references").update({ tags: cleanTags([...(row.tags ?? []), ...add]), updated_at: new Date().toISOString() }).eq("id", row.id).eq("study_id", studyId);
    if (error) return { error: error.message };
  }
  touched(studyId);
  return {};
}

/** Merge duplicates into the reference the user chose to keep: blanks are filled, nothing is overwritten, tags are combined. */
export async function mergeReferences(studyId: string, keepId: string, removeIds: string[]): Promise<SaveResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isUuid(keepId) || !Array.isArray(removeIds) || !removeIds.length || removeIds.length > 20 || !removeIds.every(isUuid) || removeIds.includes(keepId)) return { error: "Choose one reference to keep and the duplicates to merge into it." };
  const { data, error: readError } = await w.supabase.from("study_references").select("*").in("id", [keepId, ...removeIds]).eq("study_id", studyId);
  if (readError) return { error: readError.message };
  const rows = (data ?? []) as (RefRow & { id: string })[];
  const keep = rows.find((r) => r.id === keepId);
  const others = rows.filter((r) => r.id !== keepId);
  if (!keep || others.length !== removeIds.length) return { error: "Those references were not found in this study." };
  const merged = mergeInto(rowToRef(keep), others.map(rowToRef));
  const fields = refToRowFields(merged, keep.source ?? "manual");
  const tags = cleanTags([...(keep.tags ?? []), ...others.flatMap((o) => o.tags ?? [])]);
  const { error } = await w.supabase.from("study_references").update({ ...fields, source: keep.source ?? fields.source, tags, updated_at: new Date().toISOString() }).eq("id", keepId).eq("study_id", studyId);
  if (error) return { error: error.message };
  const { error: delError } = await w.supabase.from("study_references").delete().in("id", removeIds).eq("study_id", studyId);
  if (delError) return { error: delError.message };
  touched(studyId);
  return {};
}

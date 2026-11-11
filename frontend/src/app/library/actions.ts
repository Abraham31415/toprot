"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { chunkDocument, MAX_CHUNKS } from "@/lib/pdf/chunk";
import { extractPdf, guessTitle, PdfError } from "@/lib/pdf/extract";
import { cleanTags, isUuid } from "@/lib/refs/validate";
import { lookupReference, addReference } from "@/app/studies/[id]/references/actions";

// The PDF library is private to its owner. Files live in the research-pdfs bucket under "<user id>/<document id>.pdf";
// every table is protected by row-level security. Text is extracted here on the server from the stored file, never
// taken from the browser, so what search and question answering see is what is really in the PDF.

type Db = Awaited<ReturnType<typeof createClient>>;
async function me(): Promise<{ db: Db; userId: string } | { error: string }> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: "Sign in to use your PDF library." };
  return { db, userId: user.id };
}
const BUCKET = "research-pdfs";

export type RegisterResult = { ok: true; id: string; status: "ready" | "no_text"; pages: number; truncated: boolean } | { ok: false; error: string; duplicateOf?: string };

export async function registerPdf(id: string, filename: string, studyId?: string | null): Promise<RegisterResult> {
  const m = await me();
  if ("error" in m) return { ok: false, error: m.error };
  if (!isUuid(id)) return { ok: false, error: "Invalid upload." };
  const path = `${m.userId}/${id}.pdf`;
  const discard = async () => { await m.db.storage.from(BUCKET).remove([path]); };

  const { data: blob, error: dlError } = await m.db.storage.from(BUCKET).download(path);
  if (dlError || !blob) return { ok: false, error: "The upload did not arrive. Try again." };
  const bytes = new Uint8Array(await blob.arrayBuffer());

  let ex;
  try { ex = await extractPdf(bytes); }
  catch (e) { await discard(); return { ok: false, error: e instanceof PdfError ? e.message : "That PDF could not be read." }; }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { data: dup } = await m.db.from("pdf_documents").select("id, title").eq("owner_id", m.userId).eq("sha256", sha256).maybeSingle();
  if (dup) { await discard(); return { ok: false, error: `You already have this file in your library as "${dup.title}".`, duplicateOf: dup.id as string }; }

  const chunks = chunkDocument(ex.pages).slice(0, MAX_CHUNKS);
  const title = guessTitle(ex.info, ex.pages[0] ?? "", filename);
  const { error: insError } = await m.db.from("pdf_documents").insert({
    id, owner_id: m.userId, study_id: studyId && isUuid(studyId) ? studyId : null,
    title, original_filename: filename.slice(0, 255), storage_path: path, file_size: bytes.length, sha256,
    page_count: ex.pageCount, char_count: ex.pages.reduce((n, p) => n + p.length, 0), status: ex.status,
    metadata: { info: ex.info, truncated: ex.truncated }, doi: ex.doi ?? null,
  });
  if (insError) {
    await discard();
    if (insError.message.includes("pdf_quota_exceeded")) return { ok: false, error: "Your library is full (100 MB). Delete some PDFs to upload more." };
    if (insError.message.includes("pdf_library_full")) return { ok: false, error: "Your library holds the maximum of 100 PDFs. Delete some to upload more." };
    if (insError.message.includes("pdf_link_forbidden")) return { ok: false, error: "You can only link a PDF to your own study." };
    return { ok: false, error: "Could not add the PDF to your library." };
  }
  for (let i = 0; i < chunks.length; i += 400) {
    const { error } = await m.db.from("pdf_chunks").insert(chunks.slice(i, i + 400).map((c) => ({ document_id: id, page: c.page, idx: c.idx, text: c.text })));
    if (error) { await m.db.from("pdf_documents").delete().eq("id", id); await discard(); return { ok: false, error: "Could not index the PDF text. Try again." }; }
  }
  revalidatePath("/library");
  return { ok: true, id, status: ex.status, pages: ex.pageCount, truncated: ex.truncated };
}

export async function updatePdf(id: string, patch: { title?: string; folder?: string | null; tags?: string[]; notes?: string | null; doi?: string | null }): Promise<{ error?: string }> {
  const m = await me();
  if ("error" in m) return m;
  if (!isUuid(id)) return { error: "Invalid request." };
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) { const t = patch.title.replace(/\s+/g, " ").trim(); if (!t || t.length > 300) return { error: "The title must be 1 to 300 characters." }; row.title = t; }
  if (patch.folder !== undefined) { const f = patch.folder?.replace(/\s+/g, " ").trim() ?? ""; if (f.length > 80) return { error: "Folder names are up to 80 characters." }; row.folder = f || null; }
  if (patch.tags !== undefined) row.tags = cleanTags(patch.tags);
  if (patch.notes !== undefined) { if ((patch.notes ?? "").length > 5000) return { error: "Notes are up to 5000 characters." }; row.notes = patch.notes?.trim() || null; }
  if (patch.doi !== undefined) { const d = patch.doi?.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "") ?? ""; if (d && !/^10\.\d{4,9}\/\S+$/.test(d)) return { error: "That does not look like a DOI." }; row.doi = d || null; }
  const { error } = await m.db.from("pdf_documents").update(row).eq("id", id);
  if (error) return { error: "Could not save the changes." };
  revalidatePath("/library"); revalidatePath(`/library/${id}`);
  return {};
}

export async function deletePdf(id: string): Promise<{ error?: string }> {
  const m = await me();
  if ("error" in m) return m;
  if (!isUuid(id)) return { error: "Invalid request." };
  const { data: row } = await m.db.from("pdf_documents").select("storage_path").eq("id", id).single();
  if (!row) return { error: "That PDF no longer exists." };
  const { error } = await m.db.from("pdf_documents").delete().eq("id", id);
  if (error) return { error: "Could not delete the PDF." };
  await m.db.storage.from(BUCKET).remove([row.storage_path as string]);
  revalidatePath("/library");
  return {};
}

/** Links a PDF to one of the user's study references (or unlinks it with null). */
export async function linkPdf(id: string, studyId: string | null, referenceId: string | null): Promise<{ error?: string }> {
  const m = await me();
  if ("error" in m) return m;
  if (!isUuid(id) || (studyId && !isUuid(studyId)) || (referenceId && !isUuid(referenceId))) return { error: "Invalid request." };
  if (referenceId && studyId) {
    const { data: ref } = await m.db.from("study_references").select("id").eq("id", referenceId).eq("study_id", studyId).maybeSingle();
    if (!ref) return { error: "That reference is not in the chosen study." };
  }
  const { error } = await m.db.from("pdf_documents").update({ study_id: studyId, reference_id: referenceId, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message.includes("pdf_link_forbidden") ? "You can only link to your own studies and references." : "Could not link the PDF." };
  revalidatePath(`/library/${id}`); revalidatePath("/library");
  return {};
}

/** Looks up the PDF's DOI at Crossref, saves it as a reference in the study, and links the two. */
export async function addReferenceFromPdf(id: string, studyId: string): Promise<{ error?: string; referenceId?: string }> {
  const m = await me();
  if ("error" in m) return m;
  if (!isUuid(id) || !isUuid(studyId)) return { error: "Invalid request." };
  const { data: doc } = await m.db.from("pdf_documents").select("doi").eq("id", id).single();
  if (!doc?.doi) return { error: "This PDF has no DOI. Add one above, or add the reference by hand in the study." };
  const found = await lookupReference(doc.doi as string);
  if (!found.found) return { error: found.error ?? "Crossref could not find that DOI." };
  const { data: existing } = await m.db.from("study_references").select("id").eq("study_id", studyId).ilike("doi", doc.doi as string).maybeSingle();
  let refId = existing?.id as string | undefined;
  if (!refId) {
    const added = await addReference(studyId, found.metadata);
    if (added.error) return { error: added.error };
    const { data: created } = await m.db.from("study_references").select("id").eq("study_id", studyId).ilike("doi", doc.doi as string).order("created_at", { ascending: false }).limit(1).maybeSingle();
    refId = created?.id as string | undefined;
  }
  if (!refId) return { error: "The reference was saved but could not be linked." };
  const linked = await linkPdf(id, studyId, refId);
  return linked.error ? linked : { referenceId: refId };
}

export async function getPageText(id: string, page: number): Promise<{ text: string; page: number } | { error: string }> {
  const m = await me();
  if ("error" in m) return m;
  if (!isUuid(id) || !Number.isInteger(page) || page < 1) return { error: "Invalid request." };
  const { data, error } = await m.db.from("pdf_chunks").select("text").eq("document_id", id).eq("page", page).order("idx", { ascending: true });
  if (error) return { error: "Could not load that page." };
  return { text: (data ?? []).map((c) => c.text as string).join("\n\n"), page };
}

export async function getOriginalUrl(id: string): Promise<{ url: string } | { error: string }> {
  const m = await me();
  if ("error" in m) return m;
  if (!isUuid(id)) return { error: "Invalid request." };
  const { data: row } = await m.db.from("pdf_documents").select("storage_path").eq("id", id).single();
  if (!row) return { error: "That PDF no longer exists." };
  const { data, error } = await m.db.storage.from(BUCKET).createSignedUrl(row.storage_path as string, 900);
  if (error || !data) return { error: "Could not open the file." };
  return { url: data.signedUrl };
}

export type SearchHit = { documentId: string; title: string; page: number; headline: string; rank: number };

export async function searchLibrary(query: string, documentIds?: string[]): Promise<{ hits: SearchHit[] } | { error: string }> {
  const m = await me();
  if ("error" in m) return m;
  const q = query.trim().slice(0, 300);
  if (q.length < 2) return { hits: [] };
  const ids = documentIds?.length ? documentIds.filter(isUuid).slice(0, 100) : null;
  const { data, error } = await m.db.rpc("search_pdf_chunks", { p_query: q, p_document_ids: ids, p_limit: 40 });
  if (error) return { error: "Search failed. Try again." };
  const rows = (data ?? []) as { document_id: string; page: number; headline: string; rank: number }[];
  const titles = new Map<string, string>();
  const docIds = [...new Set(rows.map((r) => r.document_id))];
  if (docIds.length) {
    const { data: docs } = await m.db.from("pdf_documents").select("id, title").in("id", docIds);
    for (const d of docs ?? []) titles.set(d.id as string, d.title as string);
  }
  return { hits: rows.map((r) => ({ documentId: r.document_id, title: titles.get(r.document_id) ?? "PDF", page: r.page, headline: r.headline, rank: r.rank })) };
}

// ---- Annotations: the user's own notes and highlighted passages, tied to a PDF page ----

const COLORS = ["yellow", "green", "blue", "pink"];
export async function addAnnotation(documentId: string, a: { page: number; quote?: string; note?: string; color?: string }): Promise<{ error?: string; id?: string }> {
  const m = await me();
  if ("error" in m) return m;
  if (!isUuid(documentId) || !Number.isInteger(a.page) || a.page < 1) return { error: "Invalid request." };
  const quote = a.quote?.replace(/\s+/g, " ").trim().slice(0, 2000) || null;
  const note = a.note?.trim().slice(0, 5000) || null;
  if (!quote && !note) return { error: "Select some text or write a note." };
  const { data: doc } = await m.db.from("pdf_documents").select("page_count").eq("id", documentId).single();
  if (!doc) return { error: "That PDF no longer exists." };
  if (doc.page_count && a.page > (doc.page_count as number)) return { error: "That page does not exist in this PDF." };
  const { data, error } = await m.db.from("pdf_annotations").insert({ document_id: documentId, page: a.page, quote, note, color: COLORS.includes(a.color ?? "") ? a.color : "yellow" }).select("id").single();
  if (error || !data) return { error: "Could not save the annotation." };
  return { id: data.id as string };
}

export async function updateAnnotation(id: string, patch: { note?: string | null; color?: string }): Promise<{ error?: string }> {
  const m = await me();
  if ("error" in m) return m;
  if (!isUuid(id)) return { error: "Invalid request." };
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.note !== undefined) row.note = patch.note?.trim().slice(0, 5000) || null;
  if (patch.color !== undefined && COLORS.includes(patch.color)) row.color = patch.color;
  const { error } = await m.db.from("pdf_annotations").update(row).eq("id", id);
  return error ? { error: "Could not update the annotation. A highlight needs its text or a note." } : {};
}

export async function deleteAnnotation(id: string): Promise<{ error?: string }> {
  const m = await me();
  if ("error" in m) return m;
  if (!isUuid(id)) return { error: "Invalid request." };
  const { error } = await m.db.from("pdf_annotations").delete().eq("id", id);
  return error ? { error: "Could not delete the annotation." } : {};
}

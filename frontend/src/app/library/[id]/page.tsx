import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/refs/validate";
import { Reader, type ReaderDoc, type Annotation, type StudyOption } from "@/components/library/reader";

export const metadata = { title: "PDF reader" };

export default async function ReaderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const { id } = await params;
  const { page } = await searchParams;
  if (!isUuid(id)) notFound();
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const { data: doc } = await supabase.from("pdf_documents").select("id, title, status, page_count, file_size, folder, tags, notes, doi, study_id, reference_id, original_filename, metadata, created_at").eq("id", id).single();
  if (!doc) notFound();
  const [{ data: annotations }, { data: studies }, { data: refs }] = await Promise.all([
    supabase.from("pdf_annotations").select("id, page, quote, note, color, created_at").eq("document_id", id).order("page").order("created_at"),
    supabase.from("studies").select("id, title").eq("owner_id", profile.id).order("title"),
    supabase.from("study_references").select("id, study_id, title, year").in("study_id", doc.study_id ? [doc.study_id] : ["00000000-0000-0000-0000-000000000000"]).order("title"),
  ]);
  const start = Math.min(Math.max(parseInt(page ?? "1", 10) || 1, 1), Math.max(doc.page_count ?? 1, 1));
  return (
    <div className="min-h-screen bg-paper">
      <Reader doc={doc as ReaderDoc} annotations={(annotations ?? []) as Annotation[]} studies={(studies ?? []) as StudyOption[]} references={(refs ?? []) as { id: string; title: string; year: number | null }[]} initialPage={start} />
    </div>
  );
}

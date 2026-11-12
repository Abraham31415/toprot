import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { LibraryView, type LibraryDoc } from "@/components/library/library-view";

export const metadata = { title: "PDF library" };
// Text extraction runs on the server when a PDF is added; give large files time.
export const maxDuration = 60;

export default async function LibraryPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const { data } = await supabase
    .from("pdf_documents")
    .select("id, title, status, page_count, file_size, folder, tags, doi, study_id, reference_id, created_at")
    .order("created_at", { ascending: false })
    // A library holds at most 100 PDFs; this is a second line of defence so the page can never load an unbounded list.
    .limit(200);
  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="text-xl font-semibold text-navy">PDF library</h1>
        <p className="mt-1 text-sm text-navy/65">
          Your private collection of papers. Search inside them, add notes, compare them and ask questions answered from their own text. Only you can see your PDFs.
        </p>
        <div className="mt-6">
          <LibraryView docs={(data ?? []) as LibraryDoc[]} userId={profile.id} />
        </div>
      </main>
    </div>
  );
}

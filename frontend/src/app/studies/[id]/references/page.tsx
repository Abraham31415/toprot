import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { StudyNav } from "@/components/study-nav";
import { ReferenceManager, type StudyRefRow } from "./reference-manager";

export default async function ReferencesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: studyId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  const { data: study } = await supabase
    .from("studies")
    .select("id, title, owner_id")
    .eq("id", studyId)
    .single();

  if (!study) notFound();

  const [{ data: references }, { data: collections }] = await Promise.all([
    supabase.from("study_references").select("*").eq("study_id", studyId).order("display_order", { ascending: true }),
    supabase.from("reference_collections").select("id, name").eq("study_id", studyId).order("name", { ascending: true }),
  ]);

  const isOwner = profile.id === study.owner_id;

  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-4xl px-6 py-10">
        <StudyNav studyId={study.id} active="references" />
        <h1 className="text-xl font-semibold text-navy">References</h1>
        <p className="mt-1 text-sm text-navy/65">{study.title}</p>
        <p className="mt-3 text-sm text-navy/65">
          References come from Crossref, PubMed or OpenAlex, from a file you import, from your Zotero library, or from your own typing. Each shows where it came from. ToProt never generates or guesses a citation.
        </p>

        <div className="mt-6">
          <ReferenceManager studyId={study.id} references={(references ?? []) as StudyRefRow[]} collections={(collections ?? []) as { id: string; name: string }[]} readOnly={!isOwner} />
        </div>
      </main>
    </div>
  );
}

import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { StudyNav } from "@/components/study-nav";
import type { StudyReference } from "@/lib/protocol/references";
import { ReferenceManager } from "./reference-manager";

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

  const { data: references } = await supabase
    .from("study_references")
    .select("*")
    .eq("study_id", studyId)
    .order("display_order", { ascending: true });

  const isOwner = profile.id === study.owner_id;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <StudyNav studyId={study.id} active="references" />
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">References</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{study.title}</p>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Every reference here comes straight from CrossRef or PubMed. ToProt never generates
          or guesses a citation.
        </p>

        <div className="mt-6">
          <ReferenceManager
            studyId={study.id}
            initialReferences={(references ?? []) as StudyReference[]}
            readOnly={!isOwner}
          />
        </div>
      </main>
    </div>
  );
}

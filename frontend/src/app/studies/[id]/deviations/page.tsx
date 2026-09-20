import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { StudyNav } from "@/components/study-nav";
import { DeviationForm } from "./deviation-form";

export default async function DeviationsPage({ params }: { params: Promise<{ id: string }> }) {
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

  const { data: version } = await supabase
    .from("protocol_versions")
    .select("id")
    .eq("study_id", studyId)
    .in("status", ["draft", "registered"])
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (!version) notFound();

  const { data: deviations } = await supabase
    .from("deviations")
    .select("id, category, description, occurred_at, impact_assessment, created_at")
    .eq("study_id", studyId)
    .order("occurred_at", { ascending: false });

  const isOwner = profile.id === study.owner_id;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <StudyNav studyId={study.id} active="deviations" />
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Deviation log</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{study.title}</p>

        {isOwner && (
          <div className="mt-6">
            <DeviationForm studyId={study.id} versionId={version.id} />
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {!deviations?.length && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No deviations logged.</p>
          )}
          {deviations?.map((d) => (
            <div
              key={d.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium capitalize text-zinc-900 dark:text-zinc-100">
                  {d.category.replace("_", " ")}
                </span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {new Date(d.occurred_at).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{d.description}</p>
              {d.impact_assessment && (
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Impact: {d.impact_assessment}
                </p>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

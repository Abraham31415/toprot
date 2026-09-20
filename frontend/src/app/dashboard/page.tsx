import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { currentStage } from "@/lib/protocol/milestones";
import { NewStudyForm } from "./new-study-form";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();

  if (!profile) redirect("/login");
  if (profile.role !== "student") redirect("/supervisor");

  const supabase = await createClient();
  const { data: studies } = await supabase
    .from("studies")
    .select("id, title, status, current_enrollment, created_at")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false });

  const studyIds = studies?.map((s) => s.id) ?? [];
  const { data: milestones } = studyIds.length
    ? await supabase.from("milestones").select("study_id, milestone_type, status").in("study_id", studyIds)
    : { data: [] };

  const milestonesByStudy = new Map<string, typeof milestones>();
  for (const m of milestones ?? []) {
    const list = milestonesByStudy.get(m.study_id) ?? [];
    list.push(m);
    milestonesByStudy.set(m.study_id, list);
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Your studies</h1>
        <div className="mt-4">
          <NewStudyForm />
        </div>

        <div className="mt-8 flex flex-col gap-3">
          {!studies?.length && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No studies yet. Start one above.
            </p>
          )}
          {studies?.map((study) => {
            const stage = currentStage(milestonesByStudy.get(study.id) ?? []) ?? "Not started";
            return (
              <Link
                key={study.id}
                href={`/studies/${study.id}/protocol`}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
              >
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{study.title}</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {stage} · enrollment {study.current_enrollment}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}

import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { StudyNav } from "@/components/study-nav";
import { MILESTONE_TYPES, type MilestoneRow as MilestoneRowType } from "@/lib/protocol/milestones";
import { MilestoneRow } from "./milestone-row";

export default async function MilestonesPage({ params }: { params: Promise<{ id: string }> }) {
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

  const { data: milestones } = await supabase
    .from("milestones")
    .select("*")
    .eq("study_id", studyId);

  const byType = new Map((milestones ?? []).map((m) => [m.milestone_type, m as MilestoneRowType]));
  const isOwner = profile.id === study.owner_id;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <StudyNav studyId={study.id} active="milestones" />
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Milestone tracker</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{study.title}</p>

        <div className="mt-6 flex flex-col gap-2">
          {MILESTONE_TYPES.map((type) => {
            const milestone = byType.get(type);
            if (!milestone) return null;
            return (
              <MilestoneRow key={type} studyId={study.id} milestone={milestone} readOnly={!isOwner} />
            );
          })}
        </div>
      </main>
    </div>
  );
}

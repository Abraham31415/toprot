import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { currentStage } from "@/lib/protocol/milestones";
import { latestOf, isStalled } from "@/lib/protocol/stalled";
import { InvitationCard } from "./invitation-card";
import { AmendmentCard } from "./amendment-card";

export default async function SupervisorPage() {
  const profile = await getCurrentProfile();

  if (!profile) redirect("/login");
  if (!profile.role) redirect("/onboarding");
  if (profile.role !== "supervisor") redirect("/dashboard");

  const supabase = await createClient();

  const [{ data: invitations }, { data: attached }, { data: workspace }, { data: amendments }] =
    await Promise.all([
      supabase
        .from("supervisor_invitations")
        .select("id, studies(title)")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("study_supervisors")
        .select("study_id, studies(id, title, status, current_enrollment, created_at)")
        .eq("supervisor_id", profile.id),
      supabase.from("workspaces").select("stalled_threshold_days").eq("supervisor_id", profile.id).single(),
      supabase
        .from("amendments")
        .select("id, study_id, reason, studies(title)")
        .eq("status", "proposed")
        .order("created_at", { ascending: false }),
    ]);

  const studyIds = (attached ?? []).map((r) => r.study_id);
  const threshold = workspace?.stalled_threshold_days ?? 14;

  const [{ data: milestones }, { data: deviations }, { data: versions }] = studyIds.length
    ? await Promise.all([
        supabase.from("milestones").select("study_id, milestone_type, status, updated_at").in("study_id", studyIds),
        supabase.from("deviations").select("study_id, created_at").in("study_id", studyIds),
        supabase.from("protocol_versions").select("study_id, updated_at").in("study_id", studyIds),
      ])
    : [{ data: null }, { data: null }, { data: null }];

  const byStudy = <T extends { study_id: string }>(rows: T[] | null) => {
    const map = new Map<string, T[]>();
    for (const row of rows ?? []) {
      const list = map.get(row.study_id) ?? [];
      list.push(row);
      map.set(row.study_id, list);
    }
    return map;
  };

  const milestonesByStudy = byStudy(milestones);
  const deviationsByStudy = byStudy(deviations);
  const versionsByStudy = byStudy(versions);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-6 py-12">
        {!!invitations?.length && (
          <div className="mb-10">
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              Pending invitations
            </h2>
            <div className="mt-3 flex flex-col gap-3">
              {invitations.map((inv) => {
                const study = inv.studies as unknown as { title: string } | null;
                return (
                  <InvitationCard key={inv.id} invitationId={inv.id} studyTitle={study?.title ?? "Untitled study"} />
                );
              })}
            </div>
          </div>
        )}

        {!!amendments?.length && (
          <div className="mb-10">
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              Amendments awaiting your review
            </h2>
            <div className="mt-3 flex flex-col gap-3">
              {amendments.map((a) => {
                const study = a.studies as unknown as { title: string } | null;
                return (
                  <AmendmentCard
                    key={a.id}
                    amendmentId={a.id}
                    studyId={a.study_id}
                    studyTitle={study?.title ?? "Untitled study"}
                    reason={a.reason}
                  />
                );
              })}
            </div>
          </div>
        )}

        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
          Supervised studies
        </h1>
        <div className="mt-4 flex flex-col gap-3">
          {!attached?.length && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No studies attached yet. Students can invite you once they have one underway.
            </p>
          )}
          {attached?.map((row) => {
            const study = row.studies as unknown as {
              id: string;
              title: string;
              status: string;
              current_enrollment: number;
              created_at: string;
            } | null;
            if (!study) return null;

            const stage = currentStage(milestonesByStudy.get(study.id) ?? []) ?? "Not started";
            const deviationCount = (deviationsByStudy.get(study.id) ?? []).length;
            const lastActivity = latestOf(
              study.created_at,
              ...(milestonesByStudy.get(study.id) ?? []).map((m) => m.updated_at),
              ...(deviationsByStudy.get(study.id) ?? []).map((d) => d.created_at),
              ...(versionsByStudy.get(study.id) ?? []).map((v) => v.updated_at),
            );
            const stalled = isStalled(lastActivity, threshold);

            return (
              <Link
                key={study.id}
                href={`/studies/${study.id}/protocol`}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">{study.title}</p>
                    {stalled && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-400">
                        Stalled
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {stage} · enrollment {study.current_enrollment} · {deviationCount} deviation
                    {deviationCount === 1 ? "" : "s"}
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

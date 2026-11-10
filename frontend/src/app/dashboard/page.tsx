import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { currentStage } from "@/lib/protocol/milestones";
import { computeCompletion } from "@/lib/protocol/completion";
import { buildInitialSnapshot } from "@/lib/protocol/quality";
import type { MilestoneRow } from "@/lib/protocol/milestones";
import type { ObjectiveRow, ProtocolVersionRow, VariableRow } from "@/lib/protocol/types";
import { NewStudyForm } from "./new-study-form";

type MilestoneLite = Pick<MilestoneRow, "study_id" | "milestone_type" | "status">;
type ObjectiveWithVersion = ObjectiveRow & { protocol_version_id: string };
type VariableWithVersion = VariableRow & { protocol_version_id: string };

export default async function DashboardPage() {
  const profile = await getCurrentProfile();

  if (!profile) redirect("/login");
  if (!profile.role) redirect("/onboarding");
  if (profile.role !== "student") redirect("/supervisor");

  const supabase = await createClient();
  const { data: studies } = await supabase
    .from("studies")
    .select("id, title, status, current_enrollment, created_at")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false });

  const studyIds = studies?.map((s) => s.id) ?? [];

  const [{ data: milestones }, { data: versions }] = studyIds.length
    ? await Promise.all([
        supabase.from("milestones").select("study_id, milestone_type, status").in("study_id", studyIds),
        supabase
          .from("protocol_versions")
          .select("*")
          .in("study_id", studyIds)
          .in("status", ["draft", "registered"])
          .order("version_number", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  // Latest open version per study (rows arrive newest first).
  const versionByStudy = new Map<string, ProtocolVersionRow>();
  for (const v of (versions ?? []) as ProtocolVersionRow[]) {
    if (!versionByStudy.has(v.study_id)) versionByStudy.set(v.study_id, v);
  }
  const versionIds = [...versionByStudy.values()].map((v) => v.id);

  const [{ data: objectives }, { data: variables }] = versionIds.length
    ? await Promise.all([
        supabase.from("protocol_objectives").select("*").in("protocol_version_id", versionIds),
        supabase.from("protocol_variables").select("*").in("protocol_version_id", versionIds),
      ])
    : [{ data: [] }, { data: [] }];

  const milestonesByStudy = new Map<string, MilestoneLite[]>();
  for (const m of (milestones ?? []) as MilestoneLite[]) {
    const list = milestonesByStudy.get(m.study_id) ?? [];
    list.push(m);
    milestonesByStudy.set(m.study_id, list);
  }

  const cards = (studies ?? []).map((study) => {
    const version = versionByStudy.get(study.id);
    const completion = version
      ? computeCompletion(
          buildInitialSnapshot(
            version,
            ((objectives ?? []) as ObjectiveWithVersion[]).filter((o) => o.protocol_version_id === version.id),
            ((variables ?? []) as VariableWithVersion[]).filter((v) => v.protocol_version_id === version.id),
            study.current_enrollment,
          ),
        )
      : null;
    return {
      study,
      version,
      completion,
      stage: currentStage(milestonesByStudy.get(study.id) ?? []) ?? "Not started",
    };
  });

  const withProgress = cards.filter((c) => c.completion);
  const avg = withProgress.length
    ? Math.round(withProgress.reduce((n, c) => n + (c.completion?.percent ?? 0), 0) / withProgress.length)
    : 0;
  const locked = cards.filter((c) => c.version?.status === "registered").length;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Your studies</h1>

        {cards.length > 0 && (
          <dl className="mt-4 grid grid-cols-3 gap-3">
            {[
              ["Studies", String(cards.length)],
              ["Average protocol completion", `${avg}%`],
              ["Protocols locked", String(locked)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
                <dd className="mt-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-6">
          <NewStudyForm />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {!cards.length && (
            <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center sm:col-span-2 dark:border-zinc-700">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">No studies yet</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Name your first study above to start building its protocol.
              </p>
            </div>
          )}
          {cards.map(({ study, version, completion, stage }) => (
            <article
              key={study.id}
              className="flex flex-col rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/studies/${study.id}/protocol`}
                  className="font-medium text-zinc-900 hover:text-teal dark:text-zinc-100"
                >
                  {study.title}
                </Link>
                {version && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      version.status === "registered"
                        ? "bg-teal/10 text-teal"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                    }`}
                  >
                    {version.status === "registered" ? "Locked" : "Draft"} v{version.version_number}
                  </span>
                )}
              </div>

              {completion && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                    <span>Protocol</span>
                    <span>
                      {completion.percent}% ({completion.completeSections}/{completion.sections.length} sections)
                    </span>
                  </div>
                  <div
                    className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"
                    role="progressbar"
                    aria-label={`Protocol completion for ${study.title}`}
                    aria-valuenow={completion.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="h-full bg-teal" style={{ width: `${completion.percent}%` }} />
                  </div>
                </div>
              )}

              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                Stage: {stage} · enrollment {study.current_enrollment ?? 0}
              </p>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-900">
                {[
                  ["protocol", "Protocol"],
                  ["references", "References"],
                  ["outputs", "Documents"],
                  ["milestones", "Milestones"],
                ].map(([slug, label]) => (
                  <Link
                    key={slug}
                    href={`/studies/${study.id}/${slug}`}
                    className="rounded-md px-2 py-1 font-medium text-zinc-600 hover:bg-zinc-100 hover:text-teal dark:text-zinc-400 dark:hover:bg-zinc-900"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}

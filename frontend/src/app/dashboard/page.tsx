import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BrainCircuit,
  Calculator,
  CalendarClock,
  FileText,
  FlaskConical,
  History,
  Library,
  type LucideIcon,
} from "lucide-react";
import { getHeadroom } from "@/lib/ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { currentStage, MILESTONE_LABELS } from "@/lib/protocol/milestones";
import { computeCompletion } from "@/lib/protocol/completion";
import { buildInitialSnapshot } from "@/lib/protocol/quality";
import type { MilestoneRow } from "@/lib/protocol/milestones";
import type { ObjectiveRow, ProtocolVersionRow, VariableRow } from "@/lib/protocol/types";
import { NewStudyForm } from "./new-study-form";

export const dynamic = "force-dynamic";

type MilestoneLite = Pick<MilestoneRow, "study_id" | "milestone_type" | "status" | "target_date" | "updated_at">;
type ObjectiveWithVersion = ObjectiveRow & { protocol_version_id: string };
type VariableWithVersion = VariableRow & { protocol_version_id: string };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const credits = (mcr: number) => (mcr / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 });

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function DashboardPage() {
  const profile = await getCurrentProfile();

  if (!profile) redirect("/login");
  if (!profile.role) redirect("/onboarding");
  if (profile.role !== "student") redirect("/supervisor");

  const supabase = await createClient();
  const { data: studies } = await supabase
    .from("studies")
    .select("id, title, status, current_enrollment, created_at, last_activity_at")
    .eq("owner_id", profile.id)
    .order("last_activity_at", { ascending: false });

  const studyIds = studies?.map((s) => s.id) ?? [];
  const titleById = new Map((studies ?? []).map((s) => [s.id, s.title]));

  const [{ data: milestones }, { data: versions }, { data: refs }, headroom] = await Promise.all([
    studyIds.length
      ? supabase
          .from("milestones")
          .select("study_id, milestone_type, status, target_date, updated_at")
          .in("study_id", studyIds)
      : Promise.resolve({ data: [] }),
    studyIds.length
      ? supabase
          .from("protocol_versions")
          .select("*")
          .in("study_id", studyIds)
          .in("status", ["draft", "registered"])
          .order("version_number", { ascending: false })
      : Promise.resolve({ data: [] }),
    studyIds.length
      ? supabase.from("study_references").select("study_id").in("study_id", studyIds)
      : Promise.resolve({ data: [] }),
    getHeadroom(createAdminClient(), profile.id).catch(() => null),
  ]);

  // Latest open version per study (rows arrive newest first).
  const versionByStudy = new Map<string, ProtocolVersionRow>();
  for (const v of (versions ?? []) as ProtocolVersionRow[]) {
    if (!versionByStudy.has(v.study_id)) versionByStudy.set(v.study_id, v);
  }
  const versionIds = [...versionByStudy.values()].map((v) => v.id);

  const [{ data: objectives }, { data: variables }, { data: outputs }] = versionIds.length
    ? await Promise.all([
        supabase.from("protocol_objectives").select("*").in("protocol_version_id", versionIds),
        supabase.from("protocol_variables").select("*").in("protocol_version_id", versionIds),
        supabase.from("generated_outputs").select("id").in("protocol_version_id", versionIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

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

  const now = new Date().toISOString().slice(0, 10);
  const upcoming = ((milestones ?? []) as MilestoneLite[])
    .filter((m) => m.status !== "complete" && m.target_date)
    .sort((a, b) => (a.target_date! < b.target_date! ? -1 : 1))
    .slice(0, 5);
  const recentMilestones = ((milestones ?? []) as MilestoneLite[])
    .filter((m) => m.status !== "pending")
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .slice(0, 4);

  const firstName = profile.full_name.split(" ")[0];

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome back, {firstName}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm text-ink-muted">Pick up a project or start a new one.</p>
        {headroom && (
          <Link
            href="/billing"
            aria-label={headroom.planKey === "free" ? "You are on the Free plan. Open billing to upgrade." : "You are on Toprot Pro. Open billing."}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${headroom.planKey === "free" ? "bg-navy/10 text-ink-soft hover:bg-navy/10" : "bg-teal/10 text-teal-ink hover:bg-teal/20"}`}
          >
            {headroom.planKey === "free" ? "Free plan" : "Toprot Pro"}
            {headroom.planKey === "free" && <span className="text-primary">Upgrade</span>}
          </Link>
        )}
      </div>

      <div className="mt-5">
        <NewStudyForm />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={FlaskConical} label="Projects" value={String(cards.length)} />
        <Stat icon={FlaskConical} label="Avg. protocol complete" value={`${avg}%`} />
        <Stat icon={Library} label="Saved references" value={String(refs?.length ?? 0)} />
        <Stat icon={FileText} label="Generated documents" value={String(outputs?.length ?? 0)} />
      </div>

      <section className="mt-8" aria-labelledby="projects-heading">
        <h2 id="projects-heading" className="text-lg font-semibold text-ink">
          Recent projects
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {!cards.length && (
            <div className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center sm:col-span-2">
              <FlaskConical className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
              <p className="mt-2 font-medium text-ink">No projects yet</p>
              <p className="mt-1 text-sm text-ink-muted">Name your first study above to start its protocol.</p>
            </div>
          )}
          {cards.map(({ study, version, completion, stage }) => (
            <article key={study.id} className="flex flex-col rounded-lg border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/studies/${study.id}/protocol`} className="font-medium text-ink hover:text-primary">
                  {study.title}
                </Link>
                {version && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      version.status === "registered" ? "bg-teal/10 text-teal-ink" : "bg-surface-soft text-primary-hover"
                    }`}
                  >
                    {version.status === "registered" ? "Locked" : "Draft"} v{version.version_number}
                  </span>
                )}
              </div>

              {completion && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-ink-muted">
                    <span>Protocol</span>
                    <span>
                      {completion.percent}% ({completion.completeSections}/{completion.sections.length} sections)
                    </span>
                  </div>
                  <div
                    className="mt-1 h-1.5 overflow-hidden rounded-full bg-navy/10"
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

              <p className="mt-3 text-sm text-ink-muted">
                Stage: {stage} · enrollment {study.current_enrollment ?? 0}
              </p>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3 text-sm">
                {[
                  ["protocol", "Protocol"],
                  ["references", "References"],
                  ["outputs", "Documents"],
                  ["milestones", "Milestones"],
                ].map(([slug, label]) => (
                  <Link
                    key={slug}
                    href={`/studies/${study.id}/${slug}`}
                    className="rounded-md px-2 py-1 font-medium text-ink-soft hover:bg-surface-soft hover:text-primary-hover"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Panel title="Quick access" icon={Calculator}>
          <Link
            href="/calculator"
            className="flex items-center justify-between rounded-md border border-line px-3 py-2.5 text-sm font-medium text-ink hover:border-primary"
          >
            <span className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" aria-hidden="true" />
              Sample size calculator
            </span>
            <ArrowRight className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          </Link>
          <p className="mt-3 text-xs text-ink-muted">More research tools will appear here as they are released.</p>
        </Panel>

        <Panel title="AI credits" icon={BrainCircuit}>
          {headroom ? (
            <>
              <p className="mb-2 text-xs font-medium text-ink-muted">
                Plan: <span className="text-ink">{headroom.planKey === "free" ? "Free" : "Toprot Pro"}</span>
                {headroom.planKey !== "free" && headroom.periodEnd ? ` (current period ends ${fmtDate(headroom.periodEnd)})` : ""}
              </p>
              <p className="text-2xl font-semibold text-ink">
                {credits(headroom.availableMcr)}
                <span className="ml-2 text-sm font-normal text-ink-muted">credits available</span>
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {credits(headroom.subscriptionAvailableMcr)} of {credits(headroom.allowanceMcr)} from your plan
                {headroom.purchasedAvailableMcr > 0 ? `, plus ${credits(headroom.purchasedAvailableMcr)} purchased` : ""}
              </p>
              <Link href="/billing" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary">
                Billing and usage <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </>
          ) : (
            <p className="text-sm text-ink-muted">Credit balance is temporarily unavailable.</p>
          )}
        </Panel>

        <Panel title="Upcoming milestones" icon={CalendarClock}>
          {upcoming.length ? (
            <ul className="space-y-2 text-sm">
              {upcoming.map((m) => (
                <li key={`${m.study_id}-${m.milestone_type}`} className="flex items-start justify-between gap-3">
                  <span>
                    <span className="font-medium text-ink">{MILESTONE_LABELS[m.milestone_type]}</span>
                    <span className="block text-xs text-ink-muted">{titleById.get(m.study_id)}</span>
                  </span>
                  <span className={`shrink-0 text-xs ${m.target_date! < now ? "text-red-700" : "text-ink-muted"}`}>
                    {m.target_date! < now ? "Overdue " : ""}
                    {fmtDate(m.target_date!)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No dated milestones. Set target dates on a study&apos;s milestones page.</p>
          )}
        </Panel>

        <Panel title="Recent activity" icon={History}>
          {recentMilestones.length ? (
            <ul className="space-y-2 text-sm">
              {recentMilestones.map((m) => (
                <li key={`${m.study_id}-${m.milestone_type}`} className="flex items-start justify-between gap-3">
                  <span>
                    <span className="font-medium text-ink">{MILESTONE_LABELS[m.milestone_type]}</span>{" "}
                    <span className="text-ink-muted">{m.status === "complete" ? "completed" : "in progress"}</span>
                    <span className="block text-xs text-ink-muted">{titleById.get(m.study_id)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-muted">{fmtDate(m.updated_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">Milestone updates will show up here.</p>
          )}
        </Panel>
      </div>
    </main>
  );
}

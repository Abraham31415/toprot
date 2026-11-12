import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  CalendarClock,
  ClipboardCheck,
  FileText,
  FlaskConical,
  History,
  Library,
  PenLine,
  Sparkles,
  Wrench,
} from "lucide-react";
import { getHeadroom } from "@/lib/ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { currentStage, MILESTONE_LABELS } from "@/lib/protocol/milestones";
import { computeCompletion } from "@/lib/protocol/completion";
import { buildInitialSnapshot, SECTION_LABELS } from "@/lib/protocol/quality";
import type { MilestoneRow } from "@/lib/protocol/milestones";
import type { ObjectiveRow, ProtocolVersionRow, VariableRow } from "@/lib/protocol/types";
import { Card, MetricCard, Panel, ProjectCard, ResearchModuleCard } from "@/components/ds/card";
import { NewProjectPanel } from "./new-study-form";

export const dynamic = "force-dynamic";

type MilestoneLite = Pick<MilestoneRow, "study_id" | "milestone_type" | "status" | "target_date" | "updated_at">;
type ObjectiveWithVersion = ObjectiveRow & { protocol_version_id: string };
type VariableWithVersion = VariableRow & { protocol_version_id: string };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const credits = (mcr: number) => (mcr / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 });

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

  // The same rule as each project's own progress bar: the share of required protocol items that are filled in. The average is across projects.
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
  const isFree = headroom?.planKey === "free";
  const latestStudy = cards[0]?.study;
  const hasProjects = cards.length > 0;

  const quick = [
    { href: "/tools", title: "Research Toolkit", note: "Calculators and statistical tests", icon: Wrench },
    { href: "/literature", title: "Literature Explorer", note: "Search scholarly sources", icon: BookOpen },
    ...(latestStudy ? [{ href: `/studies/${latestStudy.id}/references`, title: "Reference Manager", note: "References for your latest project", icon: Library }] : []),
    { href: "/writing", title: "Academic Writing", note: "Manuscripts and citations", icon: PenLine },
    { href: "/assistant", title: "AI Research Assistant", note: "Uses AI credits", icon: Sparkles },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="type-page">Your research workspace</h1>
          <p className="type-support mt-1.5 !text-ink-soft">
            <span className="inline-block max-w-[16rem] truncate align-bottom" title={firstName}>Welcome back, {firstName}.</span>{" "}
            {hasProjects ? "Continue your projects or start something new." : "Let us set up your first project."}
          </p>
          {headroom && (
            <Link
              href="/billing"
              aria-label={isFree ? "You are on the Free plan. Open billing to upgrade." : "You are on Toprot Pro. Open billing."}
              className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${isFree ? "border-line bg-surface text-ink-soft hover:border-line-strong" : "border-success-line bg-success-bg text-success-ink hover:border-teal"}`}
            >
              {isFree ? "Free plan" : "Toprot Pro"}
              {isFree && <span className="text-primary">Upgrade</span>}
            </Link>
          )}
        </div>
        {hasProjects && <NewProjectPanel />}
      </header>

      {!hasProjects ? (
        <section aria-labelledby="start-heading" className="mt-8">
          <Card padding="lg" className="text-center sm:!p-10">
            <FlaskConical className="mx-auto h-9 w-9 text-primary" aria-hidden="true" />
            <h2 id="start-heading" className="type-section mt-3">Start your first research project</h2>
            <p className="type-body mx-auto mt-2 max-w-xl !text-base">Create a study, define your objectives, and build your research protocol step by step.</p>
            <div className="mt-6 flex justify-center"><NewProjectPanel first /></div>
            <p className="type-support mt-6">
              Or explore first: <Link href="/tools" className="font-medium text-primary hover:underline">Research Toolkit</Link> and{" "}
              <Link href="/literature" className="font-medium text-primary hover:underline">Literature Explorer</Link>.
            </p>
          </Card>
        </section>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard icon={FlaskConical} label="Projects" value={String(cards.length)} />
          <MetricCard icon={ClipboardCheck} tone="teal" label="Average protocol completion" value={`${avg}%`} />
          <MetricCard icon={Library} tone="violet" label="Saved references" value={String(refs?.length ?? 0)} />
          <MetricCard icon={FileText} tone="terracotta" label="Generated documents" value={String(outputs?.length ?? 0)} />
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          {hasProjects && (
            <section aria-labelledby="projects-heading">
              <h2 id="projects-heading" className="type-section !text-xl">Recent projects</h2>
              <div className="mt-3 grid gap-4">
                {cards.map(({ study, version, completion, stage }) => {
                  const open = completion?.sections.find((s) => !s.complete);
                  const nextStep = version?.status === "registered"
                    ? "This protocol version is locked."
                    : open
                      ? `${SECTION_LABELS[open.key]}: add ${open.missing[0]}.`
                      : completion
                        ? "All required protocol items are filled in."
                        : undefined;
                  return (
                    <ProjectCard
                      key={study.id}
                      title={study.title}
                      href={`/studies/${study.id}/protocol`}
                      status={version ? { label: `${version.status === "registered" ? "Locked" : "Draft"} v${version.version_number}`, tone: version.status === "registered" ? "locked" : "draft" } : undefined}
                      progress={completion ? {
                        value: completion.percent,
                        label: "Protocol",
                        detail: `${completion.percent}% complete`,
                        note: `${completion.filled} of ${completion.total} required items filled, ${completion.completeSections} of ${completion.sections.length} sections complete.`,
                      } : undefined}
                      stage={`${stage}${study.current_enrollment ? ` · enrollment ${study.current_enrollment}` : ""}`}
                      updated={study.last_activity_at ? fmtDate(study.last_activity_at) : undefined}
                      nextStep={nextStep}
                      links={[
                        { label: "Protocol", href: `/studies/${study.id}/protocol` },
                        { label: "References", href: `/studies/${study.id}/references` },
                        { label: "Documents", href: `/studies/${study.id}/outputs` },
                        { label: "Milestones", href: `/studies/${study.id}/milestones` },
                      ]}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {hasProjects && (
            <Panel title="Recent activity" icon={History}>
              {recentMilestones.length ? (
                <ul className="space-y-3 text-sm">
                  {recentMilestones.map((m) => (
                    <li key={`${m.study_id}-${m.milestone_type}`} className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="font-medium text-ink">{MILESTONE_LABELS[m.milestone_type]}</span>{" "}
                        <span className="text-ink-soft">{m.status === "complete" ? "completed" : "in progress"}</span>
                        <span className="type-caption block break-words">{titleById.get(m.study_id)}</span>
                      </span>
                      <span className="type-caption shrink-0">{fmtDate(m.updated_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="type-support">Nothing yet. Milestone updates will show up here.</p>
              )}
            </Panel>
          )}
        </div>

        <aside aria-label="Tools and account" className="min-w-0 space-y-6">
          <Panel title="AI credits" icon={BrainCircuit}>
            {headroom ? (
              <>
                <p className="type-caption mb-2">Plan: <span className="font-medium text-ink">{isFree ? "Free" : "Toprot Pro"}</span></p>
                <p className="type-stat">
                  {credits(headroom.availableMcr)}
                  <span className="ml-2 text-sm font-normal text-ink-muted">credits available</span>
                </p>
                <dl className="type-support mt-3 space-y-1">
                  <div className="flex justify-between gap-3"><dt>{isFree ? "Introductory credits left" : "Monthly credits left"}</dt><dd className="text-ink">{credits(headroom.subscriptionAvailableMcr)} of {credits(headroom.allowanceMcr)}</dd></div>
                  {headroom.purchasedAvailableMcr > 0 && <div className="flex justify-between gap-3"><dt>Purchased credits left</dt><dd className="text-ink">{credits(headroom.purchasedAvailableMcr)}</dd></div>}
                  <div className="flex justify-between gap-3"><dt>Used this period</dt><dd className="text-ink">{credits(headroom.usedMcr)}</dd></div>
                  {!isFree && headroom.periodEnd && <div className="flex justify-between gap-3"><dt>Resets</dt><dd className="text-ink">{fmtDate(headroom.periodEnd)}</dd></div>}
                </dl>
                <Link href="/billing" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Billing and usage <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </>
            ) : (
              <p className="type-support">Credit balance is temporarily unavailable.</p>
            )}
          </Panel>

          <Panel title="Quick access" icon={Wrench}>
            <ul className="space-y-2">
              {quick.map((q) => (
                <li key={q.href}><ResearchModuleCard icon={q.icon} title={q.title} description={q.note} href={q.href} /></li>
              ))}
            </ul>
          </Panel>

          <Panel title="Upcoming milestones" icon={CalendarClock}>
            {upcoming.length ? (
              <ul className="space-y-3 text-sm">
                {upcoming.map((m) => (
                  <li key={`${m.study_id}-${m.milestone_type}`} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{MILESTONE_LABELS[m.milestone_type]}</span>
                      <span className="type-caption block break-words">{titleById.get(m.study_id)}</span>
                    </span>
                    <span className={`shrink-0 text-xs ${m.target_date! < now ? "font-medium text-danger-ink" : "text-ink-muted"}`}>
                      {m.target_date! < now ? "Overdue " : ""}
                      {fmtDate(m.target_date!)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="type-support">
                {hasProjects ? "No dated milestones. Set target dates on a project's milestones page." : "Milestones appear here once you create a project."}
              </p>
            )}
          </Panel>
        </aside>
      </div>
    </main>
  );
}

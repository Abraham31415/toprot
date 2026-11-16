import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatusIndicator } from "@/components/ds";
import { currentStage } from "@/lib/protocol/milestones";
import { latestOf, isStalled } from "@/lib/protocol/stalled";
import { REVIEW_DISCLAIMER, STATUS_LABEL, STATUS_TONE, type ReviewStatus } from "@/lib/collab/review";
import { InvitationCard } from "./invitation-card";
import { AmendmentCard } from "./amendment-card";

export const dynamic = "force-dynamic";

type Row = {
  study_id: string; title: string; owner_name: string; study_status: string; last_activity_at: string;
  review_status: ReviewStatus; status_at: string | null; latest_submission_at: string | null; on_latest: boolean | null; open_threads: number; approvals: number;
};

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function SupervisorPage() {
  const profile = await getCurrentProfile();

  if (!profile) redirect("/login");
  if (!profile.role) redirect("/onboarding");
  // Anyone can open Supervision: what it shows depends only on the projects they hold a reviewer role on, not on their profile label.

  const supabase = await createClient();
  const db = createAdminClient();

  const [{ data: invitations }, { data: overview }, { data: workspace }, { data: amendments }] = await Promise.all([
    db.rpc("collab_my_invitations", { p_actor: profile.id }),
    db.rpc("collab_supervision_overview", { p_actor: profile.id }),
    supabase.from("workspaces").select("stalled_threshold_days").eq("supervisor_id", profile.id).maybeSingle(),
    supabase.from("amendments").select("id, study_id, reason, studies(title)").eq("status", "proposed").order("created_at", { ascending: false }),
  ]);

  const rows = (overview ?? []) as Row[];
  const studyIds = rows.map((r) => r.study_id);
  const threshold = workspace?.stalled_threshold_days ?? 14;

  const { data: milestones } = studyIds.length
    ? await supabase.from("milestones").select("study_id, milestone_type, status, updated_at").in("study_id", studyIds)
    : { data: null };
  const byStudy = new Map<string, NonNullable<typeof milestones>>();
  for (const m of milestones ?? []) byStudy.set(m.study_id, [...(byStudy.get(m.study_id) ?? []), m]);

  const waiting = rows.filter((r) => r.review_status === "submitted" || r.review_status === "resubmitted");

  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-xl font-semibold text-navy">Supervision</h1>
        <p className="mt-1 text-sm text-navy/70">Projects you review as a supervisor. You do not need a separate login: a researcher invites your email address and you accept here. {REVIEW_DISCLAIMER}</p>

        {!!(invitations as unknown[] | null)?.length && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-navy">Pending invitations</h2>
            <div className="mt-3 flex flex-col gap-3">
              {(invitations as { invitation_id: string; study_title: string }[]).map((inv) => (
                <InvitationCard key={inv.invitation_id} invitationId={inv.invitation_id} studyTitle={inv.study_title ?? "Untitled study"} />
              ))}
            </div>
          </div>
        )}

        {waiting.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-navy">Waiting for your review</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {waiting.map((r) => (
                <li key={r.study_id}>
                  <Link href={`/studies/${r.study_id}/review`} className="flex items-center justify-between gap-3 rounded-lg border border-cobalt/40 bg-white p-4 hover:border-cobalt">
                    <div>
                      <p className="font-medium text-navy">{r.title}</p>
                      <p className="text-sm text-navy/65">{r.owner_name || "Researcher"}{r.latest_submission_at ? `, submitted ${when(r.latest_submission_at)}` : ""}</p>
                    </div>
                    <StatusIndicator status="info">{STATUS_LABEL[r.review_status]}</StatusIndicator>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!!amendments?.length && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-navy">Amendments awaiting your review</h2>
            <div className="mt-3 flex flex-col gap-3">
              {amendments.map((a) => {
                const study = a.studies as unknown as { title: string } | null;
                return <AmendmentCard key={a.id} amendmentId={a.id} studyId={a.study_id} studyTitle={study?.title ?? "Untitled study"} reason={a.reason} />;
              })}
            </div>
          </div>
        )}

        <h2 className="mt-8 text-lg font-semibold text-navy">Supervised projects</h2>
        <div className="mt-3 flex flex-col gap-3">
          {!rows.length && <p className="text-sm text-navy/65">No projects yet. When a researcher invites you and you accept, their project appears here.</p>}
          {rows.map((r) => {
            const ms = byStudy.get(r.study_id) ?? [];
            const stage = currentStage(ms) ?? "Not started";
            const stalled = isStalled(latestOf(r.last_activity_at, ...ms.map((m) => m.updated_at)), threshold);
            return (
              <Link key={r.study_id} href={`/studies/${r.study_id}/review`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4 transition-colors hover:border-navy/25">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-navy">{r.title}</p>
                    {stalled && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Stalled</span>}
                  </div>
                  <p className="text-sm text-navy/65">{r.owner_name || "Researcher"}. {stage}. {r.open_threads} open comment{r.open_threads === 1 ? "" : "s"}. {r.approvals} approval{r.approvals === 1 ? "" : "s"} by you.</p>
                </div>
                <StatusIndicator status={STATUS_TONE[r.review_status]}>{STATUS_LABEL[r.review_status]}</StatusIndicator>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}

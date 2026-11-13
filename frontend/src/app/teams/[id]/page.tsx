import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTIVITY_TEXT, formatBytes, getActivity, getTeam, teamCan } from "@/lib/collab/teams";

export const metadata: Metadata = { title: "Team overview", robots: { index: false } };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-muted">{note}</p>}
    </div>
  );
}

export default async function TeamOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const db = createAdminClient();
  const t = await getTeam(db, user.id, id);
  if (!t.ok) redirect("/teams");
  const o = t.overview;
  if (!teamCan(o.your_role, "view_dashboard")) redirect(`/teams/${id}/projects`);
  const activity = (await getActivity(db, user.id, id, 8));
  const paid = o.seats.paid_used, guests = o.seats.guests_used;

  return (
    <div className="flex flex-col gap-8">
      {o.entitlements.state !== "active" && (
        <p className="rounded-card border border-warning-line bg-warning-bg p-4 text-sm text-warning-ink">
          This team is not on a Team plan. It has {o.entitlements.max_paid_seats} paid seat{o.entitlements.max_paid_seats === 1 ? "" : "s"}, {o.entitlements.max_guests} guest seat{o.entitlements.max_guests === 1 ? "" : "s"} and room for {o.entitlements.max_projects} projects. Team projects follow each owner&apos;s own plan for collaboration limits.
        </p>
      )}
      <section aria-labelledby="stats-h">
        <h2 id="stats-h" className="sr-only">Team numbers</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Paid seats" value={`${paid} of ${o.entitlements.max_paid_seats}`} note={o.seats.paid_invited ? `${o.seats.paid_invited} invited` : undefined} />
          <Stat label="Guest reviewers" value={`${guests} of ${o.entitlements.max_guests}`} note={o.seats.guests_invited ? `${o.seats.guests_invited} invited` : undefined} />
          <Stat label="Projects" value={`${o.stats.projects}`} note={`${o.stats.active_projects} active`} />
          <Stat label="Documents" value={`${o.stats.documents}`} note={`${formatBytes(o.stats.storage_bytes)} of ${o.entitlements.max_storage_mb} MB`} />
          <Stat label="Shared references" value={`${o.stats.shared_references}`} />
          <Stat label="Review submissions" value={`${o.stats.submissions}`} note="Across team projects" />
          <Stat label="Supervisor approvals" value={`${o.stats.approvals}`} note="Internal reviews, not ethics approval" />
        </div>
      </section>
      <section aria-labelledby="act-h">
        <div className="mb-2 flex items-center justify-between"><h2 id="act-h" className="type-eyebrow">Recent activity</h2><Link href={`/teams/${id}/activity`} className="text-sm text-primary hover:underline">See all</Link></div>
        {activity.length === 0 ? <p className="text-sm text-ink-soft">Nothing yet.</p> : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {activity.map((a, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 p-3 text-sm"><span><strong className="font-medium text-ink">{a.actor ?? "Someone"}</strong> {ACTIVITY_TEXT[a.action] ?? a.action.replace(/_/g, " ")}{a.project ? ` (${a.project})` : ""}</span><span className="text-ink-muted">{when(a.at)}</span></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

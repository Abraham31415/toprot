import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTIVITY_TEXT, getActivity, getTeam, teamCan } from "@/lib/collab/teams";

export const metadata: Metadata = { title: "Team activity", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const db = createAdminClient();
  const t = await getTeam(db, user.id, id);
  if (!t.ok || !teamCan(t.overview.your_role, "view_dashboard")) redirect(`/teams/${id}/projects`);
  const items = await getActivity(db, user.id, id, 100);
  return (
    <section aria-labelledby="act-h">
      <h2 id="act-h" className="type-eyebrow mb-2">Activity timeline</h2>
      <p className="mb-3 text-sm text-ink-soft">Who did what in this team and its projects. Project content is never shown here.</p>
      {items.length === 0 ? <p className="text-sm text-ink-soft">Nothing yet.</p> : (
        <ol className="divide-y divide-line rounded-card border border-line bg-surface">
          {items.map((a, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
              <span><strong className="font-medium text-ink">{a.actor ?? "Someone"}</strong> {ACTIVITY_TEXT[a.action] ?? a.action.replace(/_/g, " ")}{a.target ? `: ${a.target}` : ""}{a.project ? ` (${a.project})` : ""}</span>
              <time dateTime={a.at} className="text-ink-muted">{new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

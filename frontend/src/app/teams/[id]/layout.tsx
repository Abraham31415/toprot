import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeam, TEAM_ROLE_LABEL, teamCan } from "@/lib/collab/teams";
import { TeamTabs } from "./team-tabs";

export default async function TeamLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const t = await getTeam(createAdminClient(), user.id, id);
  if (!t.ok) notFound();
  const o = t.overview;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <p className="text-sm"><Link href="/teams" className="text-ink-soft hover:text-primary hover:underline">Teams</Link></p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-ink">{o.team.name}</h1>
        <span className="rounded-full bg-surface-soft px-2.5 py-0.5 text-xs font-medium">{TEAM_ROLE_LABEL[o.your_role]}</span>
      </div>
      <TeamTabs teamId={id} showAll={teamCan(o.your_role, "view_dashboard")} />
      {children}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeam, teamCan } from "@/lib/collab/teams";
import { ROLE_LABEL } from "@/lib/collab/roles";
import { NewTeamProject, ProjectPeople } from "./project-tools";

export const metadata: Metadata = { title: "Team projects", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function TeamProjectsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const t = await getTeam(createAdminClient(), user.id, id);
  if (!t.ok) redirect("/teams");
  const o = t.overview;
  const candidates = o.members.filter((m) => m.user_id !== user.id).map((m) => ({ id: m.user_id, name: m.full_name || "Unnamed", seat: m.seat_type }));
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-ink-soft">Team members can see that a project exists, its status and how many people are on it. Only the people its owner adds can open it.</p>
      {teamCan(o.your_role, "create_project") && <NewTeamProject teamId={id} />}
      {o.projects.length === 0 ? <p className="text-sm text-ink-soft">No team projects yet.</p> : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {o.projects.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">{p.your_role ? <Link href={`/studies/${p.id}/protocol`} className="hover:underline">{p.title}</Link> : p.title}</p>
                  <p className="text-sm text-ink-soft">Owner: {p.owner || "Unnamed"}. {p.people} {p.people === 1 ? "person" : "people"}. {p.status}.</p>
                </div>
                <span className="rounded-full bg-surface-soft px-2.5 py-0.5 text-xs font-medium">{p.your_role ? `Your role: ${ROLE_LABEL[p.your_role]}` : "No access"}</span>
              </div>
              {(p.owner_id === user.id || o.your_role === "owner") && <ProjectPeople teamId={id} studyId={p.id} isProjectOwner={p.owner_id === user.id} candidates={candidates.concat(p.owner_id === user.id ? [] : [])} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

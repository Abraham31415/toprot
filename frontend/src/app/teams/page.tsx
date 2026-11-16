import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { Container, EmptyState, PageHeader } from "@/components/ds";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listTeams, TEAM_ROLE_LABEL } from "@/lib/collab/teams";
import { CreateTeamForm } from "./create-team-form";

export const metadata: Metadata = { title: "Teams", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const teams = await listTeams(createAdminClient(), user.id);
  return (
    <Container width="default">
      <PageHeader title="Teams" eyebrow="Collaboration" lead="A team is a group of researchers who share a workspace, files and references. Being in a team never gives anyone access to a project: each project's owner chooses who joins it." />
      <div className="flex flex-col gap-8 pb-16">
        {teams.length === 0 ? (
          <EmptyState icon={Users} title="You are not in a team yet" description="Create a team below, or accept an invitation from Shared with me." />
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {teams.map((t) => (
              <li key={t.id}>
                <Link href={`/teams/${t.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-hover">
                  <div><p className="font-medium text-ink">{t.name}</p><p className="text-sm text-ink-soft">{t.members} {t.members === 1 ? "person" : "people"}. {t.projects} project{t.projects === 1 ? "" : "s"}.</p></div>
                  <span className="rounded-full bg-surface-soft px-2.5 py-0.5 text-xs font-medium">{TEAM_ROLE_LABEL[t.role]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <CreateTeamForm />
      </div>
    </Container>
  );
}

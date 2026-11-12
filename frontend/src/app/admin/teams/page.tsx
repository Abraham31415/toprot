import { Kpi, KpiGrid, Notice, PageTitle, Section } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { num } from "@/lib/admin/format";

export const metadata = { title: "Teams" };

export default async function TeamsPage() {
  const s = await requireAdmin();
  const [workspaces, supervised, invitations, team] = await Promise.all([
    s.db.from("workspaces").select("id", { count: "exact", head: true }),
    s.db.from("study_supervisors").select("id", { count: "exact", head: true }),
    s.db.from("supervisor_invitations").select("id", { count: "exact", head: true }),
    s.db.from("plans").select("plan_key", { count: "exact", head: true }).eq("plan_key", "team"),
  ]);
  const hasTeamPlan = (team.count ?? 0) > 0;
  return (
    <>
      <PageTitle title="Teams" lead="Team subscriptions and shared workspaces." />
      <Notice tone="setup" title={hasTeamPlan ? "A Team plan exists" : "Teams are not offered yet"}>
        {hasTeamPlan ? "The plan list contains a Team plan. Team subscriptions are counted on the Subscriptions page." : "There is no Team plan and no shared team workspace, so there are no team subscriptions or team billing to manage. This page will show them once Teams exist. Nothing here is estimated."}
      </Notice>
      <Section title="What exists today" lead="Supervision is the only form of collaboration at the moment: a supervisor has a workspace and is invited to review a researcher's studies.">
        <KpiGrid cols={3}>
          <Kpi label="Supervisor workspaces" value={num(workspaces.count ?? 0)} />
          <Kpi label="Supervised projects" value={num(supervised.count ?? 0)} note="Studies a supervisor has been attached to" />
          <Kpi label="Supervisor invitations" value={num(invitations.count ?? 0)} note="All time" />
        </KpiGrid>
      </Section>
    </>
  );
}

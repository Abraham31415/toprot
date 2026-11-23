import Link from "next/link";
import { Badge, Kpi, KpiGrid, Notice, PageTitle, RangeFilter, Section, Table, inputCls, buttonCls } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { date, money, num } from "@/lib/admin/format";
import { iso, loadReport } from "@/lib/admin/load";
import { parseRange } from "@/lib/admin/range";
import { InvestigateForm, WithdrawForm } from "./forms";

export const metadata = { title: "Teams and collaboration" };

type Overview = {
  projects: { shared: number; team_projects: number; members_by_role: Record<string, number>; dormant_memberships: number };
  invitations: { sent: number; accepted: number; declined: number; revoked: number; pending: number; expired_unanswered: number; delivery: Record<string, number> };
  reviews: { submissions: number; approvals: number; awaiting_review: number; changes_requested: number; open_threads: number };
  messages: { sent: number };
  notifications: { created: number; email_by_status: Record<string, number> };
  email_quota: { day_used: number; day_limit: number; month_used: number; month_limit: number; blocked: boolean; realtime_joins_today: number };
  teams: { total: number; active_plans: number; members: number; guests: number; pools_enabled: number };
};
type TeamsPage = { total: number; rows: { id: string; name: string; created_at: string; owner: string | null; owner_email: string; state: string; paid_seats: number; seats_used: number; guests: number; projects: number; pool_enabled: boolean; pool_balance: number }[] };
type Failed = { kind: string; id: string; email: string; role: string; delivery: string; error: string | null; at: string; sends: number }[];
type Fin = { billing_enabled: boolean; prices: { base: number | null; seat: number | null; base_seats: number }; active_subscriptions: number; past_due: number; cancelling: number; paid_seats: number; mrr_estimate_usd: number | null; payments: Record<string, { count: number; usd: number }>; refunds_usd: number; failed_payments: number;
  pool: { credits_added: number; credits_used: number; outstanding_balance: number; held: number }; team_funded_ai: { requests: number; provider_cost_usd: number; overrun_credits: number } };

const STATE_TONE = { active: "success", lapsed: "warning", unsubscribed: "neutral" } as const;

export default async function TeamsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const range = parseRange(sp);
  const q = (sp.q ?? "").slice(0, 100);
  const args = { p_from: iso(range.from), p_to: iso(range.to) };
  const [ov, teams, failed, fin] = await Promise.all([
    loadReport<Overview>(s, "admin_collab_overview", args),
    loadReport<TeamsPage>(s, "admin_teams_page", { p_search: q || null, p_limit: 50, p_offset: 0 }),
    loadReport<Failed>(s, "admin_failed_invitations", { p_limit: 50 }),
    loadReport<Fin>(s, "admin_team_financials", args),
  ]);
  const o = ov.data;
  return (
    <>
      <PageTitle title="Teams and collaboration" lead="Numbers about sharing, supervision, teams and team money. Nothing here shows a project's content: no titles, text, comments, messages or file names." />
      <RangeFilter range={range} base="/admin/teams" keep={{ q: q || undefined }} />
      {(ov.error || teams.error) && <Notice tone="danger">{ov.error ?? teams.error}</Notice>}
      {o && (
        <>
          <Section title="Sharing and supervision">
            <KpiGrid>
              <Kpi label="Shared projects" value={num(o.projects.shared)} note={`${num(o.projects.team_projects)} belong to a team`} />
              <Kpi label="Invitations sent" value={num(o.invitations.sent)} note={`${num(o.invitations.accepted)} accepted, ${num(o.invitations.declined)} declined, ${num(o.invitations.revoked)} withdrawn`} />
              <Kpi label="Waiting for an answer" value={num(o.invitations.pending)} note={`${num(o.invitations.expired_unanswered)} expired unanswered`} />
              <Kpi label="Paused roles" value={num(o.projects.dormant_memberships)} note="Paused because the owner's plan no longer includes the role" />
              <Kpi label="Review submissions" value={num(o.reviews.submissions)} note={`${num(o.reviews.approvals)} supervisor approvals`} />
              <Kpi label="Awaiting a supervisor" value={num(o.reviews.awaiting_review)} note={`${num(o.reviews.changes_requested)} with changes requested`} />
              <Kpi label="Open comment threads" value={num(o.reviews.open_threads)} />
              <Kpi label="Messages sent" value={num(o.messages.sent)} />
            </KpiGrid>
            <p className="type-caption mt-2">Members by role: {Object.entries(o.projects.members_by_role).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.</p>
          </Section>

          <Section title="Email and realtime" lead="Email counts come from what the provider accepted, not from what was attempted.">
            <KpiGrid cols={3}>
              <Kpi label="Emails today" value={`${num(o.email_quota.day_used)} of ${num(o.email_quota.day_limit)}`} note={o.email_quota.blocked ? "Sending is paused at the quota" : "Daily Resend limit"} />
              <Kpi label="Emails this month" value={`${num(o.email_quota.month_used)} of ${num(o.email_quota.month_limit)}`} />
              <Kpi label="Realtime joins today" value={num(o.email_quota.realtime_joins_today)} note="Reported by browsers. The Supabase dashboard has the real connection count." />
            </KpiGrid>
            <p className="type-caption mt-2">Notification emails in range: {Object.entries(o.notifications.email_by_status).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ") || "none"}. Invitation delivery: {Object.entries(o.invitations.delivery).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ") || "none"}.</p>
          </Section>

          <Section title="Teams">
            <KpiGrid cols={5}>
              <Kpi label="Teams" value={num(o.teams.total)} />
              <Kpi label="With an active plan" value={num(o.teams.active_plans)} />
              <Kpi label="Paid seats in use" value={num(o.teams.members)} />
              <Kpi label="Guest seats in use" value={num(o.teams.guests)} />
              <Kpi label="Shared AI pools on" value={num(o.teams.pools_enabled)} />
            </KpiGrid>
          </Section>
        </>
      )}

      <Section title="Team money" lead="Recorded payments come from the billing records. Monthly recurring revenue is an estimate from today's stored prices and the seats currently subscribed.">
        {fin.error && <Notice tone="danger">{fin.error}</Notice>}
        {fin.data && (
          <>
            {!fin.data.billing_enabled && <Notice tone="setup" title="Teams billing is switched off">The Teams plan is not offered yet (setting teams_billing_enabled is 0). Turn it on with SQL only after the Dodo products are mapped and a test payment is verified. See docs/COLLABORATION.md.</Notice>}
            <KpiGrid>
              <Kpi label="Active team subscriptions" value={num(fin.data.active_subscriptions)} note={`${num(fin.data.past_due)} past due, ${num(fin.data.cancelling)} ending`} />
              <Kpi label="Paid seats subscribed" value={num(fin.data.paid_seats)} />
              <Kpi label="Monthly recurring revenue" value={fin.data.mrr_estimate_usd === null ? "Not available" : money(fin.data.mrr_estimate_usd)} estimate note={fin.data.prices.base === null ? "No price set" : `${money(fin.data.prices.base)} for ${fin.data.prices.base_seats} seats, ${money(fin.data.prices.seat ?? 0)} per extra seat`} />
              <Kpi label="Refunds in range" value={money(fin.data.refunds_usd)} note={`${num(fin.data.failed_payments)} failed payments`} />
              <Kpi label="Pool credits added" value={num(fin.data.pool.credits_added)} />
              <Kpi label="Pool credits used" value={num(fin.data.pool.credits_used)} />
              <Kpi label="Pool balance now" value={num(fin.data.pool.outstanding_balance)} note={`${num(fin.data.pool.held)} held for requests in flight`} />
              <Kpi label="Team-funded AI requests" value={num(fin.data.team_funded_ai.requests)} note={`Provider cost ${money(fin.data.team_funded_ai.provider_cost_usd)}`} />
            </KpiGrid>
            <div className="mt-3"><Table caption="Team payments in range" head={["Kind", "Payments", "Amount (USD)"]} numeric={[1, 2]} empty="No team payments in this range."
              rows={Object.entries(fin.data.payments).map(([k, v]) => [k.replace("team_", "").replace("_", " "), num(v.count), money(v.usd)])} /></div>
          </>
        )}
      </Section>

      <Section title="Invitation emails that did not go out" lead="Pending invitations whose email was not accepted by the provider (failed, or email not set up). The owner has the link and can share it by hand. Withdraw one only for abuse.">
        {failed.error ? <Notice tone="danger">{failed.error}</Notice> : (
          <Table caption="Invitations with delivery problems" head={["Kind", "Recipient", "Role", "Problem", "Sent", "Resends", "Action"]} empty="No undelivered invitations."
            rows={(failed.data ?? []).map((f) => [f.kind, f.email, f.role, <Badge key="b" tone={f.delivery === "failed" ? "danger" : "warning"}>{f.delivery === "failed" ? "Failed" : "Email not set up"}</Badge>, date(f.at), String(f.sends - 1), <WithdrawForm key="w" kind={f.kind} id={f.id} />])} />
        )}
      </Section>

      <Section title="Find a person" lead="Where does this account have access, and how? Shows roles and short project references only. The lookup is written to the audit log with your reason.">
        <InvestigateForm />
      </Section>

      <Section title="All teams">
        <form className="mb-3 flex gap-2" role="search"><input name="q" defaultValue={q} placeholder="Search team name" aria-label="Search team name" className={`${inputCls} max-w-xs`} /><button className={buttonCls}>Search</button></form>
        {teams.data && (
          <Table caption="Teams" head={["Team", "Owner", "Plan", "Seats", "Guests", "Projects", "AI pool", "Created"]} numeric={[3, 4, 5]} empty="No teams yet."
            rows={teams.data.rows.map((t) => [<Link key="l" href={`/admin/teams/${t.id}`} className="font-medium text-primary hover:underline">{t.name}</Link>, `${t.owner ?? "Unknown"} (${t.owner_email})`,
              <Badge key="b" tone={STATE_TONE[t.state as keyof typeof STATE_TONE] ?? "neutral"}>{t.state}</Badge>, `${t.seats_used} of ${t.paid_seats}`, num(t.guests), num(t.projects), t.pool_enabled ? `${num(t.pool_balance)} credits` : "Off", date(t.created_at)])} />
        )}
      </Section>
    </>
  );
}

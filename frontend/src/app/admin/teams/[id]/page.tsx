import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Kpi, KpiGrid, Notice, PageTitle, Section, Table } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dateTime, date, money, num } from "@/lib/admin/format";
import { loadReport } from "@/lib/admin/load";
import { TeamCreditForm, TeamPoolForm } from "../forms";

export const metadata = { title: "Team" };

type Detail = {
  team: { id: string; name: string };
  entitlements: { state: string; max_paid_seats: number; max_guests: number; max_projects: number; max_storage_mb: number; period_end: string | null; cancel_at_period_end: boolean; grace_until: string | null };
  subscription: { status: string; paid_seats: number; next_paid_seats: number | null; current_period_end: string; provider: string | null } | null;
  members: { name: string; email: string; role: string; seat: string; joined: string; projects_owned: number }[];
  projects: { ref: string; status: string; people: number; submissions: number; last_activity: string }[];
  payments: { kind: string; amount: number; currency: string; status: string; at: string }[];
  pool: { enabled: boolean; balance: number; reserved: number; team_limit: number | null; member_limit: number | null } | null;
  pool_ledger: { kind: string; credits: number; note: string | null; at: string }[];
  open_reservations: number;
  documents: { count: number; bytes: number };
  activity: { action: string; at: string }[];
};

export default async function AdminTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // Opening a team is written to the audit log by the database function.
  const r = await loadReport<Detail>(s, "admin_team_detail", { p_team: id, p_reason: "Opened the team page in the admin console", p_ip: null });
  if (!r.data) return <><PageTitle title="Team" />{<Notice tone="danger">{r.error ?? "Team not found."}</Notice>}</>;
  const d = r.data;
  const readOnly = s.role === "viewer";
  return (
    <>
      <PageTitle title={d.team.name} lead="Accounts, plan, money and credits. Project content is never shown. Opening this page was recorded in the audit log." actions={<Link href="/admin/teams" className="text-sm text-primary hover:underline">All teams</Link>} />
      <KpiGrid>
        <Kpi label="Plan state" value={d.entitlements.state} note={d.entitlements.period_end ? `Paid until ${date(d.entitlements.period_end)}${d.entitlements.cancel_at_period_end ? ", not renewing" : ""}` : "No subscription"} />
        <Kpi label="Paid seats" value={`${d.members.filter((m) => m.seat === "paid").length} of ${d.entitlements.max_paid_seats}`} note={d.subscription?.next_paid_seats ? `${d.subscription.next_paid_seats} from the next renewal` : undefined} />
        <Kpi label="Guest seats" value={`${d.members.filter((m) => m.seat === "guest").length} of ${d.entitlements.max_guests}`} />
        <Kpi label="Documents" value={num(d.documents.count)} note={`${(d.documents.bytes / 1048576).toFixed(1)} MB of ${num(d.entitlements.max_storage_mb)} MB`} />
      </KpiGrid>
      {d.entitlements.grace_until && <Notice tone="warning" title="Payment grace period">The last renewal failed. Entitlements continue until {dateTime(d.entitlements.grace_until)}.</Notice>}

      <Section title="People"><Table caption="Team members" head={["Name", "Email", "Role", "Seat", "Joined", "Projects owned"]} numeric={[5]} rows={d.members.map((m) => [m.name || "Unnamed", m.email, m.role, m.seat, date(m.joined), num(m.projects_owned)])} /></Section>
      <Section title="Projects" lead="Short references only. A team member's access to each one is set by that project's owner."><Table caption="Team projects" head={["Reference", "Status", "People", "Review submissions", "Last activity"]} numeric={[2, 3]} empty="No team projects." rows={d.projects.map((p) => [p.ref, p.status, num(p.people), num(p.submissions), date(p.last_activity)])} /></Section>
      <Section title="Payments"><Table caption="Team payments" head={["Kind", "Amount", "Status", "Date"]} empty="No payments." rows={d.payments.map((p) => [p.kind.replace("team_", "").replace("_", " "), money(p.amount, p.currency), <Badge key="b" tone={p.status === "succeeded" ? "success" : p.status === "refunded" ? "warning" : "neutral"}>{p.status}</Badge>, date(p.at)])} /></Section>

      <Section title="Shared AI credits" lead={d.pool ? `Balance ${num(d.pool.balance)} credits, ${num(d.pool.reserved)} held for requests in flight (${num(d.open_reservations)} open). Pool is ${d.pool.enabled ? "on" : "off"}.` : "This team has no pool yet."}>
        <Table caption="Pool ledger" head={["Entry", "Credits", "Note", "Date"]} numeric={[1]} empty="No pool entries." rows={d.pool_ledger.map((l) => [l.kind.replace("_", " "), num(l.credits), l.note ?? "", date(l.at)])} />
        {!readOnly && (
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div><h3 className="mb-2 text-sm font-semibold">Add credits</h3><TeamCreditForm teamId={id} disabled={false} /></div>
            {d.pool && <div><h3 className="mb-2 text-sm font-semibold">Switch the pool {d.pool.enabled ? "off" : "on"}</h3><TeamPoolForm teamId={id} enabled={d.pool.enabled} disabled={false} /></div>}
          </div>
        )}
        {readOnly && <p className="type-caption mt-2">Your administrator role is read-only.</p>}
      </Section>
      <Section title="Recent team activity"><Table caption="Team activity" head={["Action", "When"]} empty="Nothing recorded." rows={d.activity.map((a) => [a.action.replace(/_/g, " "), dateTime(a.at)])} /></Section>
    </>
  );
}

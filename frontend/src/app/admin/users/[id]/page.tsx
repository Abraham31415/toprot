import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Kpi, KpiGrid, Notice, PageTitle, Section, Table } from "@/components/admin/ui";
import { GrantForm, RevokeForm, SuspensionForm } from "@/components/admin/user-actions";
import { requireAdmin, requestIp } from "@/lib/admin/auth";
import { date, dateTime, dec, money, num } from "@/lib/admin/format";
import { loadReport } from "@/lib/admin/load";
import { adminTimeZone } from "@/lib/admin/range";

export const metadata = { title: "User" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Detail = {
  account: { id: string; email: string; name: string | null; role: string | null; institution: string | null; registered_at: string; last_sign_in_at: string | null; is_admin: boolean };
  suspension: { reason: string; suspended_at: string } | null;
  plan: string;
  subscription: { plan: string; status: string; current_period_start: string | null; current_period_end: string | null; provider: string | null; provider_subscription_id: string | null; cancel_at_period_end: boolean } | null;
  payments: { id: string; created_at: string; provider: string; kind: string; product_key: string; amount: number; currency: string; status: string; method: string | null; failure_reason: string | null }[];
  headroom: { plan_key: string; allowance_mcr: number; used_mcr: number; reserved_mcr: number; subscription_available_mcr: number; purchased_available_mcr: number; available_mcr: number; period_end: string | null };
  lots: { id: string; source: string; credits: number; used: number; reserved: number; granted_at: string; expires_at: string; expired_at: string | null; note: string | null }[];
  transactions: { id: number; created_at: string; kind: string; pool: string; credits: number; note: string | null; feature_key: string | null; model_id: string | null }[];
  ai: { requests: number; cost_usd: number; recent: { created_at: string; feature_key: string; model_id: string; status: string; credits: number; cost_usd: number; error_code: string | null }[] };
  counts: Record<string, number>;
  recent_activity: { at: string; kind: string }[];
  audit: { created_at: string; actor_email: string | null; action: string; reason: string | null }[];
};

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const tz = adminTimeZone();
  const r = await loadReport<Detail | null>(s, "admin_user_detail", { p_user: id, p_ip: await requestIp() });
  if (r.error) return <><PageTitle title="User" /><Notice tone="danger">{r.error}</Notice></>;
  if (!r.data) notFound();
  const d = r.data;
  const readOnly = s.role === "viewer";
  const maxGrant = 500;

  return (
    <>
      <p className="type-support"><Link href="/admin/users" className="text-primary hover:underline">Users</Link> / {d.account.email}</p>
      <PageTitle title={d.account.name || d.account.email} lead={<>{d.account.email} · registered {date(d.account.registered_at, tz)}{d.account.institution ? ` · ${d.account.institution}` : ""}</>}
        actions={<span className="flex gap-2">{d.suspension ? <Badge tone="danger">Suspended</Badge> : <Badge tone="success">Active</Badge>}{d.account.is_admin && <Badge tone="info">Administrator</Badge>}<Badge tone="neutral">{d.plan}</Badge></span>} />
      <Notice tone="info">Opening this page was recorded in the audit log. It shows counts and dates only, never project titles or research content.</Notice>
      {d.suspension && <Notice tone="danger" title="This account is suspended">{d.suspension.reason} (since {dateTime(d.suspension.suspended_at, tz)})</Notice>}

      <Section title="Account">
        <KpiGrid>
          <Kpi label="Role" value={d.account.role ?? "Not chosen yet"} />
          <Kpi label="Last sign-in" value={d.account.last_sign_in_at ? dateTime(d.account.last_sign_in_at, tz) : "-"} />
          <Kpi label="Projects" value={num(d.counts.projects)} note={`${num(d.counts.supervised_projects)} supervised`} />
          <Kpi label="Saved calculations" value={num(d.counts.saved_calculations)} note={`${num(d.counts.references)} references, ${num(d.counts.manuscripts)} manuscripts, ${num(d.counts.pdfs)} PDFs`} />
        </KpiGrid>
      </Section>

      <Section title="Subscription" lead="From the billing records. Access ends at the end of the paid period even when cancellation was requested.">
        {d.subscription ? (
          <Table caption="Subscription" head={["Plan", "Status", "Period", "Cancellation", "Provider", "Subscription id"]} rows={[[
            d.subscription.plan, d.subscription.status, `${date(d.subscription.current_period_start, tz)} to ${date(d.subscription.current_period_end, tz)}`,
            d.subscription.cancel_at_period_end ? "Requested: ends at period end" : "Not requested", d.subscription.provider ?? "-", <code key="c" className="text-xs">{d.subscription.provider_subscription_id ?? "-"}</code>]]} />
        ) : <p className="type-support">No paid subscription has ever been recorded.</p>}
      </Section>

      <Section title="Payments" lead="Only a payment confirmed by the provider counts as verified. These records cannot be edited here.">
        <Table caption="Payments" numeric={[3]} head={["When", "Item", "Provider", "Amount", "Status", "Detail"]} empty="No payments."
          rows={d.payments.map((p) => [dateTime(p.created_at, tz), `${p.kind}: ${p.product_key}`, p.provider, money(p.amount, p.currency), <Badge key="s" tone={p.status === "succeeded" ? "success" : p.status === "failed" ? "danger" : p.status === "refunded" ? "warning" : "neutral"}>{p.status}</Badge>, p.failure_reason ?? p.method ?? "-"])} />
      </Section>

      <Section title="AI credits" lead="Subscription credits are used first, then purchased or promotional credits, which are kept separately.">
        <KpiGrid cols={4}>
          <Kpi label="Available now" value={dec(d.headroom.available_mcr / 1000, 1)} />
          <Kpi label="Subscription credits" value={dec(d.headroom.subscription_available_mcr / 1000, 1)} note={`${dec(d.headroom.used_mcr / 1000, 1)} of ${dec(d.headroom.allowance_mcr / 1000, 1)} used this period`} />
          <Kpi label="Purchased and promotional" value={dec(d.headroom.purchased_available_mcr / 1000, 1)} />
          <Kpi label="Reserved by running requests" value={dec(d.headroom.reserved_mcr / 1000, 1)} />
        </KpiGrid>
        <div className="mt-3"><Table caption="Credit lots" numeric={[2, 3, 4]} head={["Source", "Granted", "Credits", "Used", "Reserved", "Expires", "Note", ""]} empty="No purchased or promotional credits."
          rows={d.lots.map((l) => [l.source, date(l.granted_at, tz), dec(l.credits, 1), dec(l.used, 1), dec(l.reserved, 1), l.expired_at ? `Ended ${date(l.expired_at, tz)}` : date(l.expires_at, tz), l.note ?? "-",
            l.source === "grant" && !l.expired_at && !readOnly ? <RevokeForm key="r" userId={id} lotId={l.id} /> : ""])} /></div>
        <p className="mt-3"><Link href={`/admin/credits/${id}`} className="text-sm font-medium text-primary hover:underline">Full credit ledger for this user</Link></p>
        <div className="mt-3"><Table caption="Recent credit transactions" numeric={[3]} head={["When", "Type", "Pool", "Credits", "Operation", "Model"]} empty="No transactions."
          rows={d.transactions.slice(0, 15).map((t) => [dateTime(t.created_at, tz), t.kind, t.pool, dec(t.credits, 1), t.feature_key ?? t.note ?? "-", t.model_id ?? "-"])} /></div>
      </Section>

      <Section title="AI usage" lead={`${num(d.ai.requests)} requests in total, ${money(d.ai.cost_usd, "USD", 4)} of provider cost.`}>
        <Table caption="Recent AI requests" numeric={[3, 4]} head={["When", "Feature", "Model", "Credits", "Cost", "Status"]} empty="No AI requests."
          rows={d.ai.recent.slice(0, 15).map((e) => [dateTime(e.created_at, tz), e.feature_key, e.model_id, dec(e.credits, 2), money(e.cost_usd, "USD", 4), <Badge key="s" tone={e.status === "committed" ? "success" : e.status === "reserved" ? "info" : "danger"}>{e.error_code ? `${e.status}: ${e.error_code}` : e.status}</Badge>])} />
      </Section>

      <Section title="Recent activity" lead="The kind and time of recent actions, not their content.">
        <Table caption="Recent activity" head={["When", "What"]} empty="No recorded activity." rows={d.recent_activity.map((a) => [dateTime(a.at, tz), a.kind])} />
      </Section>

      <Section title="Administrative changes to this account">
        <Table caption="Audit entries" head={["When", "By", "Action", "Reason"]} empty="No administrative changes." rows={d.audit.map((a) => [dateTime(a.created_at, tz), a.actor_email ?? "-", a.action, a.reason ?? "-"])} />
      </Section>

      {readOnly ? <Notice tone="setup">Your administrator role is read-only, so account changes are not available.</Notice> : (
        <>
          <Section title="Suspend or restore access" lead="A suspended account is signed out and cannot use the site. Nothing is deleted.">
            <div className="max-w-xl"><SuspensionForm userId={id} suspended={!!d.suspension} disabled={d.account.is_admin} /></div>
          </Section>
          <Section title="Promotional credits" lead={`Adds a separate, expiring balance. It never changes a payment or the plan allowance. Limits: ${maxGrant} credits per grant and a daily cap per administrator.`}>
            <div className="max-w-xl"><GrantForm userId={id} maxCredits={maxGrant} /></div>
          </Section>
        </>
      )}
    </>
  );
}

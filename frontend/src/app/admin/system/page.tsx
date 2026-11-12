import { Badge, Kpi, KpiGrid, Notice, PageTitle, Section, Table } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { recentDeployments } from "@/lib/admin/deployments";
import { dateTime, num, NA } from "@/lib/admin/format";
import { loadReport, timed } from "@/lib/admin/load";
import { adminTimeZone } from "@/lib/admin/range";
import { acknowledgeAlert } from "./actions";

export const metadata = { title: "System Health" };

type System = {
  alerts: { id: number; created_at: string; kind: string; severity: string; message: string; acknowledged_at: string | null }[];
  jobs: { job: string; started_at: string; finished_at: string | null; ok: boolean | null; summary: Record<string, unknown>; error: string | null }[];
  errors: { day: string; route: string | null; name: string | null; message: string | null; occurrences: number; last_seen: string }[];
  payments: { pending_over_1h: number; failed_24h: number; webhook_events_24h: { outcome: string; events: number }[]; subscription_events_24h: number };
  ai: { failed_24h: number; stuck_reservations: number };
  storage: { pdf_bytes: number; pdf_files: number; budget_bytes: number | null };
  events: { events_total: number; oldest: string | null };
  audit: { intact: boolean; first_bad_id: number | null; checked: number };
};
const mb = (b: number) => `${(b / 1_048_576).toFixed(1)} MB`;
const SEV = { info: "info", warning: "warning", critical: "danger" } as const;

export default async function SystemPage() {
  const s = await requireAdmin();
  const tz = adminTimeZone();
  const { value: probe, ms: dbMs } = await timed(() => s.db.from("app_admins").select("user_id", { head: true, count: "exact" }));
  const [r, dep] = await Promise.all([loadReport<System>(s, "admin_system"), recentDeployments()]);

  return (
    <>
      <PageTitle title="System Health" lead="What the connected services expose: payment events, AI failures, stored files, scheduled jobs and recorded application errors. Nothing here is invented; where a service gives no figure, it says so." />
      <KpiGrid cols={3}>
        <Kpi label="Database" value={probe.error ? "Not reachable" : `Reachable, ${dbMs} ms`} note="One small query just now" />
        <Kpi label="Open alerts" value={r.data ? num(r.data.alerts.filter((a) => !a.acknowledged_at).length) : NA} />
        <Kpi label="Audit log" value={r.data ? (r.data.audit.intact ? "Intact" : "Tampering detected") : NA} note={r.data ? `${num(r.data.audit.checked)} entries checked` : undefined} />
      </KpiGrid>
      {r.error && <Notice tone="danger">{r.error}</Notice>}
      {r.data && (() => {
        const d = r.data;
        return (
          <>
            {!d.audit.intact && <Notice tone="danger" title="The audit log failed its integrity check">Entry {d.audit.first_bad_id} does not match the chain. Treat the log as untrustworthy and investigate.</Notice>}
            <Section title="Alerts" lead="Raised automatically by the daily job and when the dashboard opens. A repeated finding does not create a second alert.">
              <Table caption="Alerts" head={["When", "Severity", "Alert", ""]} empty="No alerts."
                rows={d.alerts.map((a) => [dateTime(a.created_at, tz), <Badge key="s" tone={SEV[a.severity as keyof typeof SEV] ?? "neutral"}>{a.severity}</Badge>, a.message,
                  a.acknowledged_at ? <span key="k" className="type-caption">Acknowledged {dateTime(a.acknowledged_at, tz)}</span> : s.role === "viewer" ? "" : <form key="f" action={acknowledgeAlert}><input type="hidden" name="alert" value={a.id} /><button className="rounded-control border border-line-strong bg-surface px-2 py-1 text-xs font-medium hover:border-primary">Acknowledge</button></form>])} />
            </Section>
            <Section title="Payments">
              <KpiGrid cols={3}>
                <Kpi label="Failed payments, last 24 hours" value={num(d.payments.failed_24h)} />
                <Kpi label="Checkouts open for over an hour" value={num(d.payments.pending_over_1h)} note="Started in the last 2 days, not yet confirmed" />
                <Kpi label="Subscription events, last 24 hours" value={num(d.payments.subscription_events_24h)} />
              </KpiGrid>
              <div className="mt-3"><Table caption="Provider events in the last 24 hours" numeric={[1]} head={["Outcome", "Events"]} empty="No provider events in the last 24 hours." rows={d.payments.webhook_events_24h.map((e) => [e.outcome, num(e.events)])} /></div>
              <p className="type-caption mt-2">An event that stays at &quot;received&quot; was accepted but never finished; the daily job re-checks these.</p>
            </Section>
            <Section title="AI operations">
              <KpiGrid cols={3}><Kpi label="Failed AI requests, last 24 hours" value={num(d.ai.failed_24h)} /><Kpi label="Reservations stuck past their lease" value={num(d.ai.stuck_reservations)} note="Released automatically on the next request" /></KpiGrid>
            </Section>
            <Section title="Storage">
              <KpiGrid cols={3}>
                <Kpi label="Uploaded PDFs" value={`${num(d.storage.pdf_files)} files`} note={mb(d.storage.pdf_bytes)} />
                <Kpi label="Storage budget" value={d.storage.budget_bytes ? mb(d.storage.budget_bytes) : NA} note={d.storage.budget_bytes ? `${((100 * d.storage.pdf_bytes) / d.storage.budget_bytes).toFixed(0)}% used by PDFs` : "Enter your plan's storage limit in Settings to get an alert"} />
                <Kpi label="Page-tracking events stored" value={num(d.events.events_total)} note={d.events.oldest ? `Oldest ${dateTime(d.events.oldest, tz)}` : "None yet"} />
              </KpiGrid>
              <p className="type-caption mt-2">Only PDF storage is measured. Database size, figure uploads and bandwidth are not exposed to the application; check the Supabase and Vercel dashboards.</p>
            </Section>
            <Section title="Scheduled jobs" lead="Recorded from the day this version went live.">
              <Table caption="Job runs" head={["Job", "Started", "Finished", "Result", "Summary"]} empty="No job run has been recorded yet. The daily maintenance job records itself each time it runs."
                rows={d.jobs.map((j) => [j.job, dateTime(j.started_at, tz), j.finished_at ? dateTime(j.finished_at, tz) : "-", j.ok === null ? <Badge key="r" tone="warning">Running or interrupted</Badge> : j.ok ? <Badge key="r" tone="success">OK</Badge> : <Badge key="r" tone="danger">Failed</Badge>, j.error ?? JSON.stringify(j.summary)])} />
            </Section>
            <Section title="Recent application errors" lead="Unhandled server errors, grouped by route, type and message. No request contents are stored.">
              <Table caption="Application errors" numeric={[3]} head={["Route", "Type", "Message", "Occurrences", "Last seen"]} empty="No errors recorded." rows={d.errors.map((e) => [e.route ?? "-", e.name ?? "-", e.message ?? "-", num(e.occurrences), dateTime(e.last_seen, tz)])} />
            </Section>
          </>
        );
      })()}
      <Section title="Recent deployments">
        {dep.status === "ok" ? (
          <Table caption="Deployments" head={["When", "State", "Target", "Commit", "Message"]} empty="No deployments." rows={dep.items.map((x) => [dateTime(new Date(x.created).toISOString(), tz), <Badge key="s" tone={x.state === "READY" ? "success" : x.state === "ERROR" ? "danger" : "neutral"}>{x.state}</Badge>, x.target ?? "preview", x.commit ?? "-", x.message ?? "-"])} />
        ) : dep.status === "not_configured" ? (
          <Notice tone="setup" title="Not set up">Set <code>VERCEL_API_TOKEN</code> and <code>VERCEL_PROJECT_ID</code> (and <code>VERCEL_TEAM_ID</code> for a team project) on the server to list recent deployments here.</Notice>
        ) : <Notice tone="warning">{dep.message}</Notice>}
      </Section>
    </>
  );
}

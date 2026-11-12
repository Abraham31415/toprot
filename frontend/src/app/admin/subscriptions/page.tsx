import Link from "next/link";
import { Download } from "lucide-react";
import { Badge, Kpi, KpiGrid, Notice, PageTitle, Pager, RangeFilter, Section, Table, inputCls } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { date, money, num, pct } from "@/lib/admin/format";
import { iso, loadReport } from "@/lib/admin/load";
import { parseRange } from "@/lib/admin/range";

export const metadata = { title: "Subscriptions" };
const PAGE = 25;
const STATES = [["all", "All"], ["active", "Active"], ["ending", "Cancellation requested"], ["past_due", "Past due"], ["expired", "Expired"]] as const;
const STATE_TONE = { active: "success", ending: "warning", past_due: "danger", expired: "neutral" } as const;
const STATE_LABEL = { active: "Active", ending: "Ends at period end", past_due: "Past due", expired: "Expired" } as const;

type Row = { user_id: string; email: string; plan: string; status: string; state: keyof typeof STATE_TONE; cancel_at_period_end: boolean; current_period_start: string | null; current_period_end: string | null; provider: string | null; provider_subscription_id: string | null; price_usd: number | null; currency: string; period: string; started_at: string | null };
type Data = { total: number; rows: Row[]; summary: { users_total: number; active_paid: number; active_by_plan: Record<string, number>; scheduled_to_end: number; expired: number; past_due: number; new_in_range: number; renewals_in_range: number; failed_payments_in_range: number; registered_in_range: number; registered_in_range_now_paid: number } };

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const range = parseRange(sp);
  const state = STATES.some(([k]) => k === sp.state) ? sp.state! : "all";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const q = (sp.q ?? "").slice(0, 100);
  const r = await loadReport<Data>(s, "admin_subscriptions", { p_from: iso(range.from), p_to: iso(range.to), p_filter: state, p_search: q || null, p_limit: PAGE, p_offset: (page - 1) * PAGE });
  const keep = { state: state === "all" ? undefined : state, q: q || undefined };
  const href = (p: number) => `/admin/subscriptions?${new URLSearchParams({ ...(range.key !== "30d" ? { range: range.key } : {}), ...(range.key === "custom" ? { from: range.fromDay, to: range.toDay } : {}), ...(state !== "all" ? { state } : {}), ...(q ? { q } : {}), page: String(p) }).toString()}`;

  return (
    <>
      <PageTitle title="Subscriptions" lead="Paid subscriptions from the billing records, which are the source of truth. A cancellation request is shown separately from access that has actually ended."
        actions={<Link href={`/admin/export/subscriptions?state=${state}`} className="inline-flex h-9 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium hover:border-primary"><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Link>} />
      <RangeFilter range={range} base="/admin/subscriptions" keep={keep} />
      {r.error && <Notice tone="danger">{r.error}</Notice>}
      {r.data && (() => {
        const m = r.data.summary;
        const free = m.users_total - m.active_paid;
        return (
          <>
            <Section title="Right now">
              <KpiGrid>
                <Kpi label="Active free accounts" value={num(free)} note="Registered accounts without an active paid period" />
                <Kpi label="Active Pro subscriptions" value={num(m.active_by_plan.pro ?? 0)} />
                <Kpi label="Active Team subscriptions" value={m.active_by_plan.team !== undefined ? num(m.active_by_plan.team) : "Not offered"} note={m.active_by_plan.team !== undefined ? undefined : "There is no Team plan"} />
                <Kpi label="Scheduled to end" value={num(m.scheduled_to_end)} note="Cancellation requested, access continues to period end" />
                <Kpi label="Expired" value={num(m.expired)} note="Paid access has ended" />
                <Kpi label="Past due" value={num(m.past_due)} />
              </KpiGrid>
            </Section>
            <Section title="In the selected period" lead={`${range.label} (${range.tz}).`}>
              <KpiGrid>
                <Kpi label="New subscriptions" value={num(m.new_in_range)} note="First paid subscription payment" />
                <Kpi label="Renewals" value={num(m.renewals_in_range)} note="Later subscription payments" />
                <Kpi label="Failed payments" value={num(m.failed_payments_in_range)} />
                <Kpi label="Conversion, registered to paid" value={pct(m.registered_in_range_now_paid, m.registered_in_range)} note={`${num(m.registered_in_range_now_paid)} of ${num(m.registered_in_range)} accounts registered in the period have paid`} />
                <Kpi label="Overall paying share" value={pct(m.active_paid, m.users_total)} note="Active paid accounts of all registered" />
              </KpiGrid>
            </Section>
            <Section title="Paid subscriptions" lead="The price shown is the current configured price for the plan. It is not read from a hard-coded value.">
              <form action="/admin/subscriptions" method="get" role="search" className="mb-3 flex flex-wrap gap-2">
                {state !== "all" && <input type="hidden" name="state" value={state} />}
                <label htmlFor="sub-q" className="sr-only">Search by email</label><input id="sub-q" name="q" defaultValue={q} placeholder="Search by email" className={`${inputCls} max-w-xs`} />
                <button className="h-9 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium hover:border-primary">Search</button>
              </form>
              <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter by state">
                {STATES.map(([k, label]) => <Link key={k} href={`/admin/subscriptions?${new URLSearchParams({ ...(k !== "all" ? { state: k } : {}), ...(q ? { q } : {}) }).toString()}`} aria-current={state === k ? "true" : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium ${state === k ? "border-primary bg-primary text-white" : "border-line-strong bg-surface text-ink hover:border-primary"}`}>{label}</Link>)}
              </div>
              <Table caption="Paid subscriptions" numeric={[2]} empty="No subscriptions match."
                head={["User", "Plan", "Amount", "Status", "Billing period", "Started", "Next renewal", "Provider", "Subscription id"]}
                rows={r.data.rows.map((x) => [
                  <Link key="u" href={`/admin/users/${x.user_id}`} className="text-primary hover:underline">{x.email}</Link>, x.plan,
                  x.price_usd === null ? "Not available" : `${money(x.price_usd, x.currency)} / ${x.period}`,
                  <Badge key="s" tone={STATE_TONE[x.state]}>{STATE_LABEL[x.state]}</Badge>,
                  `${date(x.current_period_start, range.tz)} to ${date(x.current_period_end, range.tz)}`, date(x.started_at, range.tz),
                  x.state === "active" ? date(x.current_period_end, range.tz) : x.state === "ending" ? "None (cancelling)" : "-", x.provider ?? "-",
                  <code key="c" className="text-xs">{x.provider_subscription_id ?? "-"}</code>])} />
              <Pager total={r.data.total} page={page} pageSize={PAGE} hrefFor={href} />
            </Section>
            <Notice tone="setup" title="Team subscriptions">Teams are not offered yet and no Team plan exists, so none can be counted. Individual and team plans share one table, so a Team plan added to the plan list will appear here without changes.</Notice>
          </>
        );
      })()}
    </>
  );
}

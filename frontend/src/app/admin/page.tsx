import Link from "next/link";
import { Activity, BookOpen, Brain, CircleDollarSign, FileText, FlaskConical, Library, TrendingUp, UserPlus, Users, WalletCards } from "lucide-react";
import { Kpi, KpiGrid, Notice, PageTitle, RangeFilter, Section, Badge } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dec, money, moneyList, num, NA, dateTime } from "@/lib/admin/format";
import { iso, loadReport } from "@/lib/admin/load";
import { parseRange } from "@/lib/admin/range";

export const metadata = { title: "Dashboard" };

type Money = { currency: string; amount: number | string; kind?: string; payments?: number };
type Overview = {
  tz: string; computed_at: string;
  users: { total: number; new_today: number; new_month: number; new_in_range: number; active_today: number; active_30d: number; active_in_range: number; paying: number; paying_by_plan: Record<string, number>; suspended: number };
  revenue: { gross_all_time: Money[]; gross_month: Money[]; gross_range: Money[]; refunds_range: Money[]; mrr_usd: number; mrr_scheduled_to_end_usd: number; estimated_fees_usd: number; ai_cost_usd: number; infrastructure_monthly_usd: number | null; estimated_contribution_usd: number };
  ai: { requests: number; input_tokens: number; output_tokens: number; cost_month_usd: number; cost_range_usd: number; active_users: number; credits_consumed: number; purchased_balance_credits: number };
  research: { projects_total: number; projects_month: number; projects_range: number; calculations_saved: number; calculator_completions_tracked: number; references_saved: number; documents_generated: number; supervisor_workspaces_in_use: number };
  tracking: { events_since: string | null };
};

const byKind = (rows: Money[], kind: string) => rows.filter((r) => r.kind === kind);

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const range = parseRange(sp);
  // Looks for things that need a person (failed renewals, AI spend, unaudited credit grants, and so on). Repeats do not duplicate.
  await s.db.rpc("admin_scan_alerts").then(() => null, () => null);
  const r = await loadReport<Overview>(s, "admin_overview", { p_from: iso(range.from), p_to: iso(range.to), p_tz: range.tz });
  const alerts = await s.db.from("system_alerts").select("id, created_at, severity, message").is("acknowledged_at", null).order("created_at", { ascending: false }).limit(5);

  return (
    <>
      <PageTitle title="Dashboard" lead="How many people use ToProt, what they pay, what AI costs, and what they do. Figures come from the application's own records." />
      <RangeFilter range={range} base="/admin" />
      {r.error && <Notice tone="danger" title="Could not load the dashboard">{r.error}</Notice>}
      {alerts.data && alerts.data.length > 0 && (
        <Notice tone="warning" title={`${alerts.data.length} open ${alerts.data.length === 1 ? "alert" : "alerts"}`}>
          <ul className="list-disc pl-5">{alerts.data.map((a) => <li key={a.id}>{a.message} <span className="text-ink-muted">({dateTime(a.created_at, range.tz)})</span></li>)}</ul>
          <Link href="/admin/system" className="mt-1 inline-block font-medium text-primary hover:underline">Review alerts</Link>
        </Notice>
      )}
      {r.data && (() => {
        const o = r.data;
        const free = o.users.total - o.users.paying;
        const subRev = byKind(o.revenue.gross_range, "subscription");
        const packRev = byKind(o.revenue.gross_range, "pack");
        return (
          <>
            <Section title="Users" lead={`Registered accounts and who used the product. "Today" and "this month" are in ${o.tz}.`}>
              <KpiGrid>
                <Kpi icon={Users} label="Registered users" value={num(o.users.total)} />
                <Kpi icon={UserPlus} label="New today" value={num(o.users.new_today)} />
                <Kpi icon={UserPlus} label="New this month" value={num(o.users.new_month)} note={`${num(o.users.new_in_range)} in the selected period`} />
                <Kpi icon={Activity} label="Active today" value={num(o.users.active_today)} note="Daily active users" />
                <Kpi icon={Activity} label="Active in the last 30 days" value={num(o.users.active_30d)} note="Monthly active users" />
                <Kpi icon={Users} label="Free accounts" value={num(free)} />
                <Kpi icon={WalletCards} label="Pro subscribers" value={num(o.users.paying_by_plan.pro ?? 0)} note="Active paid period" />
                <Kpi icon={WalletCards} label="Team subscribers" value={o.users.paying_by_plan.team !== undefined ? num(o.users.paying_by_plan.team) : "Not offered"} note={o.users.paying_by_plan.team !== undefined ? undefined : "There is no Team plan yet"} />
              </KpiGrid>
              <p className="type-caption mt-2">Active means the person did something that was recorded (a project, calculation, reference, manuscript, PDF, assistant message, AI request or document). Sign-ins are not recorded historically. {num(o.users.suspended)} suspended.</p>
            </Section>

            <Section title="Financial" lead="Verified payments only: a payment counts once the provider confirmed it. Amounts in different currencies are never added together.">
              <KpiGrid>
                <Kpi icon={CircleDollarSign} label="Total verified revenue" value={moneyList(o.revenue.gross_all_time.map((x) => ({ currency: x.currency, amount: x.amount })))} note="All time, before refunds" />
                <Kpi icon={CircleDollarSign} label="Revenue this month" value={moneyList(o.revenue.gross_month)} />
                <Kpi icon={TrendingUp} label="MRR (USD)" value={money(o.revenue.mrr_usd)} estimate note={`${money(o.revenue.mrr_scheduled_to_end_usd)} is scheduled to end`} />
                <Kpi icon={TrendingUp} label="ARR (USD)" value={money(o.revenue.mrr_usd * 12)} estimate note="MRR times 12" />
                <Kpi icon={WalletCards} label="Subscription revenue" value={moneyList(subRev)} note="Selected period" />
                <Kpi icon={Library} label="Credit top-up revenue" value={moneyList(packRev)} note="Selected period" />
                <Kpi icon={CircleDollarSign} label="Refunds" value={moneyList(o.revenue.refunds_range)} note={`Estimated payment fees ${money(o.revenue.estimated_fees_usd)}`} />
                <Kpi icon={CircleDollarSign} label="Estimated contribution (USD)" value={money(o.revenue.estimated_contribution_usd)} estimate
                  note={o.revenue.infrastructure_monthly_usd === null ? "After refunds, estimated fees and AI cost. Hosting is not included: enter it in Settings." : "After refunds, estimated fees, AI cost and hosting"} />
              </KpiGrid>
              <p className="type-caption mt-2">MRR and ARR are estimates from active subscriptions at the current price. Contribution is not accounting profit. <Link href="/admin/revenue" className="text-primary hover:underline">Revenue details</Link></p>
            </Section>

            <Section title="AI usage" lead={`Requests and cost in the selected period. Cost comes from the recorded token usage and the model price table.`}>
              <KpiGrid>
                <Kpi icon={Brain} label="AI requests" value={num(o.ai.requests)} note={`${num(o.ai.active_users)} people`} />
                <Kpi icon={Brain} label="Input tokens" value={num(o.ai.input_tokens)} />
                <Kpi icon={Brain} label="Output tokens" value={num(o.ai.output_tokens)} />
                <Kpi icon={CircleDollarSign} label="AI spend this month" value={money(o.ai.cost_month_usd, "USD", 2)} note={`${money(o.ai.cost_range_usd, "USD", 2)} in the selected period`} />
                <Kpi icon={Users} label="AI cost per active user" value={o.ai.active_users ? money(o.ai.cost_range_usd / o.ai.active_users, "USD", 3) : NA} note="Selected period" />
                <Kpi icon={Activity} label="Credits consumed" value={dec(o.ai.credits_consumed, 1)} note="Selected period" />
                <Kpi icon={Library} label="Purchased credits outstanding" value={dec(o.ai.purchased_balance_credits, 1)} note="Unspent and not expired" />
              </KpiGrid>
              <p className="type-caption mt-2"><Link href="/admin/ai-usage" className="text-primary hover:underline">AI cost details</Link> · <Link href="/admin/credits" className="text-primary hover:underline">Credits</Link></p>
            </Section>

            <Section title="Research activity" lead="What people do with ToProt.">
              <KpiGrid>
                <Kpi icon={FlaskConical} label="Research projects" value={num(o.research.projects_total)} note={`${num(o.research.projects_month)} this month`} />
                <Kpi icon={FlaskConical} label="Projects created" value={num(o.research.projects_range)} note="Selected period" />
                <Kpi icon={BookOpen} label="Calculations saved" value={num(o.research.calculations_saved)} note="Selected period" />
                <Kpi icon={BookOpen} label="Calculator runs (tracked)" value={o.tracking.events_since ? num(o.research.calculator_completions_tracked) : NA} note={o.tracking.events_since ? `Tracking since ${dateTime(o.tracking.events_since, range.tz)}` : "Tracking has not recorded anything yet"} />
                <Kpi icon={Library} label="References saved" value={num(o.research.references_saved)} note="Selected period" />
                <Kpi icon={FileText} label="Documents generated" value={num(o.research.documents_generated)} note="Selected period" />
                <Kpi icon={Users} label="Supervisor workspaces in use" value={num(o.research.supervisor_workspaces_in_use)} note="Teams are not offered yet" />
              </KpiGrid>
              <p className="type-caption mt-2"><Link href="/admin/research" className="text-primary hover:underline">Research activity</Link> · <Link href="/admin/analytics" className="text-primary hover:underline">Traffic and funnel</Link></p>
            </Section>
            <p className="type-caption mt-8">Computed {dateTime(o.computed_at, range.tz)} ({range.tz}). Period: {range.label}. <Badge tone="info">Recorded</Badge> figures are counts of records; <Badge tone="warning">Estimate</Badge> figures are worked out from settings or prices.</p>
          </>
        );
      })()}
    </>
  );
}

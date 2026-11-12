import Link from "next/link";
import { Badge, Bars, Kpi, KpiGrid, LineChart, Notice, PageTitle, Pager, RangeFilter, Section, Table } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dateTime, money, moneyList, num, NA } from "@/lib/admin/format";
import { iso, loadReport } from "@/lib/admin/load";
import { parseRange } from "@/lib/admin/range";

export const metadata = { title: "Revenue" };
const PAGE = 15;
type Money = { currency: string; amount: number | string };
type Revenue = {
  by_currency: { currency: string; subscription: number | null; credit_topups: number | null; gross: number; payments: number }[];
  refunds: (Money & { payments: number })[]; pending: { payments: number; amount_usd: number };
  usd: { gross: number; refunds: number; estimated_fees: number; net_collected_estimate: number; ai_cost: number; infrastructure_cost: number | null; estimated_contribution: number; contribution_excludes_infrastructure: boolean; chargebacks: number | null };
  by_plan: { plan: string; currency: string; amount: number; payments: number }[];
  series: { day: string; subscription_usd: number; topups_usd: number; ai_cost_usd: number; cumulative_subscribers: number }[];
};
type Payments = { total: number; rows: { id: string; created_at: string; email: string | null; provider: string; kind: string; product_key: string; amount: number; currency: string; status: string; failure_reason: string | null }[] };
const STATUS = ["succeeded", "refunded", "failed", "pending"] as const;

export default async function RevenuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const range = parseRange(sp);
  const status = (STATUS as readonly string[]).includes(sp.status ?? "") ? sp.status! : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const args = { p_from: iso(range.from), p_to: iso(range.to) };
  const [r, pay] = await Promise.all([
    loadReport<Revenue>(s, "admin_revenue", { ...args, p_tz: range.tz }),
    loadReport<Payments>(s, "admin_payments_page", { ...args, p_status: status ?? null, p_limit: PAGE, p_offset: (page - 1) * PAGE }),
  ]);
  const keep = { status };
  const href = (p: number) => `/admin/revenue?${new URLSearchParams({ ...(range.key !== "30d" ? { range: range.key } : {}), ...(range.key === "custom" ? { from: range.fromDay, to: range.toDay } : {}), ...(status ? { status } : {}), page: String(p) }).toString()}`;

  return (
    <>
      <PageTitle title="Revenue" lead="Collected revenue from verified payments, with refunds, estimated fees and AI cost. Contribution here is an estimate, not accounting profit." />
      <RangeFilter range={range} base="/admin/revenue" keep={keep} />
      {r.error && <Notice tone="danger">{r.error}</Notice>}
      {r.data && (() => {
        const d = r.data;
        const sub = d.by_currency.filter((x) => x.subscription !== null).map((x) => ({ currency: x.currency, amount: x.subscription! }));
        const top = d.by_currency.filter((x) => x.credit_topups !== null).map((x) => ({ currency: x.currency, amount: x.credit_topups! }));
        const labels = d.series.map((x) => x.day.slice(5));
        return (
          <>
            <Section title="Collected" lead="Verified payments in the period. Other currencies are listed separately and are not converted.">
              <KpiGrid>
                <Kpi label="Gross collected" value={moneyList(d.by_currency.map((x) => ({ currency: x.currency, amount: x.gross })))} note={`${num(d.by_currency.reduce((n, x) => n + Number(x.payments), 0))} payments`} />
                <Kpi label="Subscription revenue" value={moneyList(sub)} />
                <Kpi label="Credit top-up revenue" value={moneyList(top)} />
                <Kpi label="Refunds" value={moneyList(d.refunds)} />
                <Kpi label="Payment processing fees (USD)" value={money(d.usd.estimated_fees)} estimate note="From the fee percentage set in Settings" />
                <Kpi label="Chargebacks" value={d.usd.chargebacks === null ? "Not tracked" : money(d.usd.chargebacks)} note="Disputes are not recorded by the payment integration yet" />
                <Kpi label="Net collected (USD)" value={money(d.usd.net_collected_estimate)} estimate note="Gross minus refunds and estimated fees" />
                <Kpi label="Pending settlement" value={d.pending.payments ? `${num(d.pending.payments)} payments` : "None"} note={d.pending.payments ? `${money(d.pending.amount_usd)} started in the last 2 days, not confirmed` : "Nothing waiting for confirmation"} />
              </KpiGrid>
            </Section>
            <Section title="Costs and contribution (USD)">
              <KpiGrid cols={3}>
                <Kpi label="AI provider expenditure" value={money(d.usd.ai_cost, "USD", 2)} note="Recorded token usage times the price table" />
                <Kpi label="Hosting and infrastructure" value={d.usd.infrastructure_cost === null ? NA : money(d.usd.infrastructure_cost)} estimate={d.usd.infrastructure_cost !== null} note={d.usd.infrastructure_cost === null ? "Enter your monthly cost in Settings to include it" : "Monthly cost you entered, prorated to the period"} />
                <Kpi label="Estimated operating contribution" value={money(d.usd.estimated_contribution)} estimate note={d.usd.contribution_excludes_infrastructure ? "Does not include hosting" : "After refunds, fees, AI and hosting"} />
              </KpiGrid>
              <Notice tone="warning" title="Not accounting profit">Contribution leaves out staff, tax, currency effects, chargebacks and any cost not entered here. Payment fees are an estimate unless the provider confirms them. Only USD payments are included in these three figures.</Notice>
            </Section>
            <Section title="Revenue over time (USD)"><LineChart title="Subscription and top-up revenue by day" labels={labels} format={(n) => money(n, "USD", 0)} series={[{ name: "Subscriptions", values: d.series.map((x) => Number(x.subscription_usd)), color: "primary" }, { name: "Credit top-ups", values: d.series.map((x) => Number(x.topups_usd)), color: "teal" }]} /></Section>
            <Section title="Revenue against AI cost (USD)"><LineChart title="Revenue and AI cost by day" labels={labels} format={(n) => money(n, "USD", 2)} series={[{ name: "Revenue", values: d.series.map((x) => Number(x.subscription_usd) + Number(x.topups_usd)), color: "primary" }, { name: "AI cost", values: d.series.map((x) => Number(x.ai_cost_usd)), color: "navy" }]} /></Section>
            <Section title="Subscription growth" lead="People who have ever made a paid subscription payment, cumulative by day. It does not subtract cancellations.">
              <LineChart title="Cumulative paying subscribers" labels={labels} format={(n) => num(n)} series={[{ name: "Subscribers (ever paid)", values: d.series.map((x) => Number(x.cumulative_subscribers)), color: "teal" }]} />
            </Section>
            <Section title="Revenue by plan"><Bars rows={d.by_plan.map((x) => ({ label: `${x.plan} (${x.currency})`, value: Number(x.amount), note: `${x.payments} payments` }))} format={(n) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 })} /></Section>
          </>
        );
      })()}
      <Section title="Payments" lead="Newest first. Amounts and statuses come from the payment provider's verified events and cannot be edited here.">
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {[undefined, ...STATUS].map((k) => <Link key={k ?? "all"} href={`/admin/revenue?${new URLSearchParams({ ...(range.key !== "30d" ? { range: range.key } : {}), ...(range.key === "custom" ? { from: range.fromDay, to: range.toDay } : {}), ...(k ? { status: k } : {}) }).toString()}`} aria-current={status === k ? "true" : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium ${status === k ? "border-primary bg-primary text-white" : "border-line-strong bg-surface text-ink hover:border-primary"}`}>{k ?? "All"}</Link>)}
          <Link href={`/admin/export/payments?${new URLSearchParams({ range: range.key, from: range.fromDay, to: range.toDay, ...(status ? { status } : {}) }).toString()}`} className="ml-auto text-xs font-medium text-primary hover:underline">Export CSV</Link>
        </div>
        {pay.error && <Notice tone="danger">{pay.error}</Notice>}
        {pay.data && <><Table caption="Payments" numeric={[4]} empty="No payments in this period." head={["Created", "User", "Item", "Provider", "Amount", "Status", "Detail"]}
          rows={pay.data.rows.map((p) => [dateTime(p.created_at, range.tz), p.email ?? "(deleted account)", `${p.kind}: ${p.product_key}`, p.provider, money(p.amount, p.currency), <Badge key="s" tone={p.status === "succeeded" ? "success" : p.status === "failed" ? "danger" : p.status === "refunded" ? "warning" : "neutral"}>{p.status}</Badge>, p.failure_reason ?? "-"])} />
          <Pager total={pay.data.total} page={page} pageSize={PAGE} hrefFor={href} /></>}
      </Section>
    </>
  );
}

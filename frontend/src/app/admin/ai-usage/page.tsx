import Link from "next/link";
import { Bars, Kpi, KpiGrid, LineChart, Notice, PageTitle, RangeFilter, Section, Table } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { anthropicReconciliation } from "@/lib/admin/anthropic-cost";
import { dateTime, dec, money, num, pct, NA } from "@/lib/admin/format";
import { iso, loadReport } from "@/lib/admin/load";
import { parseRange } from "@/lib/admin/range";

export const metadata = { title: "AI Costs" };

type Usage = {
  totals: { requests: number; completed: number; failed: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; tool_calls: number; cost_usd: number; avg_cost_usd: number; avg_seconds: number; unknown_usage: number };
  by_feature: { feature_key: string; requests: number; failed: number; cost_usd: number; credits: number; avg_cost_usd: number | null }[];
  by_model: { model_id: string; requests: number; input_tokens: number; output_tokens: number; cost_usd: number }[];
  errors: { code: string; requests: number }[];
  series: { day: string; requests: number; cost_usd: number }[];
  most_expensive: { created_at: string; email: string | null; feature_key: string; model_id: string; status: string; iterations: number; tool_calls: number; cost_usd: number; input_tokens: number; output_tokens: number }[];
  near_limit: { email: string; used: number; allowance: number; pct: number }[];
  budget: { daily_budget_usd: number; today_spent_usd: number | null; today_reserved_usd: number | null; monthly_budget_usd: number; month_spent_usd: number };
  alerts: { day: string; threshold_pct: number; spent_usd: number; budget_usd: number; created_at: string }[];
  limits: { features: { feature_key: string; enabled: boolean; max_iterations: number; max_tool_calls: number; max_op_cost_usd: number; max_output_tokens: number }[] };
};

export default async function AiUsagePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const range = parseRange(await searchParams);
  const r = await loadReport<Usage>(s, "admin_ai_usage", { p_from: iso(range.from), p_to: iso(range.to), p_tz: range.tz });
  const recon = await anthropicReconciliation(range.from, range.to);

  return (
    <>
      <PageTitle title="AI Costs" lead="Requests, tokens and cost from the recorded usage of every AI operation, priced with the model price table. Cost counts input, output, cached tokens and paid tools, plus the platform's exposure on requests that did not finish cleanly." />
      <RangeFilter range={range} base="/admin/ai-usage" />
      {r.error && <Notice tone="danger">{r.error}</Notice>}
      {r.data && (() => {
        const d = r.data; const t = d.totals;
        const dailyPct = d.budget.today_spent_usd !== null && d.budget.daily_budget_usd ? (100 * d.budget.today_spent_usd) / d.budget.daily_budget_usd : 0;
        const monthPct = d.budget.monthly_budget_usd ? (100 * d.budget.month_spent_usd) / d.budget.monthly_budget_usd : 0;
        return (
          <>
            <Section title="Totals">
              <KpiGrid>
                <Kpi label="Requests" value={num(t.requests)} note={`${num(t.completed)} completed, ${num(t.failed)} failed`} />
                <Kpi label="Cost" value={money(t.cost_usd, "USD", 2)} note={`${money(t.avg_cost_usd, "USD", 4)} per completed request`} />
                <Kpi label="Input tokens" value={num(t.input_tokens)} note={`${num(t.cache_read_tokens)} read from cache`} />
                <Kpi label="Output tokens" value={num(t.output_tokens)} note={`${num(t.cache_write_tokens)} cache write tokens`} />
                <Kpi label="Average response time" value={t.avg_seconds ? `${dec(t.avg_seconds, 1)} s` : NA} note="Completed requests" />
                <Kpi label="Failed requests" value={num(t.failed)} note={pct(t.failed, t.requests) + " of requests"} />
                <Kpi label="Tool calls" value={num(t.tool_calls)} />
                <Kpi label="Usage not reported" value={num(t.unknown_usage)} note="Requests where the provider did not report usage; counted at worst case" />
              </KpiGrid>
            </Section>
            <Section title="Budgets" lead="Hard limits enforced in the application before a request starts. Change them in Settings.">
              <KpiGrid cols={3}>
                <Kpi label="Today (UTC)" value={`${money(d.budget.today_spent_usd ?? 0)} of ${money(d.budget.daily_budget_usd)}`} note={`${dailyPct.toFixed(0)}% used. Resets at 00:00 UTC.`} />
                <Kpi label="This month (UTC)" value={d.budget.monthly_budget_usd ? `${money(d.budget.month_spent_usd)} of ${money(d.budget.monthly_budget_usd)}` : money(d.budget.month_spent_usd)} note={d.budget.monthly_budget_usd ? `${monthPct.toFixed(0)}% used` : "No monthly ceiling is set"} />
                <Kpi label="Recent budget alerts" value={num(d.alerts.length)} note={d.alerts[0] ? `Last: ${d.alerts[0].threshold_pct}% on ${d.alerts[0].day}` : "None"} />
              </KpiGrid>
            </Section>
            <Section title="Spend and requests by day"><LineChart title="AI cost and requests by day" labels={d.series.map((x) => x.day.slice(5))} format={(n) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 })} series={[{ name: "Cost (USD)", values: d.series.map((x) => Number(x.cost_usd)), color: "primary" }, { name: "Requests", values: d.series.map((x) => Number(x.requests)), color: "teal" }]} /></Section>
            <Section title="By feature"><Table caption="AI usage by feature" numeric={[1, 2, 3, 4, 5]} head={["Feature", "Requests", "Failed", "Cost", "Credits", "Average cost"]} empty="No AI requests in this period."
              rows={d.by_feature.map((f) => [f.feature_key, num(f.requests), num(f.failed), money(f.cost_usd, "USD", 4), dec(f.credits, 1), f.avg_cost_usd === null ? NA : money(f.avg_cost_usd, "USD", 5)])} /></Section>
            <Section title="By model"><Table caption="AI usage by model" numeric={[1, 2, 3, 4]} head={["Model", "Requests", "Input tokens", "Output tokens", "Cost"]} empty="No AI requests in this period."
              rows={d.by_model.map((m) => [m.model_id, num(m.requests), num(m.input_tokens), num(m.output_tokens), money(m.cost_usd, "USD", 4)])} /></Section>
            <Section title="Most expensive requests"><Table caption="Most expensive AI requests" numeric={[5, 6, 7]} head={["When", "User", "Feature", "Model", "Status", "Iterations", "Tool calls", "Cost"]} empty="No requests."
              rows={d.most_expensive.map((e) => [dateTime(e.created_at, range.tz), e.email ?? "-", e.feature_key, e.model_id, e.status, e.iterations, e.tool_calls, money(e.cost_usd, "USD", 4)])} /></Section>
            <Section title="Failures"><Bars rows={d.errors.map((e) => ({ label: e.code, value: Number(e.requests) }))} /></Section>
            <Section title="People close to their credit limit" lead="Used 80 percent or more of this period's allowance."><Table caption="Users near their limit" numeric={[1, 2, 3]} head={["User", "Used", "Allowance", "Share"]} empty="Nobody is close to their limit." rows={d.near_limit.map((u) => [u.email, dec(u.used, 1), dec(u.allowance, 1), `${u.pct}%`])} /></Section>
            <Section title="Limits per feature" lead="Maximum iterations, tool calls and cost for one operation. Edit them in Settings.">
              <Table caption="Per-feature limits" numeric={[1, 2, 3, 4]} head={["Feature", "Max iterations", "Max tool calls", "Max cost per operation", "Max output tokens", "Enabled"]} rows={d.limits.features.map((f) => [f.feature_key, f.max_iterations, f.max_tool_calls, money(f.max_op_cost_usd, "USD", 2), num(f.max_output_tokens), f.enabled ? "Yes" : "No"])} />
              <p className="mt-2"><Link href="/admin/settings" className="text-sm font-medium text-primary hover:underline">Change limits and budgets</Link></p>
            </Section>
          </>
        );
      })()}
      <Section title="Reconciliation with Anthropic" lead="Compares the cost ToProt recorded with the cost Anthropic reports for the same dates.">
        {recon.status === "ok" ? (
          <Table caption="Reconciliation" numeric={[1, 2]} head={["Source", "Cost (USD)", "Difference"]} rows={[["Recorded by ToProt", money(r.data?.totals.cost_usd ?? 0, "USD", 2), "-"], ["Reported by Anthropic", money(recon.costUsd, "USD", 2), r.data ? money(recon.costUsd - r.data.totals.cost_usd, "USD", 2) : "-"]]} />
        ) : recon.status === "not_configured" ? (
          <Notice tone="setup" title="Not set up">Set <code>ANTHROPIC_ADMIN_API_KEY</code> (an Admin API key from the Anthropic Console, not the normal API key) on the server to compare costs. Until then no comparison is shown. Differences are expected when the key covers other workspaces or when usage is billed a day late.</Notice>
        ) : <Notice tone="warning" title="Could not reach Anthropic">{recon.message}</Notice>}
      </Section>
    </>
  );
}

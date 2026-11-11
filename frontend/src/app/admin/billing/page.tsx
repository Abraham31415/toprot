import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { formatMoney } from "@/lib/billing/catalog";

export const metadata = { title: "Billing administration", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Overview = {
  window: { from: string; to: string };
  users: { total: number; new: number; ai_active: number };
  paying_subscribers: number;
  revenue: { currency: string; kind: string; amount: number; payments: number }[];
  refunds: { currency: string; amount: number; payments: number }[];
  ai_cost_usd: number;
  cost_by_model: { model_id: string; operations: number; cost_usd: number; input_tokens: number; output_tokens: number }[];
  usage_by_feature: { feature_key: string; operations: number; completed: number; cost_usd: number; credits_charged: number }[];
  margin: { usd_revenue: number; estimated_fees_usd: number; ai_cost_usd: number; estimated_gross_margin_usd: number; note: string };
  payment_failures: { count: number; by_reason: { reason: string; payments: number }[]; recent: { created_at: string; kind: string; product_key: string; currency: string; amount: number; failure_reason: string | null; user_masked: string }[] };
  pending_payments: number;
};
type Unusual = { user_masked: string; operations: number; failures: number; cost_usd: number; cost_24h_usd: number; flags: string[] }[];

const RANGES = [7, 30, 90] as const;
const usd = (n: number) => formatMoney(Number(n), "USD");
const num = (n: number) => Number(n).toLocaleString("en-GB");

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-lg border border-line bg-white p-4"><p className="text-xs text-navy/60">{label}</p><p className="mt-1 text-2xl font-semibold text-navy">{value}</p>{sub && <p className="mt-0.5 text-xs text-navy/55">{sub}</p>}</div>;
}
function Table({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full text-left text-sm"><caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line text-xs text-navy/65"><tr>{head.map((h, i) => <th key={h} scope="col" className={`px-3 py-2 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.length === 0 ? <tr><td className="px-3 py-3 text-navy/60" colSpan={head.length}>Nothing in this period.</td></tr> : rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">{r.map((c, j) => <td key={j} className={`px-3 py-2 ${j > 0 ? "text-right tabular-nums" : ""} text-navy`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default async function AdminBillingPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const admin = createAdminClient();
  // Authorisation is checked on the server against the app_admins table. Anyone else gets a 404, so the page's existence is not revealed.
  const isAdmin = await admin.rpc("is_app_admin", { p_user: profile.id });
  if (isAdmin.error || isAdmin.data !== true) notFound();

  const { days } = await searchParams;
  const range = RANGES.find((r) => String(r) === days) ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - range * 86400_000);
  const [{ data: o }, { data: unusual }] = await Promise.all([
    admin.rpc("billing_admin_overview", { p_from: from.toISOString(), p_to: to.toISOString() }),
    admin.rpc("billing_admin_unusual_usage", { p_since: from.toISOString() }),
  ]);
  const ov = o as Overview | null;
  const un = (unusual ?? []) as Unusual;
  if (!ov) return <main className="mx-auto max-w-5xl px-4 py-10"><p className="text-sm text-navy/70">Could not load the report.</p></main>;

  const subRev = ov.revenue.filter((r) => r.kind === "subscription");
  const packRev = ov.revenue.filter((r) => r.kind === "pack");
  const money = (rows: Overview["revenue"]) => (rows.length ? rows.map((r) => formatMoney(Number(r.amount), r.currency)).join(" + ") : "0");
  const cnt = (rows: Overview["revenue"]) => rows.reduce((n, r) => n + Number(r.payments), 0);

  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Link href="/dashboard" className="text-sm text-navy/65 hover:underline">Back</Link>
        <h1 className="mt-2 text-xl font-semibold text-navy">Billing administration</h1>
        <p className="mt-1 text-sm text-navy/65">Aggregates for the last {range} days. Individual users appear only with masked email addresses, and no payment card or mobile money details exist in ToProt.</p>
        <nav aria-label="Period" className="mt-3 flex gap-2">{RANGES.map((r) => <Link key={r} href={`/admin/billing?days=${r}`} aria-current={r === range} className={`rounded-md border px-3 py-1 text-sm ${r === range ? "border-cobalt bg-cobalt text-white" : "border-navy/25 text-navy hover:border-cobalt"}`}>{r} days</Link>)}</nav>

        <section aria-label="Overview" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Users" value={num(ov.users.total)} sub={`${num(ov.users.new)} new in this period`} />
          <Card label="Active AI users" value={num(ov.users.ai_active)} sub="made at least one AI request" />
          <Card label="Paying subscribers" value={num(ov.paying_subscribers)} sub="active right now" />
          <Card label="Pending payments" value={num(ov.pending_payments)} sub="awaiting confirmation" />
          <Card label="Subscription revenue" value={money(subRev)} sub={`${cnt(subRev)} payments`} />
          <Card label="Credit sales" value={money(packRev)} sub={`${cnt(packRev)} payments`} />
          <Card label="AI API expenditure" value={usd(ov.ai_cost_usd)} sub="provider cost incl. failed calls" />
          <Card label="Est. gross margin (USD)" value={usd(ov.margin.estimated_gross_margin_usd)} sub="estimate, see note below" />
        </section>
        <p className="mt-2 text-xs text-navy/60">Margin = USD payments {usd(ov.margin.usd_revenue)} - estimated payment fees {usd(ov.margin.estimated_fees_usd)} - AI cost {usd(ov.margin.ai_cost_usd)}. {ov.margin.note}{ov.refunds.length ? ` Refunds in this period: ${ov.refunds.map((r) => formatMoney(Number(r.amount), r.currency)).join(" + ")} (not deducted above).` : ""} Purchased credits that have not been used yet are not yet a cost, so margin on credit sales improves as they are used or expire.</p>

        <h2 className="mt-8 text-sm font-semibold text-navy">AI cost by model</h2>
        <Table caption="AI cost by model" head={["Model", "Operations", "Input tokens", "Output tokens", "Cost"]} rows={ov.cost_by_model.map((m) => [m.model_id, num(m.operations), num(m.input_tokens), num(m.output_tokens), usd(m.cost_usd)])} />

        <h2 className="mt-8 text-sm font-semibold text-navy">Usage by feature</h2>
        <Table caption="Usage by feature" head={["Feature", "Operations", "Completed", "Credits charged", "Cost"]} rows={ov.usage_by_feature.map((f) => [f.feature_key, num(f.operations), num(f.completed), num(Math.round(Number(f.credits_charged))), usd(f.cost_usd)])} />

        <h2 className="mt-8 text-sm font-semibold text-navy">Payment failures ({num(ov.payment_failures.count)})</h2>
        <Table caption="Payment failures by reason" head={["Reason", "Payments"]} rows={ov.payment_failures.by_reason.map((r) => [r.reason, num(r.payments)])} />
        {ov.payment_failures.recent.length > 0 && <Table caption="Recent failed payments" head={["When", "User", "Item", "Amount", "Reason"]} rows={ov.payment_failures.recent.map((p) => [new Date(p.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), p.user_masked, `${p.kind}: ${p.product_key}`, formatMoney(Number(p.amount), p.currency), p.failure_reason ?? "unknown"])} />}

        <h2 className="mt-8 text-sm font-semibold text-navy">Unusual usage</h2>
        <p className="mt-1 text-xs text-navy/60">Heuristics for a human to review (cost far above the typical user, many failures, very many requests, a sudden spike). They are not proof of misuse.</p>
        <Table caption="Unusual usage" head={["User", "Requests", "Failed", "Cost", "Last 24h", "Why flagged"]} rows={un.map((u) => [u.user_masked, num(u.operations), num(u.failures), usd(u.cost_usd), usd(u.cost_24h_usd), u.flags.join("; ")])} />
      </main>
    </div>
  );
}

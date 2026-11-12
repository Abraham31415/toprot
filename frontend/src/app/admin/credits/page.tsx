import Link from "next/link";
import { Kpi, KpiGrid, Notice, PageTitle, Section, Table, inputCls } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dec, money } from "@/lib/admin/format";
import { loadReport } from "@/lib/admin/load";

export const metadata = { title: "AI Credits" };

type Credits = {
  allocated: { subscription_credits: number; introductory_credits: number; purchased_credits: number; granted_credits: number };
  consumed: { subscription_pool: number; purchased_pool: number };
  expired_credits: number; reserved_now: number;
  available: { subscription: number; purchased_and_granted: number; total: number };
  exposure_usd: number; exposure_note: string; deferred_purchase_revenue_usd: number; credit_value_micro_usd: number;
  top_users: { email: string; credits: number; requests: number; cost_usd: number }[];
  ledger_check: { lots_overdrawn: number; periods_overdrawn: number; negative_reserved: number };
};

export default async function CreditsPage() {
  const s = await requireAdmin();
  const r = await loadReport<Credits>(s, "admin_credits");
  return (
    <>
      <PageTitle title="AI Credits" lead="Credits control how much AI each person can use. Subscription credits and purchased or promotional credits are kept in separate balances; subscription credits are spent first." />
      {r.error && <Notice tone="danger">{r.error}</Notice>}
      {r.data && (() => {
        const c = r.data;
        const issues = c.ledger_check.lots_overdrawn + c.ledger_check.periods_overdrawn + c.ledger_check.negative_reserved;
        return (
          <>
            <Section title="Allocated" lead="Everything ever granted. One credit stands for the AI cost shown below.">
              <KpiGrid>
                <Kpi label="Monthly subscription credits" value={dec(c.allocated.subscription_credits, 0)} note="All Pro periods so far" />
                <Kpi label="Introductory credits" value={dec(c.allocated.introductory_credits, 0)} note="Free accounts" />
                <Kpi label="Purchased credits" value={dec(c.allocated.purchased_credits, 0)} />
                <Kpi label="Promotional grants" value={dec(c.allocated.granted_credits, 0)} note="Issued by administrators" />
              </KpiGrid>
              <p className="type-caption mt-2">One credit = {money(c.credit_value_micro_usd / 1_000_000, "USD", 4)} of AI provider cost.</p>
            </Section>
            <Section title="Used and remaining">
              <KpiGrid>
                <Kpi label="Consumed, subscription pool" value={dec(c.consumed.subscription_pool, 0)} />
                <Kpi label="Consumed, purchased pool" value={dec(c.consumed.purchased_pool, 0)} note="From the credit ledger" />
                <Kpi label="Expired" value={dec(c.expired_credits, 0)} note="Purchased credits that passed their expiry" />
                <Kpi label="Reserved by running requests" value={dec(c.reserved_now, 1)} />
                <Kpi label="Available to customers" value={dec(c.available.total, 0)} note={`${dec(c.available.subscription, 0)} subscription, ${dec(c.available.purchased_and_granted, 0)} purchased or promotional`} />
                <Kpi label="Exposure from unused credits" value={money(c.exposure_usd)} estimate note={c.exposure_note} />
                <Kpi label="Prepaid revenue not yet used" value={money(c.deferred_purchase_revenue_usd)} estimate note="USD credit purchases, share of each purchase not yet consumed" />
              </KpiGrid>
            </Section>
            <Section title="Ledger consistency" lead="Checks that no balance is overdrawn or negative.">
              {issues === 0 ? <Notice tone="info" title="No problems found">No credit lot or period is overdrawn and no reservation is negative.</Notice>
                : <Notice tone="danger" title="Ledger problems found">{c.ledger_check.lots_overdrawn} overdrawn lots, {c.ledger_check.periods_overdrawn} overdrawn periods, {c.ledger_check.negative_reserved} negative reservations. Investigate before issuing credits.</Notice>}
            </Section>
            <Section title="Heaviest users, last 30 days" lead="Completed requests only.">
              <Table caption="Heaviest credit users" numeric={[1, 2, 3]} head={["User", "Credits used", "Requests", "Provider cost"]} empty="No AI usage in the last 30 days." rows={c.top_users.map((u) => [u.email, dec(u.credits, 1), u.requests, money(u.cost_usd, "USD", 4)])} />
            </Section>
            <Section title="Look up one user's credit ledger" lead="Every credit movement with its pool, source, operation, model and running balance.">
              <form action="/admin/users" method="get" role="search" className="flex flex-wrap gap-2"><label htmlFor="c-q" className="sr-only">Find a user</label><input id="c-q" name="q" placeholder="Name or email" className={`${inputCls} max-w-sm`} /><button className="h-9 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium hover:border-primary">Find</button></form>
              <p className="type-caption mt-2">Open a user, then choose &quot;Full credit ledger for this user&quot;. Or go to <Link href="/admin/users" className="text-primary hover:underline">Users</Link>.</p>
            </Section>
            <Notice tone="setup" title="Credit rules enforced by the database">Only active Pro subscribers can buy credit packs, subscription credits are spent before purchased credits, purchased credits survive a subscription ending, and reservations are taken under row locks so simultaneous requests cannot overspend. Administrators can add promotional credits only through an audited, capped action.</Notice>
          </>
        );
      })()}
    </>
  );
}

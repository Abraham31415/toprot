import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { loadCatalog, formatMoney } from "@/lib/billing/catalog";
import { credits, loadBillingOverview } from "@/lib/billing/data";
import { providerInfo, providerReady } from "@/lib/billing/provider";
import { PurchasePanel } from "./purchase-panel";

export const metadata = { title: "Billing and AI credits" };
export const dynamic = "force-dynamic";

const FEATURE_LABELS: Record<string, string> = {
  protocol_review: "Protocol reviewer questions", assistant_light: "AI assistant (light)", assistant_standard: "AI assistant (standard)", assistant_deep: "AI assistant (deep)",
  pdf_qa: "PDF questions", pdf_compare: "PDF comparison",
};
const STATUS: Record<string, string> = { committed: "Completed", failed: "Not charged (error)", released: "Not charged", expired: "Not charged (timed out)", reserved: "In progress" };
const PAY_STATUS: Record<string, string> = { succeeded: "Paid", pending: "Awaiting payment", failed: "Not completed", refunded: "Refunded" };
const TX_KIND: Record<string, string> = { subscription_grant: "Plan credits", purchase: "Credits purchased", usage: "AI usage", expiry: "Credits expired", refund: "Refund", adjustment: "Adjustment" };
const CHECKOUT_NOTE: Record<string, { text: string; tone: "good" | "warn" }> = {
  success: { text: "Payment confirmed. Your plan or credits are now active.", tone: "good" },
  pending: { text: "Your payment is still being confirmed. This page updates automatically once it is. Refresh in a minute.", tone: "warn" },
  failed: { text: "The payment was not completed, so nothing was charged to your plan or credits.", tone: "warn" },
  unknown: { text: "We could not find that payment.", tone: "warn" },
  unavailable: { text: "Payments are not available right now.", tone: "warn" },
};
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.role) redirect("/onboarding");
  const { checkout } = await searchParams;
  const admin = createAdminClient();
  const [overview, catalog, windowRow] = await Promise.all([
    loadBillingOverview(admin, profile.id),
    loadCatalog(admin).catch(() => null),
    admin.from("billing_settings").select("value_num").eq("key", "renewal_window_days").maybeSingle(),
  ]);
  const ready = providerReady();
  const provider = providerInfo();
  const windowDays = Number(windowRow.data?.value_num ?? 3);
  const h = overview.headroom;
  const sub = overview.subscription;
  const paidPlan = catalog?.plans.find((p) => p.isPaid) ?? null;
  const freePlan = catalog?.plans.find((p) => !p.isPaid) ?? null;
  const activePaid = h && h.planKey !== "free" && sub?.periodEnd ? sub : null;
  const msLeft = activePaid?.periodEnd ? new Date(activePaid.periodEnd).getTime() - Date.now() : null;
  const managed = !!activePaid && activePaid.autoRenews && !activePaid.cancelAtPeriodEnd;
  const canBuyPlan = !!paidPlan && !managed && (msLeft === null || activePaid?.autoRenews || msLeft <= windowDays * 86400_000);
  const used = h && h.allowanceMcr > 0 ? Math.min(100, Math.round((h.usedMcr / h.allowanceMcr) * 100)) : 0;
  const home = profile.role === "supervisor" ? "/supervisor" : "/dashboard";
  const note = checkout ? CHECKOUT_NOTE[checkout] : null;

  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Link href={home} className="text-sm text-navy/65 hover:underline">Back</Link>
        <h1 className="mt-2 text-2xl font-semibold text-navy">Billing and AI credits</h1>
        <p className="mt-1 text-sm text-navy/65">Your plan, your AI credit balance, and your payment history in one place.</p>
        {note && <p role="status" className={`mt-3 rounded-md px-3 py-2 text-sm ${note.tone === "good" ? "bg-teal/10 text-teal-ink" : "bg-amber-50 text-amber-900"}`}>{note.text}</p>}

        {!h ? (
          <p className="mt-4 rounded-lg border border-line bg-white p-4 text-sm text-navy/75">Credit information is temporarily unavailable. Everything else in ToProt still works.{overview.headroomError ? <span className="mt-1 block text-xs text-navy/50">Technical detail: {overview.headroomError}</span> : null}</p>
        ) : (
          <>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <section aria-labelledby="plan-h" className="rounded-xl border border-line bg-white p-5">
              <h2 id="plan-h" className="text-sm font-medium text-navy/65">Your plan</h2>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold text-navy">{h.planKey === "free" ? (freePlan?.name ?? "Free") : (catalog?.plans.find((p) => p.key === h.planKey)?.name ?? "Toprot Pro")}{h.planKey !== "free" && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${activePaid?.cancelAtPeriodEnd ? "bg-gold/15 text-[#8a5d1c]" : "bg-teal/10 text-teal-ink"}`}>{activePaid?.cancelAtPeriodEnd ? "Ends " + (h.periodEnd ? date(h.periodEnd) : "soon") : "Active"}</span>}</p>
              <dl className="mt-3 grid gap-y-2 text-sm">
                <div><dt className="text-navy/60">Subscription status</dt><dd className="font-medium text-navy">{h.planKey === "free" ? (sub && sub.status !== "active" ? `Ended (${sub.status})` : "Free plan") : "Active"}</dd></div>
                <div><dt className="text-navy/60">Monthly credit allocation</dt><dd className="font-medium text-navy">{h.planKey === "free" ? `${credits(h.allowanceMcr)} one-time introductory credits` : `${credits(h.allowanceMcr)} credits per billing period`}</dd></div>
                <div><dt className="text-navy/60">Next credit reset</dt><dd className="font-medium text-navy">{h.planKey !== "free" && h.periodEnd ? date(h.periodEnd) : "Not applicable (introductory credits do not reset)"}</dd></div>
                <div><dt className="text-navy/60">Projects</dt><dd className="font-medium text-navy">{(() => { const p = catalog?.plans.find((x) => x.key === h.planKey); return p ? (p.maxProjects === null ? "Unlimited" : `Up to ${p.maxProjects}`) : "-"; })()}</dd></div>
              </dl>
              {h.planKey !== "free" && h.periodEnd && (activePaid?.autoRenews
                ? <p className="mt-3 text-xs text-navy/60">{activePaid.cancelAtPeriodEnd ? `Renewal is cancelled. Your plan stays active until ${date(h.periodEnd)} and then ends.` : `Renews automatically each month until you cancel (next renewal around ${date(h.periodEnd)}). Cancelling keeps your plan until the end of the period you paid for. Unused plan credits do not carry over.`}</p>
                : <p className="mt-3 text-xs text-navy/60">This plan does not renew automatically. You can renew during the last {windowDays} days of the period; unused plan credits do not carry over.</p>)}
            </section>

            <section aria-labelledby="credits-h" className="rounded-xl border border-line bg-white p-5">
              <h2 id="credits-h" className="text-sm font-medium text-navy/65">AI credits</h2>
              <p className="mt-1 text-3xl font-semibold text-navy">{credits(h.availableMcr)}<span className="ml-2 text-base font-normal text-navy/65">available in total</span></p>
              <div className="mt-4 grid gap-4">
                <div>
                  <p className="text-sm font-medium text-navy">{h.planKey === "free" ? "Introductory credits" : "Plan credits"}</p>
                  <p className="text-sm text-navy/75">{credits(h.subscriptionAvailableMcr)} left of {credits(h.allowanceMcr)}</p>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-navy/5" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={100} aria-label="Plan credits used"><div className="h-full bg-cobalt" style={{ width: `${used}%` }} /></div>
                  <p className="mt-1 text-xs text-navy/60">{credits(h.usedMcr)} used{h.reservedMcr > 0 ? `, ${credits(h.reservedMcr)} held for requests in progress` : ""}. Used first.</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-navy">Purchased credits</p>
                  <p className="text-sm text-navy/75">{credits(h.purchasedAvailableMcr)} available</p>
                  {overview.lots.length === 0 ? <p className="mt-1 text-xs text-navy/60">None. Purchased credits are used after your plan credits and expire on the date shown here.</p> : (
                    <ul className="mt-1 space-y-0.5 text-xs text-navy/70">{overview.lots.map((l) => <li key={l.id}>{credits(l.remainingMcr)} of {credits(l.grantedMcr)} credits, expire {date(l.expiresAt)}</li>)}</ul>
                  )}
                </div>
              </div>
              {h.availableMcr <= 0 && <p className="mt-3 text-sm text-amber-800">You are out of AI credits. Calculators, protocol editing, references and exports keep working.</p>}
            </section>
            </div>

            {catalog && <PurchasePanel catalog={{ ...catalog, currencies: catalog.currencies.filter((c) => provider.currencies.includes(c)) }} ready={ready.ok} readyMessage={ready.ok ? "" : ready.message} currentPlanKey={h.planKey} canBuyPlan={canBuyPlan} renewLabel={activePaid ? "Renew" : "Upgrade"} nextRenewal={activePaid?.periodEnd ? date(activePaid.periodEnd) : null} windowDays={windowDays} providerName={provider.name} autoRenews={provider.autoRenews} processorNote={provider.processorNote} canCancel={managed} isSubscriber={!!activePaid} />}

            <section aria-labelledby="ops-h" className="mt-8">
              <h2 id="ops-h" className="text-sm font-medium text-navy/85">Recent AI operations</h2>
              {overview.operations.length === 0 ? <p className="mt-2 text-sm text-navy/65">No AI requests yet.</p> : (
                <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-white">
                  <table className="w-full text-left text-sm"><thead className="border-b border-line text-xs text-navy/65"><tr><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">Feature</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 text-right font-medium">Credits</th></tr></thead>
                    <tbody>{overview.operations.map((e) => <tr key={e.id} className="border-b border-line last:border-0"><td className="whitespace-nowrap px-3 py-2 text-navy/75">{dateTime(e.createdAt)}</td><td className="px-3 py-2 text-navy">{FEATURE_LABELS[e.feature] ?? e.feature}</td><td className="px-3 py-2 text-navy/75">{STATUS[e.status] ?? e.status}</td><td className="px-3 py-2 text-right tabular-nums text-navy">{e.status === "committed" ? credits(e.chargedMcr) : "0"}</td></tr>)}</tbody></table>
                </div>
              )}
              <p className="mt-2 text-xs text-navy/60">Each request is charged for the processing it actually used, including every model step and any paid tools. Failed requests are not charged.</p>
            </section>

            <section aria-labelledby="pay-h" className="mt-8">
              <h2 id="pay-h" className="text-sm font-medium text-navy/85">Payment history</h2>
              {overview.payments.length === 0 ? <p className="mt-2 text-sm text-navy/65">No payments yet.</p> : (
                <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-white">
                  <table className="w-full text-left text-sm"><thead className="border-b border-line text-xs text-navy/65"><tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 text-right font-medium">Amount</th></tr></thead>
                    <tbody>{overview.payments.map((p) => <tr key={p.id} className="border-b border-line last:border-0"><td className="whitespace-nowrap px-3 py-2 text-navy/75">{dateTime(p.createdAt)}</td><td className="px-3 py-2 text-navy">{p.kind === "subscription" ? (catalog?.plans.find((x) => x.key === p.product)?.name ?? p.product) : (catalog?.packs.find((x) => x.key === p.product)?.name ?? p.product)}</td><td className="px-3 py-2 text-navy/75">{PAY_STATUS[p.status] ?? p.status}</td><td className="px-3 py-2 text-right tabular-nums text-navy">{formatMoney(p.amount, p.currency)}</td></tr>)}</tbody></table>
                </div>
              )}
            </section>

            <section aria-labelledby="tx-h" className="mt-8">
              <h2 id="tx-h" className="text-sm font-medium text-navy/85">Credit ledger</h2>
              {overview.transactions.length === 0 ? <p className="mt-2 text-sm text-navy/65">Nothing yet.</p> : (
                <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-white">
                  <table className="w-full text-left text-sm"><thead className="border-b border-line text-xs text-navy/65"><tr><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Balance</th><th className="px-3 py-2 text-right font-medium">Credits</th></tr></thead>
                    <tbody>{overview.transactions.map((t) => <tr key={t.id} className="border-b border-line last:border-0"><td className="whitespace-nowrap px-3 py-2 text-navy/75">{dateTime(t.createdAt)}</td><td className="px-3 py-2 text-navy">{TX_KIND[t.kind] ?? t.kind}</td><td className="px-3 py-2 text-navy/75">{t.pool === "purchased" ? "Purchased" : "Plan"}</td><td className={`px-3 py-2 text-right tabular-nums ${t.amountMcr < 0 ? "text-navy" : "text-teal-ink"}`}>{t.amountMcr > 0 ? "+" : ""}{credits(t.amountMcr)}</td></tr>)}</tbody></table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

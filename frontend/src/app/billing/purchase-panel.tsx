"use client";

import { useState, useTransition } from "react";
import { formatMoney, type Catalog } from "@/lib/billing/catalog";
import { cancelRenewal, startCheckout } from "./actions";

const primary = "inline-flex items-center justify-center rounded-md bg-cobalt px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cobalt-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex items-center justify-center rounded-md border border-navy/25 bg-white px-4 py-2.5 text-sm font-medium text-navy hover:border-cobalt focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function Check() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-none text-teal-ink" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5l3.5 3.5L16 6" /></svg>
  );
}
function Lock() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="9" width="12" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 016 0V9" /></svg>
  );
}
function Badge({ children, tone = "navy" }: { children: React.ReactNode; tone?: "navy" | "good" | "gold" }) {
  const t = tone === "good" ? "bg-teal/10 text-teal-ink" : tone === "gold" ? "bg-gold/15 text-[#8a5d1c]" : "bg-navy/5 text-navy/75";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function PurchasePanel({ catalog, ready, readyMessage, currentPlanKey, canBuyPlan, renewLabel, nextRenewal, windowDays, providerName, autoRenews, processorNote, canCancel, isSubscriber }: {
  catalog: Catalog; ready: boolean; readyMessage: string; currentPlanKey: string; canBuyPlan: boolean; renewLabel: string; nextRenewal: string | null; windowDays: number;
  providerName: string; autoRenews: boolean; processorNote: string; canCancel: boolean; isSubscriber: boolean;
}) {
  const [currency, setCurrency] = useState(catalog.currencies[0] ?? "USD");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [, start] = useTransition();
  const paid = catalog.plans.find((p) => p.isPaid);
  const free = catalog.plans.find((p) => !p.isPaid);
  const priceIn = (prices: { currency: string; amount: number }[]) => prices.find((p) => p.currency === currency);
  const onPaid = currentPlanKey !== "free";
  const proPrice = paid ? priceIn(paid.prices) : undefined;

  // Best value: the pack with the lowest price per 1,000 credits in the chosen currency.
  const perK = catalog.packs.map((k) => { const p = priceIn(k.prices); return { key: k.key, per: p ? p.amount / (k.credits / 1000) : null, currency: p?.currency }; });
  const bestKey = perK.filter((x) => x.per !== null).sort((a, b) => (a.per ?? 0) - (b.per ?? 0))[0]?.key;

  const cancel = () => start(async () => {
    if (!window.confirm("Stop the monthly renewal? You keep your plan until the end of the period you have already paid for.")) return;
    setError(null); setBusy("cancel");
    const r = await cancelRenewal();
    setBusy(null);
    if (r.error) setError(r.error); else setCancelled(true);
  });

  const go = (kind: "subscription" | "pack", key: string) => start(async () => {
    setError(null); setBusy(`${kind}:${key}`);
    const r = await startCheckout(kind, key, currency);
    if (r.url) { window.location.assign(r.url); return; }
    setBusy(null);
    setError(r.error ?? "Something went wrong.");
  });

  return (
    <section aria-labelledby="buy-h" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="buy-h" className="text-lg font-semibold text-navy">Plans and credit packs</h2>
          <p className="mt-0.5 text-sm text-navy/65">Pick the plan that fits your research. Upgrade or cancel whenever you like.</p>
        </div>
        {catalog.currencies.length > 1 && (
          <label className="text-xs text-navy/70">Pay in{" "}
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-md border border-navy/25 bg-white px-2 py-1 text-sm text-navy">{catalog.currencies.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
        )}
      </div>

      {!ready && <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{readyMessage} You can see the plans below, but they cannot be bought yet.</p>}
      {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {free && (
          <div className={`flex flex-col rounded-xl border bg-white p-5 ${!onPaid ? "border-navy/30" : "border-line"}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-navy">{free.name}</h3>
              {!onPaid && <Badge tone="good">Your plan</Badge>}
            </div>
            <p className="mt-2 text-3xl font-semibold text-navy">{formatMoney(0, currency)}<span className="ml-1 text-sm font-normal text-navy/60">forever</span></p>
            <p className="mt-1 text-sm text-navy/70">{free.tagline}</p>
            <ul className="mt-4 space-y-2 text-sm text-navy/80">
              {free.bullets.map((b) => <li key={b} className="flex gap-2"><Check /><span>{b}</span></li>)}
              <li className="flex gap-2"><Check /><span>{free.introCredits.toLocaleString()} one-time introductory AI credits</span></li>
            </ul>
          </div>
        )}

        {paid && (
          <div className={`relative flex flex-col rounded-xl border-2 bg-white p-5 ${onPaid ? "border-teal" : "border-cobalt"}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-navy">{paid.name}</h3>
              {onPaid ? <Badge tone="good">Your plan</Badge> : <Badge tone="gold">Recommended</Badge>}
            </div>
            {proPrice
              ? <p className="mt-2 text-3xl font-semibold text-navy">{formatMoney(proPrice.amount, proPrice.currency)}<span className="ml-1 text-sm font-normal text-navy/60">per month</span></p>
              : <p className="mt-2 text-sm text-navy/65">Not available in {currency}.</p>}
            <p className="mt-1 text-sm text-navy/70">{paid.tagline}</p>
            <ul className="mt-4 space-y-2 text-sm text-navy/80">
              {paid.bullets.map((b) => <li key={b} className="flex gap-2"><Check /><span>{b}</span></li>)}
              <li className="flex gap-2"><Check /><span>{paid.monthlyCredits.toLocaleString()} AI credits per billing period</span></li>
            </ul>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" className={primary} disabled={!ready || !proPrice || !canBuyPlan || !!busy} onClick={() => go("subscription", paid.key)}>
                {busy === `subscription:${paid.key}` ? "Opening checkout..." : onPaid ? (autoRenews ? "Resubscribe" : renewLabel) : autoRenews ? "Subscribe monthly" : `${renewLabel} for one month`}
              </button>
              {canCancel && !cancelled && <button type="button" className={secondary} disabled={!!busy} onClick={cancel}>{busy === "cancel" ? "Cancelling..." : "Cancel renewal"}</button>}
              {cancelled && <span role="status" className="text-sm text-teal-ink">Renewal cancelled. Your plan stays active until the end of the paid period.</span>}
            </div>
            <p className="mt-3 text-xs text-navy/60">
              {onPaid && !canBuyPlan && nextRenewal ? `Your plan is paid until ${nextRenewal}. ${autoRenews ? "" : `You can renew in the last ${windowDays} days. `}` : ""}
              {autoRenews ? "Billed monthly and renewed automatically until you cancel. Cancel any time and keep your plan until the end of the period you paid for." : "Each month is a separate payment. Nothing renews automatically, and you are not charged unless you complete a payment."}
            </p>
          </div>
        )}
      </div>

      <div className="mt-8">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-navy">Extra AI credits</h3>
          <Badge>Pro subscribers</Badge>
        </div>
        <p className="mt-1 text-sm text-navy/65">Prepaid top-ups for when your plan credits run out. Plan credits are used first, then purchased credits, earliest expiry first.</p>

        {!isSubscriber && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2.5 text-sm text-[#6f4a14]">
            <Lock />
            <p>Credit packs are for Pro subscribers. Subscribe to Pro above to unlock them.</p>
          </div>
        )}

        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {catalog.packs.map((k) => {
            const p = priceIn(k.prices);
            const per = perK.find((x) => x.key === k.key);
            const locked = !isSubscriber;
            return (
              <li key={k.key} className={`flex flex-col rounded-xl border border-line bg-white p-4 ${locked ? "opacity-80" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xl font-semibold text-navy">{k.credits.toLocaleString()}<span className="ml-1 text-sm font-normal text-navy/60">credits</span></p>
                  {k.key === bestKey && catalog.packs.length > 1 && <Badge tone="good">Best value</Badge>}
                </div>
                <p className="mt-1 text-lg text-navy">{p ? formatMoney(p.amount, p.currency) : <span className="text-sm text-navy/60">Not available in {currency}</span>}</p>
                {p && per?.per != null && per.currency && <p className="text-xs text-navy/60">{formatMoney(per.per, per.currency)} per 1,000 credits</p>}
                <p className="mt-2 text-xs text-navy/60">Expire {k.expiryDays} days after purchase.</p>
                <button type="button" className={`${secondary} mt-3 w-full`} disabled={!ready || !p || locked || !!busy} onClick={() => go("pack", k.key)}>
                  {busy === `pack:${k.key}` ? "Opening..." : locked ? "Pro required" : "Buy credits"}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="mt-4 text-xs text-navy/60">
        {processorNote} {providerName === "Flutterwave" ? (currency === "UGX" ? "Mobile Money (MTN and Airtel) is paid in UGX and is a one-off payment for each month or pack. " : "To pay with Ugandan Mobile Money, choose UGX when it is offered. ") : "Prices are shown before any tax; tax is added at checkout where it applies. "}
        Credits and plans are added only after the payment has been confirmed with the payment provider, which normally takes a moment.
      </p>
    </section>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { formatMoney, type Catalog } from "@/lib/billing/catalog";
import { cancelRenewal, startCheckout } from "./actions";

const btn = "rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50";

export function PurchasePanel({ catalog, ready, readyMessage, currentPlanKey, canBuyPlan, renewLabel, nextRenewal, windowDays, providerName, autoRenews, processorNote, canCancel }: {
  catalog: Catalog; ready: boolean; readyMessage: string; currentPlanKey: string; canBuyPlan: boolean; renewLabel: string; nextRenewal: string | null; windowDays: number;
  providerName: string; autoRenews: boolean; processorNote: string; canCancel: boolean;
}) {
  const [currency, setCurrency] = useState(catalog.currencies[0] ?? "USD");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const paid = catalog.plans.find((p) => p.isPaid);
  const priceIn = (prices: { currency: string; amount: number }[]) => prices.find((p) => p.currency === currency);
  const mobileMoney = useMemo(() => currency === "UGX", [currency]);
  const [cancelled, setCancelled] = useState(false);
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
    <section aria-labelledby="buy-h" className="mt-4 rounded-lg border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="buy-h" className="text-base font-semibold text-navy">Plans and credit packs</h2>
        {catalog.currencies.length > 1 && (
          <label className="text-xs text-navy/70">Pay in{" "}
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-md border border-navy/25 bg-white px-2 py-1 text-sm text-navy">{catalog.currencies.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
        )}
      </div>
      {!ready && <p role="status" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{readyMessage} You can see the plans below, but they cannot be bought yet.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}

      {paid && (
        <div className="mt-4 rounded-md border border-line p-4">
          <h3 className="text-sm font-semibold text-navy">{paid.name}</h3>
          <p className="text-sm text-navy/70">{paid.tagline}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-navy/80">{paid.bullets.map((b) => <li key={b}>{b}</li>)}<li>{paid.monthlyCredits.toLocaleString()} AI credits per billing period</li></ul>
          {(() => {
            const p = priceIn(paid.prices);
            return (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {p ? <p className="text-lg font-semibold text-navy">{formatMoney(p.amount, p.currency)}<span className="text-sm font-normal text-navy/60"> per month</span></p> : <p className="text-sm text-navy/65">Not available in {currency}.</p>}
                <button type="button" className={btn} disabled={!ready || !p || !canBuyPlan || !!busy} onClick={() => go("subscription", paid.key)}>{busy === `subscription:${paid.key}` ? "Opening checkout..." : autoRenews ? `${renewLabel === "Renew" ? "Resubscribe" : "Subscribe"} monthly` : `${renewLabel} for one month`}</button>
                {canCancel && !cancelled && <button type="button" className="rounded-md border border-navy/25 px-4 py-2 text-sm font-medium text-navy hover:border-cobalt disabled:opacity-50" disabled={!!busy} onClick={cancel}>{busy === "cancel" ? "Cancelling..." : "Cancel renewal"}</button>}
                {cancelled && <span role="status" className="text-sm text-teal-ink">Renewal cancelled. Your plan stays active until the end of the paid period.</span>}
              </div>
            );
          })()}
          <p className="mt-2 text-xs text-navy/60">
            {currentPlanKey !== "free" && !canBuyPlan && nextRenewal ? `Your plan is paid until ${nextRenewal}. You can renew in the last ${windowDays} days. ` : ""}
            {autoRenews ? "Billed monthly and renewed automatically until you cancel. You can cancel at any time and keep your plan until the end of the period you paid for." : "Each month is a separate payment. Nothing renews automatically, and you will not be charged unless you complete a payment."}
          </p>
        </div>
      )}

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-navy">Extra AI credits</h3>
        <p className="mt-1 text-xs text-navy/70">Prepaid, optional. Plan credits are used first, then purchased credits, earliest expiry first. Purchased credits are kept separately from your plan credits.</p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-3">
          {catalog.packs.map((k) => {
            const p = priceIn(k.prices);
            return (
              <li key={k.key} className="rounded-md border border-line p-3">
                <p className="text-sm font-semibold text-navy">{k.credits.toLocaleString()} credits</p>
                <p className="text-sm text-navy">{p ? formatMoney(p.amount, p.currency) : <span className="text-navy/60">Not available in {currency}</span>}</p>
                <p className="mt-1 text-xs text-navy/60">Expire {k.expiryDays} days after purchase.</p>
                <button type="button" className={`${btn} mt-2 w-full`} disabled={!ready || !p || !!busy} onClick={() => go("pack", k.key)}>{busy === `pack:${k.key}` ? "Opening..." : "Buy"}</button>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-3 text-xs text-navy/60">
        {processorNote} {providerName === "Flutterwave" ? (mobileMoney ? "Mobile Money (MTN and Airtel) is paid in UGX and is a one-off payment for each month or pack. " : "To pay with Ugandan Mobile Money, choose UGX when it is offered. ") : "Prices are shown before any tax; tax is added at checkout where it applies. "}
        Credits and plans are added only after the payment has been confirmed with the payment provider, which normally takes a moment.
      </p>
    </section>
  );
}

import type { Metadata } from "next";
import { ButtonLink, Container, PageHeading, PageShell } from "@/components/marketing/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney, loadCatalog, type Catalog } from "@/lib/billing/catalog";
import { checkoutReady, loadFlwConfig } from "@/lib/billing/flutterwave";

export const metadata: Metadata = {
  title: "Pricing",
  description: "ToProt is free to start. Toprot Pro adds larger project limits, the full AI research assistant and monthly AI credits. Optional prepaid credit packs are available.",
  alternates: { canonical: "/pricing" },
};
// Prices, plans and packs are read from the database, so a change there shows up here within minutes.
export const revalidate = 300;

async function load(): Promise<Catalog | null> {
  try { return await loadCatalog(createAdminClient()); } catch { return null; }
}

export default async function PricingPage() {
  const catalog = await load();
  const onSale = checkoutReady(loadFlwConfig()).ok;
  const free = catalog?.plans.find((p) => !p.isPaid);
  const pro = catalog?.plans.find((p) => p.isPaid);
  const proPrice = pro?.prices.find((p) => p.currency === "USD") ?? pro?.prices[0];

  return (
    <PageShell>
      <PageHeading eyebrow="Pricing" title="Start free. Upgrade when you need more." lead="The research tools are free. Toprot Pro adds more projects and the full AI research assistant. AI credits pay for the processing AI features actually use." />
      <Container className="pb-16">
        {!catalog ? (
          <p className="rounded-md border border-line bg-white p-4 text-sm text-navy/75">Pricing is temporarily unavailable. Please check back shortly.</p>
        ) : (
          <>
            <div className="grid gap-5 md:grid-cols-3">
              {free && (
                <section className="rounded-lg border-2 border-cobalt bg-white p-6">
                  <p className="text-sm font-semibold text-teal-ink">Available now</p>
                  <h2 className="mt-1 text-xl font-semibold">{free.name}</h2>
                  <p className="mt-2 text-3xl font-semibold">{formatMoney(0, "USD")}</p>
                  <p className="mt-1 text-sm text-navy/70">{free.tagline}</p>
                  <ul className="mt-4 ml-5 list-disc space-y-2 text-sm text-navy/80">{free.bullets.map((b) => <li key={b}>{b}</li>)}<li>{free.introCredits.toLocaleString()} one-time introductory AI credits</li></ul>
                  <div className="mt-6"><ButtonLink href="/register">Start for free</ButtonLink></div>
                </section>
              )}
              {pro && (
                <section className={`rounded-lg border bg-white p-6 ${onSale ? "border-2 border-cobalt" : "border-dashed border-gold/60"}`}>
                  <p className={`text-sm font-semibold ${onSale ? "text-teal-ink" : "text-[#8a5d1c]"}`}>{onSale ? "Available now" : "Coming soon: payments are not open yet"}</p>
                  <h2 className="mt-1 text-xl font-semibold">{pro.name}</h2>
                  <p className="mt-2 text-3xl font-semibold">{proPrice ? formatMoney(proPrice.amount, proPrice.currency) : "-"}<span className="text-base font-normal text-navy/60"> / month</span></p>
                  <p className="mt-1 text-sm text-navy/70">{pro.tagline}</p>
                  <ul className="mt-4 ml-5 list-disc space-y-2 text-sm text-navy/80">{pro.bullets.map((b) => <li key={b}>{b}</li>)}<li>{pro.monthlyCredits.toLocaleString()} AI credits each billing period</li></ul>
                  <p className="mt-4 text-xs text-navy/60">Each month is a separate payment and nothing renews automatically. The price is an initial proposal and may change.</p>
                  <div className="mt-4">{onSale ? <ButtonLink href="/billing">Upgrade</ButtonLink> : null}</div>
                </section>
              )}
              <section className="rounded-lg border border-dashed border-gold/60 bg-white p-6">
                <p className="text-sm font-semibold text-[#8a5d1c]">Under consideration</p>
                <h2 className="mt-1 text-xl font-semibold">Teams and institutions</h2>
                <p className="mt-2 text-sm text-navy/80">Shared projects, comments and reviews for research teams, and administration for departments. Not built yet, and no pricing is set.</p>
              </section>
            </div>

            {catalog.packs.length > 0 && (
              <>
                <h2 className="mt-12 text-xl font-semibold">Extra AI credits</h2>
                <p className="mt-2 max-w-3xl text-sm text-navy/80">Optional prepaid packs for when you need more than your plan includes. Plan credits are used first. Purchased credits are tracked separately and expire after the period shown. Prices are initial proposals.</p>
                <ul className="mt-3 grid max-w-3xl gap-3 sm:grid-cols-3">
                  {catalog.packs.map((k) => {
                    const p = k.prices.find((x) => x.currency === "USD") ?? k.prices[0];
                    return <li key={k.key} className="rounded-lg border border-line bg-white p-4"><p className="font-semibold text-navy">{k.credits.toLocaleString()} credits</p><p className="text-navy">{p ? formatMoney(p.amount, p.currency) : "-"}</p><p className="mt-1 text-xs text-navy/60">Expire {k.expiryDays} days after purchase</p></li>;
                  })}
                </ul>
              </>
            )}

            <h2 className="mt-12 text-xl font-semibold">How AI credits work</h2>
            <div className="mt-3 max-w-3xl space-y-3 text-sm leading-6 text-navy/80">
              <p>One credit is worth a fixed amount of AI processing cost. A request is charged for what it actually used, including every model step and any paid tools, and nothing is charged when a request fails. Larger and more complex tasks use a stronger model and cost more.</p>
              <p>When credits run out, AI features pause. Your studies, calculators, references, literature search, citation formatting and document generation keep working. You can see your balance, usage and payment history on the Billing page after signing in.</p>
              <p>Payments are processed by Flutterwave, so you can pay by international card or, where UGX prices are offered, Ugandan Mobile Money. A plan or credits are added only after the payment has been confirmed.</p>
            </div>
          </>
        )}
      </Container>
    </PageShell>
  );
}

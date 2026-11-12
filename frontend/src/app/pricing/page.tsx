import type { Metadata } from "next";
import { PageShell } from "@/components/marketing/ui";
import { ButtonLink } from "@/components/ds/button";
import { Card, StatusIndicator } from "@/components/ds/card";
import { Container, PageHeader, Section, SectionHeader } from "@/components/ds/layout";
import { Accordion, FeatureComparison, PricingCard } from "@/components/ds/pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney, loadCatalog, type Catalog } from "@/lib/billing/catalog";
import { acceptingRealPayments, providerInfo } from "@/lib/billing/provider";

export const metadata: Metadata = {
  title: "Pricing",
  description: "ToProt is free to start. Toprot Pro adds larger project limits, the full AI research assistant and monthly AI credits. Pro subscribers can also add optional prepaid credit packs.",
  alternates: { canonical: "/pricing" },
};
// Prices, plans and packs are read from the database, so a change there shows up here within minutes.
export const revalidate = 300;

async function load(): Promise<Catalog | null> {
  try { return await loadCatalog(createAdminClient()); } catch { return null; }
}

export default async function PricingPage() {
  const catalog = await load();
  // Offer a purchase only when real payments are on. With test keys the checkout works only for test cards, so the page says payments are not open yet.
  const onSale = acceptingRealPayments();
  const provider = providerInfo();
  const free = catalog?.plans.find((p) => !p.isPaid);
  const pro = catalog?.plans.find((p) => p.isPaid);
  const proPrice = pro?.prices.find((p) => p.currency === "USD") ?? pro?.prices[0];
  const n = (v: number | null) => (v === null ? "Unlimited" : String(v));

  return (
    <PageShell>
      <PageHeader eyebrow="Pricing" title="Simple pricing for researchers." lead="The research tools are free. Pro adds more projects, the full AI research assistant and a monthly AI credit allowance." />

      {!catalog || !free || !pro ? (
        <Container className="pb-16"><Card><p className="type-body">Pricing is temporarily unavailable. Please check back shortly.</p></Card></Container>
      ) : (
        <>
          <Section spacing="sm">
            <Container width="default">
              <div className="grid items-stretch gap-5 md:grid-cols-2">
                <PricingCard
                  name={free.name} price={formatMoney(0, "USD")} period="forever" description={free.tagline}
                  features={[...free.bullets, `${free.introCredits.toLocaleString()} one-time introductory AI credits`]}
                  cta={<ButtonLink href="/register" variant="secondary" size="lg" className="w-full">Start for free</ButtonLink>}
                />
                <PricingCard
                  highlighted name={pro.name} price={proPrice ? formatMoney(proPrice.amount, proPrice.currency) : "-"} period="per month" description={pro.tagline}
                  features={[...pro.bullets, `${pro.monthlyCredits.toLocaleString()} AI credits each billing period`]}
                  badge={onSale ? <StatusIndicator status="success" compact>Available</StatusIndicator> : <StatusIndicator status="warning" compact>Payments not open yet</StatusIndicator>}
                  cta={onSale
                    ? <ButtonLink href="/billing" size="lg" className="w-full">Upgrade to Pro</ButtonLink>
                    : <ButtonLink href="/register" size="lg" className="w-full">Start free now</ButtonLink>}
                  footnote={<>{onSale ? (provider.autoRenews ? "Billed monthly and renewed automatically until you cancel; you keep Pro to the end of the paid period. " : "Each month is a separate payment and nothing renews automatically. ") : "Paid plans cannot be bought yet. Create a free account and you can upgrade here once payments open. "}The price is an initial proposal and may change.</>}
                />
              </div>
              <p className="type-support mt-5 text-center">
                <span className="font-medium text-ink">Teams and institutions</span> (shared projects, comments and reviews) is under consideration. It is not built, there is no pricing and nothing to sign up for yet.
              </p>
            </Container>
          </Section>

          <Section tone="soft">
            <Container width="default">
              <SectionHeader title="Compare plans" />
              <div className="mt-6">
                <FeatureComparison
                  caption="Free and Pro plans compared" columns={[free.name, pro.name]} highlightColumn={1}
                  rows={[
                    { group: "Research tools", label: "Calculators, with formulas and references", values: [true, true] },
                    { group: "Research tools", label: "Literature search and citation formatting", values: [true, true] },
                    { group: "Workspace", label: "Projects", values: [n(free.maxProjects), n(pro.maxProjects)] },
                    { group: "Workspace", label: "Protocol builder, references, PDFs and writing editor", values: [true, true] },
                    { group: "Workspace", label: "Document generation", values: [true, true] },
                    { group: "AI", label: "AI credits", values: [`${free.introCredits.toLocaleString()} one time`, `${pro.monthlyCredits.toLocaleString()} per month`] },
                    { group: "AI", label: "Protocol review and standard assistant", values: [true, true] },
                    { group: "AI", label: "Full AI research assistant", values: [false, true] },
                    { group: "AI", label: "Extra credit packs", values: [false, true] },
                  ]}
                />
              </div>
            </Container>
          </Section>

          {catalog.packs.length > 0 && (
            <Section spacing="sm">
              <Container width="default">
                <SectionHeader title="Extra AI credits" lead="Optional prepaid packs, available only to active Pro subscribers who need more than their plan includes. Plan credits are used first. Purchased credits are tracked separately and expire after the period shown. Prices are initial proposals." />
                <ul className="mt-6 grid gap-3 sm:grid-cols-3">
                  {catalog.packs.map((k) => {
                    const p = k.prices.find((x) => x.currency === "USD") ?? k.prices[0];
                    return (
                      <li key={k.key}>
                        <Card>
                          <p className="type-card">{k.credits.toLocaleString()} credits</p>
                          <p className="type-stat mt-1">{p ? formatMoney(p.amount, p.currency) : "-"}</p>
                          <p className="type-caption mt-1">Expire {k.expiryDays} days after purchase</p>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              </Container>
            </Section>
          )}

          <Section tone="soft">
            <Container width="narrow">
              <SectionHeader title="Questions" />
              <div className="mt-6">
                <Accordion items={[
                  { q: "Are the calculators really free?", a: "Yes. Every research calculator is free and needs no account. Calculators run in your browser using fixed formulas and do not use AI." },
                  { q: "What are AI credits?", a: "One credit is a fixed amount of AI processing cost. A request is charged for what it actually used, including every model step and any paid tools, and nothing is charged when a request fails. Larger tasks use a stronger model and cost more." },
                  { q: "Can Free users buy extra credits?", a: "No. Extra credit packs are for active Pro subscribers. Free accounts keep their introductory credits and can upgrade when payments open." },
                  { q: "Do unused credits roll over?", a: "Plan credits are for the billing period they belong to. Purchased pack credits are tracked separately and expire after the number of days shown on the pack." },
                  { q: "Can Pro users buy more credits?", a: "Yes. Pro subscribers can add optional prepaid packs. Plan credits are used first, then purchased credits." },
                  { q: "What happens when I cancel?", a: "You keep Pro until the end of the period you paid for. After that your account returns to Free: your studies, references and documents stay, and AI features run on whatever credits you have left." },
                  { q: "What happens when credits run out?", a: "AI features pause. Your studies, calculators, references, literature search, citation formatting and document generation keep working. You can see your balance and usage on the Billing page after signing in." },
                ]} />
              </div>
              <p className="type-caption mt-5">{provider.processorNote} A plan or credits are added only after the payment has been confirmed.</p>
            </Container>
          </Section>
        </>
      )}
    </PageShell>
  );
}

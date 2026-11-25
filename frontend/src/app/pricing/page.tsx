import type { Metadata } from "next";
import { PageShell } from "@/components/marketing/ui";
import { ButtonLink } from "@/components/ds/button";
import { Card, StatusIndicator } from "@/components/ds/card";
import { Container, PageHeader, Section, SectionHeader } from "@/components/ds/layout";
import { Accordion, FeatureComparison, PricingCard } from "@/components/ds/pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney, loadCatalog, type Catalog } from "@/lib/billing/catalog";
import { comparisonTable, planCards, teamTerms, type PlanCard, type TeamTerms } from "@/lib/billing/plan-display";
import { acceptingRealPayments, providerInfo } from "@/lib/billing/provider";

export const metadata: Metadata = {
  title: "Pricing",
  description: "ToProt is free to start. Pro and Advanced add AI credits, more projects and more Data Studio statistics for individual researchers; Teams adds shared projects, datasets and AI credits for research groups.",
  alternates: { canonical: "/pricing" },
};

// Prices, plans and packs are read from the database, so a change there shows up here within minutes.
export const revalidate = 300;

async function load(): Promise<{ catalog: Catalog; team: TeamTerms } | null> {
  try {
    const db = createAdminClient();
    const [catalog, settings] = await Promise.all([
      loadCatalog(db, { includeInactive: true }),
      db.from("billing_settings").select("key, value_num").in("key", ["team_base_paid_seats", "team_seat_monthly_credits"]),
    ]);
    return { catalog, team: teamTerms(settings.data as { key: string; value_num: number }[] | null) };
  } catch { return null; }
}

function cta(c: PlanCard, onSale: boolean) {
  if (c.key === "free") return <ButtonLink href="/register" variant="secondary" size="lg" className="w-full">Start for free</ButtonLink>;
  if (!c.purchasable || !onSale) return <ButtonLink href="/register" variant="secondary" size="lg" className="w-full">Start free now</ButtonLink>;
  if (c.audience === "team") return <ButtonLink href="/teams" size="lg" className="w-full">Set up a team</ButtonLink>;
  return <ButtonLink href="/billing" size="lg" className="w-full">Choose {c.name.replace(/^Toprot /, "")}</ButtonLink>;
}

export default async function PricingPage() {
  const loaded = await load();
  // Offer a purchase only when real payments are on. With test keys the checkout works only for test cards, so the page says payments are not open yet.
  const onSale = acceptingRealPayments();
  const provider = providerInfo();
  const cards = loaded ? planCards(loaded.catalog, loaded.team) : [];
  const table = loaded ? comparisonTable(loaded.catalog, loaded.team) : null;
  const catalog = loaded?.catalog;

  return (
    <PageShell>
      <PageHeader eyebrow="Pricing" title="Simple pricing for researchers." lead="The research tools are free. Pro and Advanced add AI credits, more projects and more Data Studio statistics for individual researchers. Teams adds shared projects, datasets and a shared AI credit pool for research groups." />

      {!catalog || cards.length === 0 || !table ? (
        <Container className="pb-16"><Card><p className="type-body">Pricing is temporarily unavailable. Please check back shortly.</p></Card></Container>
      ) : (
        <>
          <Section spacing="sm">
            <Container width="wide">
              <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-4">
                {cards.map((c) => (
                  <PricingCard
                    key={c.key} highlighted={c.key === "pro"} name={c.name} price={c.price} period={c.period} description={c.tagline}
                    features={[c.credits, c.projects, `Data Studio: ${c.statistics.charAt(0).toLowerCase()}${c.statistics.slice(1)}`, ...(c.collaboration ? [c.collaboration] : []), ...(c.seats ? [c.seats] : [])]}
                    badge={c.key === "free" ? undefined : !c.purchasable ? <StatusIndicator status="neutral" compact>Coming soon</StatusIndicator>
                      : onSale ? <StatusIndicator status="success" compact>Available</StatusIndicator> : <StatusIndicator status="warning" compact>Payments not open yet</StatusIndicator>}
                    cta={cta(c, onSale)}
                    footnote={c.key === "free" ? c.renewal + "." : <>{c.renewal}. {!c.purchasable ? "Not yet open for purchase: checkout opens once payments for this plan have been set up and tested." : onSale ? (c.audience === "team" ? "The team owner subscribes from the team's billing page." : provider.autoRenews ? "Billed monthly and renewed automatically until you cancel." : "Each month is a separate payment; nothing renews automatically.") : "Paid plans cannot be bought yet. Create a free account and you can upgrade once payments open."}</>}
                  />
                ))}
              </div>
              <p className="type-support mt-5 text-center">Personal and team plans are separate. A Teams subscription pays for the team&apos;s seats and shared credit pool; it does not give each member personal credits, and members keep their own personal plan for their own projects.</p>
            </Container>
          </Section>

          <Section tone="soft">
            <Container width="wide">
              <SectionHeader title="Compare plans" lead="Statistical methods depend on the plan that covers the project. Teams has every statistical method in Advanced and adds collaboration." />
              <div className="mt-6">
                <FeatureComparison caption="Free, Pro, Advanced and Teams plans compared" columns={table.columns} highlightColumn={1} rows={table.rows} />
              </div>
            </Container>
          </Section>

          {catalog.packs.length > 0 && (
            <Section spacing="sm">
              <Container width="default">
                <SectionHeader title="Extra AI credits" lead="Optional prepaid packs for active paid subscribers who need more than their plan includes. Plan credits are used first. Purchased credits are tracked separately and expire after the period shown." />
                <ul className="mt-6 grid gap-3 sm:grid-cols-3">
                  {catalog.packs.map((k) => {
                    const p = k.prices.find((x) => x.currency === "USD") ?? k.prices[0];
                    return (
                      <li key={k.key}>
                        <Card>
                          <p className="type-card">{k.credits.toLocaleString("en-US")} credits</p>
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
                  { q: "What are AI credits?", a: "One credit is a fixed amount of AI processing cost (US$0.001). A request is charged for what it actually used, including every model step and any paid tools, and nothing is charged when a request fails. Larger tasks use a stronger model and cost more." },
                  { q: "Do Data Studio analyses use AI credits?", a: "No. Statistical analyses and charts are computed by validated statistical code and never use AI credits; they have their own daily allowance per plan. Only asking the AI analyst to interpret or write up results uses credits." },
                  { q: "Do unused credits roll over?", a: "No. Plan credits belong to the billing period they were given for and expire when it ends; this includes a team's shared credits. Purchased pack credits are tracked separately and expire after the number of days shown on the pack." },
                  { q: "Can I buy extra credits?", a: "Credit packs are for active paid subscribers. Plan credits are used first, then purchased credits. Free accounts keep their introductory credits and can upgrade." },
                  { q: "How do Teams credits work?", a: "Each paid Teams period adds the plan's shared credits to the team's pool, plus extra credits for every paid seat beyond the included seats. Members choose whether their AI requests use the pool or their own credits, and owners and administrators can set team and per-member limits." },
                  { q: "Can I change plans?", a: "You can upgrade at any time; the new plan starts at once and the time you already paid for is kept. A downgrade can be bought once the current paid period ends, so you never lose time you have paid for." },
                  { q: "What happens when I cancel?", a: "You keep your plan until the end of the period you paid for. After that your account returns to Free: your studies, references, datasets and documents stay, and AI features run on whatever credits you have left." },
                  { q: "What happens when credits run out?", a: "AI features pause. Your studies, calculators, references, literature search, Data Studio analyses, citation formatting and document generation keep working. You can see your balance and usage on the Billing page after signing in." },
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

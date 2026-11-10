import type { Metadata } from "next";
import { ButtonLink, Container, PageHeading, PageShell } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "ToProt is free during early access. A paid Researcher Pro plan with more AI credits is planned and not yet on sale.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <PageShell>
      <PageHeading
        eyebrow="Pricing"
        title="Free during early access"
        lead="Everything listed as available on the features page is free today. Paid plans are planned and cannot be purchased yet."
      />
      <Container className="pb-16">
        <div className="grid gap-5 md:grid-cols-3">
          <section className="rounded-lg border-2 border-cobalt bg-white p-6">
            <p className="text-sm font-semibold text-teal-ink">Available now</p>
            <h2 className="mt-1 text-xl font-semibold">Free</h2>
            <p className="mt-2 text-3xl font-semibold">$0</p>
            <ul className="mt-4 ml-5 list-disc space-y-2 text-sm text-navy/80">
              <li>Protocol builder, methodology checks and sample size calculator</li>
              <li>Reference manager (DOI, PubMed ID, title)</li>
              <li>Document generation</li>
              <li>Milestones, deviation log and supervisor review</li>
              <li>A small one-time allowance of AI reviewer questions</li>
            </ul>
            <div className="mt-6">
              <ButtonLink href="/register">Start for free</ButtonLink>
            </div>
          </section>

          <section className="rounded-lg border border-dashed border-gold/60 bg-white p-6">
            <p className="text-sm font-semibold text-[#8a5d1c]">Planned, not yet on sale</p>
            <h2 className="mt-1 text-xl font-semibold">Researcher Pro</h2>
            <p className="mt-2 text-3xl font-semibold">
              $7.99<span className="text-base font-normal text-navy/60"> / month (indicative)</span>
            </p>
            <ul className="mt-4 ml-5 list-disc space-y-2 text-sm text-navy/80">
              <li>2,000 AI credits each billing period</li>
              <li>Unused credits expire at the end of the period</li>
              <li>Everything in Free</li>
            </ul>
            <p className="mt-4 text-xs text-navy/60">
              The price is a hypothesis we intend to test with researchers, and may change. Payments are not enabled yet.
            </p>
          </section>

          <section className="rounded-lg border border-dashed border-gold/60 bg-white p-6">
            <p className="text-sm font-semibold text-[#8a5d1c]">Under consideration</p>
            <h2 className="mt-1 text-xl font-semibold">Teams and institutions</h2>
            <p className="mt-2 text-sm text-navy/80">
              Shared projects, comments and reviews for research teams, and administration for departments. Not built yet,
              and no pricing is set.
            </p>
          </section>
        </div>

        <h2 className="mt-12 text-xl font-semibold">How AI credits work</h2>
        <div className="mt-3 max-w-3xl space-y-3 text-sm leading-6 text-navy/80">
          <p>
            AI features, currently reviewer questions on the protocol quality panel, use credits. A request is charged for
            the processing it actually used, and nothing is charged when a request fails.
          </p>
          <p>
            When credits run out, AI features pause. Your studies, calculators, references and document generation keep
            working. You can see your balance at any time on the AI credits page after signing in.
          </p>
        </div>
      </Container>
    </PageShell>
  );
}

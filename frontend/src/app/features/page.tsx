import type { Metadata } from "next";
import { ButtonLink, Container, PageHeading, PageShell, StatusBadge } from "@/components/marketing/ui";
import { FEATURES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Protocol builder, methodology checks, sample size calculator, reference manager and document generation in ToProt, with a clear list of what is planned but not yet built.",
  alternates: { canonical: "/features" },
};

export default function FeaturesPage() {
  const available = FEATURES.filter((f) => f.status === "available");
  const planned = FEATURES.filter((f) => f.status === "planned");

  return (
    <PageShell>
      <PageHeading
        eyebrow="Features"
        title="What ToProt does today, and what is coming"
        lead="Everything marked Available works now. Planned features are on the roadmap and are not yet built."
      />
      <Container className="pb-16">
        <h2 className="text-xl font-semibold">Available now</h2>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          {available.map((f) => (
            <section key={f.slug} id={f.slug} className="scroll-mt-24 rounded-lg border border-line bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-semibold">{f.name}</h3>
                <StatusBadge status={f.status} />
              </div>
              <p className="mt-2 text-sm text-navy/80">{f.summary}</p>
              <ul className="mt-3 ml-5 list-disc space-y-1 text-sm text-navy/70">
                {f.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <h2 className="mt-12 text-xl font-semibold">Planned</h2>
        <div className="mt-4 grid gap-5 md:grid-cols-3">
          {planned.map((f) => (
            <section key={f.slug} id={f.slug} className="scroll-mt-24 rounded-lg border border-dashed border-gold/60 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold">{f.name}</h3>
                <StatusBadge status={f.status} />
              </div>
              <p className="mt-2 text-sm text-navy/70">{f.summary}</p>
            </section>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/register">Start for free</ButtonLink>
          <ButtonLink href="/examples" variant="secondary">
            Explore sample study
          </ButtonLink>
        </div>
      </Container>
    </PageShell>
  );
}

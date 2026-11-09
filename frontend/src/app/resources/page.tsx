import type { Metadata } from "next";
import { Container, PageHeading, PageShell } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "Resources",
  description: "Free ToProt tools and the research guides we are preparing.",
  alternates: { canonical: "/resources" },
  // Thin until real guides are published; keep it out of search results for now.
  robots: { index: false, follow: true },
};

const PLANNED = [
  "How to write a research protocol",
  "Sample size calculation for cross-sectional studies",
  "How to create a data dictionary",
  "Choosing statistical tests",
  "How to write a statistical analysis plan",
  "Writing research objectives",
];

export default function ResourcesPage() {
  return (
    <PageShell>
      <PageHeading eyebrow="Resources" title="Tools and guides" lead="Free tools you can use today, and guides we are writing." />
      <Container className="pb-16">
        <h2 className="text-xl font-semibold">Available now</h2>
        <ul className="mt-3 ml-5 list-disc space-y-2 text-navy/80">
          <li>
            <a href="/calculator" className="text-teal underline">Sample size calculator</a>: six designs, no account needed.
          </li>
          <li>
            <a href="/examples" className="text-teal underline">Sample study</a>: a fictional study with a downloadable data dictionary.
          </li>
          <li>
            <a href="/docs" className="text-teal underline">Documentation</a>: how to use ToProt.
          </li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">Guides in preparation</h2>
        <p className="mt-2 max-w-2xl text-sm text-navy/70">
          Each guide will be written and checked for accuracy before it is published. We are not publishing placeholder
          articles.
        </p>
        <ul className="mt-3 ml-5 list-disc space-y-1 text-navy/70">
          {PLANNED.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Container>
    </PageShell>
  );
}

import type { Metadata } from "next";
import { Info } from "lucide-react";
import { Container, JsonLd, PageShell } from "@/components/marketing/ui";
import { ToolDirectory } from "@/components/tools/tool-directory";
import { CALCULATORS } from "@/lib/tools/registry";
import { DIRECTORY } from "@/lib/tools/directory";
import { publicSlugFor } from "@/lib/tools/aliases";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Research Tools",
  description:
    "Free research calculators: sample size and power, statistical tests, epidemiology and diagnostic accuracy. Each shows its formula, steps, assumptions and references. No account needed.",
  alternates: { canonical: "/tools" },
};

export default function ToolsPage() {
  return (
    <PageShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "ToProt research tools",
          itemListElement: CALCULATORS.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, url: `${SITE_URL}/tools/${publicSlugFor(c.slug)}` })),
        }}
      />
      <Container className="pb-3 pt-8 sm:pt-10">
        <h1 className="text-2xl font-semibold tracking-tight text-navy sm:text-3xl">Research Toolkit</h1>
        <p className="mt-1.5 max-w-2xl text-base text-navy/75">Practical tools for research design, statistics, and evidence analysis.</p>
        <p className="mt-3 inline-flex max-w-full items-start gap-2 rounded-lg bg-soft px-3 py-2 text-[13px] leading-5 text-navy/80">
          <Info className="mt-0.5 h-4 w-4 flex-none text-cobalt" aria-hidden="true" />
          <span>Research calculators are free and need no account. Tools marked with a lock work inside a study and need a free account.</span>
        </p>
      </Container>
      <Container className="pb-16 pt-3">
        <ToolDirectory items={DIRECTORY} />
        <p className="mt-12 text-xs text-navy/70">
          Calculators run in your browser using fixed formulas. They do not use AI and do not send your inputs anywhere. They are planning aids and are not a
          substitute for review by a qualified statistician.
        </p>
      </Container>
    </PageShell>
  );
}

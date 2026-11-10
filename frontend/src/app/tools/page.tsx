import type { Metadata } from "next";
import { Container, JsonLd, PageHeading, PageShell } from "@/components/marketing/ui";
import { ToolDirectory } from "@/components/tools/tool-directory";
import { ALL_TOOLS, CALCULATORS, toolHref } from "@/lib/tools/registry";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Research Tools",
  description:
    "Free research calculators: sample size and power, statistical tests, epidemiology and diagnostic accuracy. Each shows its formula, steps, assumptions and references. No account needed.",
  alternates: { canonical: "/tools" },
};

export default function ToolsPage() {
  const tools = ALL_TOOLS.map((t) => ({ ...t, href: toolHref(t) }));
  return (
    <PageShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "ToProt research tools",
          itemListElement: CALCULATORS.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, url: `${SITE_URL}/tools/${c.slug}` })),
        }}
      />
      <PageHeading
        eyebrow="Research tools"
        title="Free calculators for study planning and analysis"
        lead="Every calculator is free, needs no account, and shows its formula, working and references."
      />
      <Container className="pb-16">
        <ToolDirectory tools={tools} />
        <p className="mt-10 text-xs text-navy/60">
          Calculators run in your browser using fixed formulas. They do not use AI and do not send your inputs anywhere. They are
          planning aids and are not a substitute for review by a qualified statistician.
        </p>
      </Container>
    </PageShell>
  );
}

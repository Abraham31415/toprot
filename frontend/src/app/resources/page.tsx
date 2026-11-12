import type { Metadata } from "next";
import { BookOpen, Calculator, FileText, FlaskConical, Info, Library, Wrench } from "lucide-react";
import { PageShell } from "@/components/marketing/ui";
import { Container, PageHeader, Section, SectionHeader } from "@/components/ds/layout";
import { ResearchModuleCard } from "@/components/ds/card";
import { GuideBrowser } from "@/components/resources/guide-browser";
import { ARTICLE_CATEGORIES, publishedArticles, readingMinutes } from "@/lib/resources/articles";
import { hubRobots } from "@/lib/resources/seo";
import type { GuideCard } from "@/lib/resources/browse";

export function generateMetadata(): Metadata {
  return {
    title: "Research Guides and Resources",
    description: "Guides on research methodology, biostatistics, epidemiology, literature reviews and academic writing, linked to free calculators and research tools.",
    alternates: { canonical: "/resources" },
    // Stay out of search results until there is at least one reviewed guide to show.
    robots: hubRobots(publishedArticles().length),
  };
}

export default function ResourcesPage() {
  // Only published guides are passed on. Drafts never reach this page, not even their titles.
  const published = publishedArticles();
  const guides: GuideCard[] = published.map((a) => ({
    slug: a.slug, title: a.title, summary: a.summary, category: a.category, keywords: a.keywords, minutes: readingMinutes(a), featured: a.featured, updatedOn: a.updatedOn,
  }));

  return (
    <PageShell>
      <PageHeader
        eyebrow="Resources"
        title="Research guides and learning resources"
        lead="Plain-language guides on study design, statistics and writing, each one linked to the free tools that put it into practice."
      />

      <Container className="pb-4">
        {published.length === 0 && (
          <p role="status" className="mb-8 flex max-w-3xl items-start gap-3 rounded-card border border-info-line bg-info-bg/60 p-4 text-sm text-ink-soft">
            <Info className="mt-0.5 h-4 w-4 flex-none text-primary" aria-hidden="true" />
            <span>
              Guides are published only after a named reviewer has checked the content and every source. None has been published yet. The free tools below already show
              their formulas, assumptions and references.
            </span>
          </p>
        )}
        <GuideBrowser guides={guides} categories={ARTICLE_CATEGORIES} />
      </Container>

      <Section spacing="sm">
        <Container>
          <SectionHeader title="Learn by doing" lead="Every free tool shows its formula, steps, assumptions and references." />
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <li><ResearchModuleCard icon={Wrench} tone="cobalt" title="Research tools" description="Calculators for sample size, statistics and epidemiology" href="/tools" /></li>
            <li><ResearchModuleCard icon={Calculator} tone="teal" title="Sample size calculator" description="Designs from single proportions to survival studies" href="/tools/sample-size-calculator" /></li>
            <li><ResearchModuleCard icon={BookOpen} tone="violet" title="Literature Explorer" description="Search OpenAlex, PubMed and Crossref, free" href="/literature" /></li>
            <li><ResearchModuleCard icon={Library} tone="ocean" title="Citation formatter" description="Format references in common styles, free" href="/citations" /></li>
            <li><ResearchModuleCard icon={FlaskConical} tone="gold" title="Sample study" description="A fictional study with a downloadable data dictionary" href="/examples" /></li>
            <li><ResearchModuleCard icon={FileText} tone="terracotta" title="Documentation" description="How to use ToProt" href="/docs" /></li>
          </ul>
        </Container>
      </Section>
    </PageShell>
  );
}

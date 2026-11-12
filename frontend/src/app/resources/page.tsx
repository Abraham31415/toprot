import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeading, PageShell } from "@/components/marketing/ui";
import { ARTICLE_CATEGORIES, ARTICLES, publishedArticles, readingMinutes } from "@/lib/resources/articles";

export function generateMetadata(): Metadata {
  const hasGuides = publishedArticles().length > 0;
  return {
    title: "Research Guides and Resources",
    description: "Reviewed guides on research methods, study design, sample size, statistics, literature reviews, academic writing, references and reporting, linked to free calculators.",
    alternates: { canonical: "/resources" },
    // Stay out of search results until there is at least one reviewed guide to show.
    robots: hasGuides ? { index: true, follow: true } : { index: false, follow: true },
  };
}

export default function ResourcesPage() {
  const published = publishedArticles();
  const inReview = ARTICLES.filter((a) => !published.includes(a));

  return (
    <PageShell>
      <PageHeading eyebrow="Resources" title="Research guides and tools" lead="Plain-language guides linked to the free calculators you can use today." />
      <Container className="pb-16">
        {published.length > 0 && (
          <div className="space-y-10">
            {ARTICLE_CATEGORIES.map((c) => {
              const items = published.filter((a) => a.category === c.id);
              if (items.length === 0) return null;
              return (
                <section key={c.id} aria-labelledby={`cat-${c.id}`}>
                  <h2 id={`cat-${c.id}`} className="text-xl font-semibold text-navy">{c.name}</h2>
                  <p className="mt-1 text-sm text-navy/65">{c.blurb}</p>
                  <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                    {items.map((a) => (
                      <li key={a.slug}>
                        <Link href={`/resources/${a.slug}`} className="block h-full rounded-lg border border-line bg-white p-4 hover:border-cobalt">
                          <span className="block font-medium text-navy">{a.title}</span>
                          <span className="mt-1 block text-sm text-navy/70">{a.summary}</span>
                          <span className="mt-2 block text-xs text-navy/55">{readingMinutes(a)} minute read</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        <h2 className={`${published.length > 0 ? "mt-12 " : ""}text-xl font-semibold`}>Available now</h2>
        <ul className="mt-3 ml-5 list-disc space-y-2 text-navy/80">
          <li><Link href="/tools" className="text-cobalt underline">Research tools</Link>: free calculators for sample size, power, statistics and epidemiology, with formulas and references.</li>
          <li><Link href="/tools/sample-size-calculator" className="text-cobalt underline">Sample size calculator</Link>: designs from single proportions to survival studies.</li>
          <li><Link href="/literature" className="text-cobalt underline">Literature explorer</Link> and <Link href="/citations" className="text-cobalt underline">citation formatter</Link>: free, no account needed.</li>
          <li><Link href="/examples" className="text-cobalt underline">Sample study</Link>: a fictional study with a downloadable data dictionary.</li>
          <li><Link href="/docs" className="text-cobalt underline">Documentation</Link>: how to use ToProt.</li>
        </ul>

        {inReview.length > 0 && (
          <>
            <h2 className="mt-10 text-xl font-semibold">Guides in review</h2>
            <p className="mt-2 max-w-2xl text-sm text-navy/70">
              Each guide is checked for accuracy and sources before it is published. We do not publish placeholder articles.
            </p>
            <ul className="mt-3 ml-5 list-disc space-y-1 text-navy/70">
              {inReview.map((a) => <li key={a.slug}>{a.title}</li>)}
            </ul>
          </>
        )}
      </Container>
    </PageShell>
  );
}

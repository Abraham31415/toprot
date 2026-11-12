import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { ButtonLink, Container, JsonLd, PageShell } from "@/components/marketing/ui";
import { ToolRunner } from "@/components/tools/tool-runner";
import { CALCULATORS, getCalculator } from "@/lib/tools/registry";
import { SLUG_ALIASES, publicSlugFor } from "@/lib/tools/aliases";
import { allPublicToolSlugs, getSeoPage, toolForPublicSlug } from "@/lib/tools/seo";
import { CATEGORIES } from "@/lib/tools/types";
import { publishedGuidesForTool, readingMinutes } from "@/lib/resources/articles";
import { SITE_URL } from "@/lib/site";

export function generateStaticParams() {
  return allPublicToolSlugs().map((slug) => ({ slug }));
}

/** A link target and label for another calculator, given either its internal or its public slug. */
function toolLink(slug: string): { href: string; label: string } | null {
  const seo = getSeoPage(slug);
  if (seo) return { href: `/tools/${seo.slug}`, label: seo.h1 };
  const c = getCalculator(slug);
  return c ? { href: `/tools/${publicSlugFor(c.slug)}`, label: c.name } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const seo = getSeoPage(slug);
  const t = getCalculator(toolForPublicSlug(slug));
  if (!t) return {};
  const title = seo?.title ?? t.name;
  const description = seo?.description ?? `${t.summary} Free, no account needed. Shows the formula, step-by-step working, assumptions and references.`;
  const path = `/tools/${slug}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    keywords: t.keywords,
    openGraph: { type: "website", title: `${title} | ToProt`, description, url: path },
    twitter: { card: "summary_large_image", title: `${title} | ToProt`, description },
  };
}

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // An old address for a calculator that now has a search-friendly one: send visitors and search engines to the new address.
  if (SLUG_ALIASES[slug]) permanentRedirect(`/tools/${SLUG_ALIASES[slug]}`);
  const seo = getSeoPage(slug);
  const tool = getCalculator(toolForPublicSlug(slug));
  if (!tool) notFound();
  const url = `${SITE_URL}/tools/${slug}`;
  const category = CATEGORIES.find((c) => c.id === tool.category);
  const alsoLinks = (seo?.alsoTools ?? []).map(toolLink).filter((x): x is { href: string; label: string } => !!x);
  const alsoHrefs = new Set(alsoLinks.map((l) => l.href));
  const related = CALCULATORS.filter((c) => c.category === tool.category && c.slug !== tool.slug)
    .map((c) => ({ href: `/tools/${publicSlugFor(c.slug)}`, label: c.name }))
    .filter((l) => !alsoHrefs.has(l.href) && l.href !== `/tools/${slug}`)
    .slice(0, 4);
  const guides = [...new Map([...publishedGuidesForTool(slug), ...publishedGuidesForTool(tool.slug)].map((g) => [g.slug, g])).values()];
  const heading = seo?.h1 ?? tool.name;

  return (
    <PageShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: heading,
          url,
          description: seo?.description ?? tool.summary,
          applicationCategory: "EducationalApplication",
          operatingSystem: "Web",
          isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Research Tools", item: `${SITE_URL}/tools` },
            { "@type": "ListItem", position: 2, name: heading, item: url },
          ],
        }}
      />
      {seo && seo.faqs.length > 0 && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: seo.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
          }}
        />
      )}
      <Container className="pb-16 pt-8">
        <nav aria-label="Breadcrumb" className="print:hidden">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-navy/65">
            <li>
              <Link href="/tools" className="hover:text-cobalt">
                Research Tools
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="h-3.5 w-3.5" />
            </li>
            <li>{category?.name}</li>
          </ol>
        </nav>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-navy sm:text-4xl">{heading}</h1>
        <p className="mt-3 max-w-2xl text-lg text-navy/75">{seo?.lead ?? tool.description}</p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <ToolRunner slug={tool.slug} />

          <aside className="space-y-6 text-sm text-navy/85">
            <section>
              <h2 className="text-base font-semibold text-navy">{tool.formulaLabel ?? "Formula"}</h2>
              <p className="mt-2 rounded-lg border border-line bg-white p-3 font-mono text-xs leading-5">{tool.formula}</p>
            </section>
            <section>
              <h2 className="text-base font-semibold text-navy">Assumptions</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {tool.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="text-base font-semibold text-navy">Limitations</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {tool.limitations.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="text-base font-semibold text-navy">References</h2>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
                {tool.references.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ol>
            </section>
            <p className="rounded-lg bg-soft p-3 text-xs text-navy/80">
              {tool.formulaLabel === "How it works"
                ? "Runs in your browser with fixed rules and templates. No AI, no AI credits, and your inputs are not sent anywhere unless you choose to add them to your own protocol. It is a drafting aid and not a substitute for review by your supervisor, a statistician or your ethics committee."
                : "Runs in your browser with fixed formulas. No AI, no AI credits, and your inputs are not sent anywhere. This is a planning aid and not a substitute for review by a qualified statistician."}
            </p>
          </aside>
        </div>

        {seo && (
          <div className="mt-12 grid max-w-3xl gap-10">
            <section>
              <h2 className="text-xl font-semibold text-navy">When to use this calculator</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-navy/85">
                {seo.whenToUse.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </section>
            <section>
              <h2 className="text-xl font-semibold text-navy">How to use it</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-navy/85">
                {seo.steps.map((x) => <li key={x}>{x}</li>)}
              </ol>
            </section>
            <section>
              <h2 className="text-xl font-semibold text-navy">How to read the result</h2>
              <div className="mt-3 space-y-3 text-navy/85">
                {seo.interpret.map((x) => <p key={x}>{x}</p>)}
              </div>
            </section>
            <section>
              <h2 className="text-xl font-semibold text-navy">Frequently asked questions</h2>
              <dl className="mt-3 space-y-5">
                {seo.faqs.map((f) => (
                  <div key={f.q}>
                    <dt className="font-semibold text-navy">{f.q}</dt>
                    <dd className="mt-1 text-navy/85">{f.a}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        )}

        {guides.length > 0 && (
          <section className="mt-12 print:hidden">
            <h2 className="text-lg font-semibold text-navy">Guides</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {guides.map((g) => (
                <li key={g.slug}>
                  <Link href={`/resources/${g.slug}`} className="block h-full rounded-lg border border-line bg-white p-3 hover:border-cobalt">
                    <span className="block text-sm font-medium text-navy">{g.title}</span>
                    <span className="mt-1 block text-xs text-navy/65">{g.summary} {readingMinutes(g)} min read.</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(alsoLinks.length > 0 || related.length > 0) && (
          <section className="mt-12 print:hidden">
            <h2 className="text-lg font-semibold text-navy">{alsoLinks.length > 0 ? "Related calculators" : "Related tools"}</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[...alsoLinks, ...related].map((r) => (
                <li key={r.href}>
                  <Link href={r.href} className="block h-full rounded-lg border border-line bg-white p-3 text-sm font-medium text-navy hover:border-cobalt">
                    {r.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-12 rounded-xl border border-line bg-white p-5 print:hidden">
          <h2 className="text-lg font-semibold text-navy">Use this in a full research protocol</h2>
          <p className="mt-1 max-w-2xl text-sm text-navy/75">
            A free ToProt account lets you save calculations to a study, build your protocol and objectives, manage references and generate your data dictionary in one place.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href="/register">Create a free account</ButtonLink>
            <Link href="/features" className="inline-flex items-center rounded-md border border-navy/25 px-4 py-2 text-sm font-medium text-navy hover:border-cobalt">See all features</Link>
          </div>
        </section>
      </Container>
    </PageShell>
  );
}

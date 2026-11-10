import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Container, JsonLd, PageShell } from "@/components/marketing/ui";
import { ToolRunner } from "@/components/tools/tool-runner";
import { CALCULATORS, getCalculator } from "@/lib/tools/registry";
import { CATEGORIES } from "@/lib/tools/types";
import { SITE_URL } from "@/lib/site";

export function generateStaticParams() {
  return CALCULATORS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = getCalculator(slug);
  if (!t) return {};
  return {
    title: t.name,
    description: `${t.summary} Free, no account needed. Shows the formula, step-by-step working, assumptions and references.`,
    alternates: { canonical: `/tools/${t.slug}` },
    keywords: t.keywords,
  };
}

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tool = getCalculator(slug);
  if (!tool) notFound();
  const category = CATEGORIES.find((c) => c.id === tool.category);
  const related = CALCULATORS.filter((c) => c.category === tool.category && c.slug !== tool.slug).slice(0, 4);

  return (
    <PageShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: tool.name,
          url: `${SITE_URL}/tools/${tool.slug}`,
          description: tool.summary,
          applicationCategory: "EducationalApplication",
          operatingSystem: "Web",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Research Tools", item: `${SITE_URL}/tools` },
            { "@type": "ListItem", position: 2, name: tool.name, item: `${SITE_URL}/tools/${tool.slug}` },
          ],
        }}
      />
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
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-navy sm:text-4xl">{tool.name}</h1>
        <p className="mt-3 max-w-2xl text-lg text-navy/75">{tool.description}</p>

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

        {related.length > 0 && (
          <section className="mt-12 print:hidden">
            <h2 className="text-lg font-semibold text-navy">Related tools</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/tools/${r.slug}`}
                    className="block h-full rounded-lg border border-line bg-white p-3 text-sm font-medium text-navy hover:border-cobalt"
                  >
                    {r.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Container>
    </PageShell>
  );
}

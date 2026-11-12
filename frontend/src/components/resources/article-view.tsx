import Link from "next/link";
import { ArrowRight, ChevronRight, Clock, ShieldCheck, TriangleAlert, Wrench } from "lucide-react";
import { Container, JsonLd } from "@/components/marketing/ui";
import { Card } from "@/components/ds/card";
import { Blocks } from "./markdown";
import { blockersFor, categoryOf, getArticle, readingMinutes, type Article } from "@/lib/resources/articles";
import { getCalculator, ALL_TOOLS, toolHref } from "@/lib/tools/registry";
import { publicSlugFor } from "@/lib/tools/aliases";
import { getSeoPage } from "@/lib/tools/seo";
import { SITE_NAME, SITE_URL } from "@/lib/site";

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** A link and label for a tool named in a guide, by internal or public slug. Unknown slugs are skipped. */
export function toolLink(slug: string): { href: string; label: string } | null {
  const seo = getSeoPage(slug);
  if (seo) return { href: `/tools/${seo.slug}`, label: seo.h1 };
  const c = getCalculator(slug);
  if (c) return { href: `/tools/${publicSlugFor(c.slug)}`, label: c.name };
  const t = ALL_TOOLS.find((x) => x.slug === slug);
  const href = t ? toolHref(t) : null;
  return t && href ? { href, label: t.name } : null;
}

/** schema.org author: the organisation when the guide is by the ToProt team, otherwise a person. */
export const authorSchema = (author: string) =>
  /^toprot/i.test(author) ? { "@type": "Organization", name: SITE_NAME, url: SITE_URL } : { "@type": "Person", name: author };

export function articleJsonLd(a: Article) {
  const url = `${SITE_URL}/resources/${a.slug}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: a.title,
      description: a.description,
      url,
      mainEntityOfPage: url,
      datePublished: a.publishedOn,
      dateModified: a.updatedOn,
      author: authorSchema(a.author),
      publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
      reviewedBy: a.reviewedBy ? { "@type": "Person", name: a.reviewedBy } : undefined,
      keywords: a.keywords.length ? a.keywords.join(", ") : undefined,
      wordCount: a.words,
      articleSection: categoryOf(a.category)?.name,
      citation: a.sources.map((s) => s.citation),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Resources", item: `${SITE_URL}/resources` },
        { "@type": "ListItem", position: 2, name: categoryOf(a.category)?.name ?? "Guides", item: `${SITE_URL}/resources?category=${a.category}` },
        { "@type": "ListItem", position: 3, name: a.title, item: url },
      ],
    },
  ];
}

export function ArticleView({ article, preview = false }: { article: Article; preview?: boolean }) {
  const category = categoryOf(article.category);
  const tools = article.tools.map(toolLink).filter((x): x is { href: string; label: string } => !!x);
  const related = article.related.map((s) => getArticle(s)).filter((a): a is Article => !!a && (preview || a.status === "published"));
  const blockers = preview ? blockersFor(article) : [];
  const unverified = article.sources.filter((s) => !s.verified).length;

  return (
    <>
      {!preview && articleJsonLd(article).map((d, i) => <JsonLd key={i} data={d} />)}
      <Container className="pb-16 pt-8">
        {preview && (
          <div role="status" className="mb-6 rounded-card border border-warning-line bg-warning-bg p-4 text-sm text-warning-ink">
            <p className="flex items-center gap-2 font-semibold"><TriangleAlert className="h-4 w-4" aria-hidden="true" />Draft preview for administrators</p>
            <p className="mt-1">
              Status: <strong>{article.status.replace("_", " ")}</strong>. Readers cannot see this guide, it is not in the sitemap and it is not indexed.
              {blockers.length > 0 ? " It cannot be published yet:" : " It passes every check and can be published."}
            </p>
            {blockers.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
            <p className="mt-2">Publish with <code>npm run guides -- publish {article.slug} --reviewer &quot;Name&quot;</code>, or edit the front matter in <code>content/guides/{article.slug}.md</code>.</p>
          </div>
        )}

        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
            <li><Link href="/resources" className="hover:text-primary">Resources</Link></li>
            <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
            <li><Link href={`/resources?category=${article.category}`} className="hover:text-primary">{category?.name}</Link></li>
          </ol>
        </nav>

        <div className="mt-4 grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <article className="min-w-0 max-w-3xl">
            <header>
              <p className="type-eyebrow">{category?.name}</p>
              <h1 className="type-page mt-2">{article.title}</h1>
              <p className="type-lead mt-3">{article.summary}</p>
              <dl className="type-support mt-4 flex flex-wrap gap-x-5 gap-y-1">
                <div><dt className="sr-only">Author</dt><dd>By {article.author}</dd></div>
                {article.publishedOn && <div><dt className="inline">Published </dt><dd className="inline"><time dateTime={article.publishedOn}>{longDate(article.publishedOn)}</time></dd></div>}
                <div><dt className="inline">Updated </dt><dd className="inline"><time dateTime={article.updatedOn}>{longDate(article.updatedOn)}</time></dd></div>
                <div className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" /><dt className="sr-only">Reading time</dt><dd>{readingMinutes(article)} min read</dd></div>
              </dl>
              {article.reviewedBy && article.reviewedOn && (
                <p className="type-support mt-2 inline-flex items-center gap-1.5 rounded-full border border-success-line bg-success-bg px-2.5 py-0.5 !text-success-ink">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Reviewed by {article.reviewedBy} on <time dateTime={article.reviewedOn}>{longDate(article.reviewedOn)}</time>
                </p>
              )}
            </header>

            {article.toc.length > 2 && (
              <nav aria-label="On this page" className="mt-6 rounded-card border border-line bg-surface p-4 lg:hidden">
                <p className="type-label">On this page</p>
                <ol className="mt-2 space-y-1 text-sm">{article.toc.map((t) => <li key={t.id}><a href={`#${t.id}`} className="text-ink-soft hover:text-primary hover:underline">{t.text}</a></li>)}</ol>
              </nav>
            )}

            <div className="mt-8 text-base leading-7 text-ink-soft">
              <Blocks blocks={article.blocks} />
            </div>

            <section id="references" aria-labelledby="references-h" className="mt-12 scroll-mt-24">
              <h2 id="references-h" className="text-2xl font-semibold tracking-tight text-ink">References</h2>
              <ol className="mt-4 space-y-2.5 text-sm text-ink-soft">
                {article.sources.map((s, i) => (
                  <li key={s.citation} id={`ref-${i + 1}`} className="flex scroll-mt-24 gap-2">
                    <span className="w-6 flex-none text-ink-muted">{i + 1}.</span>
                    <span>
                      {s.citation}
                      {s.doi && <> <a href={`https://doi.org/${s.doi}`} rel="noopener noreferrer" target="_blank" className="text-primary underline">doi:{s.doi}</a></>}
                      {s.url && !s.doi && <> <a href={s.url} rel="noopener noreferrer" target="_blank" className="text-primary underline">{s.url.replace(/^https?:\/\//, "")}</a></>}
                      {preview && !s.verified && <span className="ml-2 rounded-full border border-warning-line bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-ink">Not verified</span>}
                      {preview && s.note && <span className="block text-xs text-ink-muted">Note: {s.note}</span>}
                    </span>
                  </li>
                ))}
              </ol>
              {preview && unverified > 0 && <p className="mt-3 text-xs text-warning-ink">{unverified} of {article.sources.length} sources are not yet marked verified.</p>}
            </section>

            <p className="mt-8 rounded-control bg-surface-soft p-3 text-xs text-ink-soft">
              This guide is general educational information. It is not a substitute for advice from your supervisor, a statistician or your ethics committee.
            </p>
          </article>

          <aside aria-label="Tools and contents" className="space-y-5 lg:sticky lg:top-24 lg:self-start">
            {article.toc.length > 2 && (
              <nav aria-label="On this page" className="hidden lg:block">
                <p className="type-label">On this page</p>
                <ol className="mt-2 space-y-1.5 border-l border-line text-sm">
                  {article.toc.map((t) => <li key={t.id}><a href={`#${t.id}`} className="-ml-px block border-l border-transparent pl-3 text-ink-soft hover:border-primary hover:text-primary">{t.text}</a></li>)}
                </ol>
              </nav>
            )}
            {tools.length > 0 && (
              <Card padding="md" tone="soft">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Wrench className="h-4 w-4 text-primary" aria-hidden="true" />Try it in ToProt</p>
                <ul className="mt-3 space-y-2">
                  {tools.slice(0, 5).map((t) => (
                    <li key={t.href}><Link href={t.href} className="group flex items-center justify-between gap-2 text-sm font-medium text-ink hover:text-primary">{t.label}<ArrowRight className="h-4 w-4 flex-none text-ink-muted group-hover:text-primary" aria-hidden="true" /></Link></li>
                  ))}
                </ul>
              </Card>
            )}
          </aside>
        </div>

        {related.length > 0 && (
          <section className="mt-12 max-w-3xl" aria-labelledby="related-h">
            <h2 id="related-h" className="text-lg font-semibold text-ink">Related guides</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link href={preview ? `/resources/preview/${r.slug}` : `/resources/${r.slug}`} className="block h-full rounded-card border border-line bg-surface p-3 hover:border-primary">
                    <span className="block text-sm font-medium text-ink">{r.title}</span>
                    <span className="mt-1 block text-xs text-ink-muted">{r.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Container>
    </>
  );
}

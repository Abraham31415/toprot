import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Container, JsonLd } from "@/components/marketing/ui";
import { ARTICLE_CATEGORIES, getArticle, readingMinutes, type Article } from "@/lib/resources/articles";
import { getCalculator } from "@/lib/tools/registry";
import { publicSlugFor } from "@/lib/tools/aliases";
import { getSeoPage } from "@/lib/tools/seo";
import { ALL_TOOLS, toolHref } from "@/lib/tools/registry";
import { SITE_NAME, SITE_URL } from "@/lib/site";

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** A link and label for a tool named in a guide, by internal or public slug. Unknown slugs are skipped. */
function toolLink(slug: string): { href: string; label: string } | null {
  const seo = getSeoPage(slug);
  if (seo) return { href: `/tools/${seo.slug}`, label: seo.h1 };
  const c = getCalculator(slug);
  if (c) return { href: `/tools/${publicSlugFor(c.slug)}`, label: c.name };
  const t = ALL_TOOLS.find((x) => x.slug === slug);
  const href = t ? toolHref(t) : null;
  return t && href ? { href, label: t.name } : null;
}

export function ArticleView({ article, preview = false }: { article: Article; preview?: boolean }) {
  const category = ARTICLE_CATEGORIES.find((c) => c.id === article.category);
  const tools = article.tools.map(toolLink).filter((x): x is { href: string; label: string } => !!x);
  const related = article.related.map((s) => getArticle(s)).filter((a): a is Article => !!a && (preview || a.status === "published"));
  const url = `${SITE_URL}/resources/${article.slug}`;

  return (
    <>
      {!preview && (
        <>
          <JsonLd
            data={{
              "@context": "https://schema.org",
              "@type": "Article",
              headline: article.title,
              description: article.description,
              url,
              mainEntityOfPage: url,
              datePublished: article.reviewedOn,
              dateModified: article.updatedOn,
              author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
              publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
              reviewedBy: article.reviewedBy ? { "@type": "Person", name: article.reviewedBy } : undefined,
              citation: article.sources.map((s) => s.citation),
            }}
          />
          <JsonLd
            data={{
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Resources", item: `${SITE_URL}/resources` },
                { "@type": "ListItem", position: 2, name: article.title, item: url },
              ],
            }}
          />
        </>
      )}
      <Container className="pb-16 pt-8">
        {preview && (
          <p role="status" className="mb-6 rounded-lg border border-gold/50 bg-gold/10 px-4 py-3 text-sm text-[#6f4a14]">
            Draft preview for administrators. This guide is <strong>{article.status === "published" ? "published" : "in review"}</strong>
            {article.status !== "published" ? " and is not visible to the public, in search results or in the sitemap" : ""}. To publish it, check every claim and source, then set its status to
            published and fill in the reviewer and review date in <code>src/lib/resources/articles.ts</code>.
          </p>
        )}
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
            <li><Link href="/resources" className="hover:text-primary">Resources</Link></li>
            <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
            <li>{category?.name}</li>
          </ol>
        </nav>

        <article className="mt-3 max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{article.title}</h1>
          <p className="mt-3 text-lg text-ink-soft">{article.summary}</p>
          <p className="mt-3 text-xs text-ink-muted">
            {readingMinutes(article)} minute read. Updated {longDate(article.updatedOn)}.
            {article.reviewedBy && article.reviewedOn ? ` Reviewed by ${article.reviewedBy} on ${longDate(article.reviewedOn)}.` : ""}
          </p>

          <div className="mt-8 space-y-8 text-base leading-7 text-ink-soft">
            {article.sections.map((s) => (
              <section key={s.heading}>
                <h2 className="text-xl font-semibold text-ink">{s.heading}</h2>
                {s.paragraphs?.map((p) => <p key={p} className="mt-3">{p}</p>)}
                {s.bullets && <ul className="mt-3 list-disc space-y-1.5 pl-5">{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
              </section>
            ))}

            <section>
              <h2 className="text-xl font-semibold text-ink">Sources</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
                {article.sources.map((s) => (
                  <li key={s.citation}>
                    {s.citation}
                    {s.url && <> <a href={s.url} rel="noopener noreferrer" target="_blank" className="text-primary underline">{s.url.replace(/^https?:\/\//, "")}</a></>}
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <p className="mt-8 rounded-lg bg-surface-soft p-3 text-xs text-ink-soft">
            This guide is general educational information. It is not a substitute for advice from your supervisor, a statistician or your ethics committee.
          </p>
        </article>

        {tools.length > 0 && (
          <section className="mt-12 max-w-3xl">
            <h2 className="text-lg font-semibold text-ink">Tools that go with this guide</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {tools.map((t) => (
                <li key={t.href}>
                  <Link href={t.href} className="block h-full rounded-lg border border-line bg-surface p-3 text-sm font-medium text-ink hover:border-primary">{t.label}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {related.length > 0 && (
          <section className="mt-10 max-w-3xl">
            <h2 className="text-lg font-semibold text-ink">Related guides</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link href={preview ? `/resources/preview/${r.slug}` : `/resources/${r.slug}`} className="block h-full rounded-lg border border-line bg-surface p-3 hover:border-primary">
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

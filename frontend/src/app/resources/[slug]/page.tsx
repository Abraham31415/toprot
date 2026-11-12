import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/marketing/ui";
import { ArticleView } from "@/components/resources/article-view";
import { getArticle, isPublished, publishedArticles } from "@/lib/resources/articles";

// Only guides that have been reviewed and published exist here. Anything else is a 404, never a placeholder.
export const dynamicParams = false;

export function generateStaticParams() {
  return publishedArticles().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = getArticle(slug);
  if (!a || !isPublished(a)) return {};
  return {
    title: a.title,
    description: a.description,
    alternates: { canonical: `/resources/${a.slug}` },
    openGraph: { type: "article", title: `${a.title} | ToProt`, description: a.description, url: `/resources/${a.slug}`, modifiedTime: a.updatedOn },
    twitter: { card: "summary_large_image", title: `${a.title} | ToProt`, description: a.description },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = getArticle(slug);
  if (!a || !isPublished(a)) notFound();
  return (
    <PageShell>
      <ArticleView article={a} />
    </PageShell>
  );
}

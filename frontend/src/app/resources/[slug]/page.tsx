import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/marketing/ui";
import { ArticleView } from "@/components/resources/article-view";
import { getArticle, isPublished, publishedArticles } from "@/lib/resources/articles";
import { articleMetadata } from "@/lib/resources/seo";

// Only guides that have been reviewed and published exist here. Anything else is a 404, never a placeholder.
export const dynamicParams = false;

export function generateStaticParams() {
  return publishedArticles().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return articleMetadata(getArticle(slug));
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

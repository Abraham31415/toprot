import type { Metadata } from "next";
import { categoryOf, isPublished, type Article } from "./articles";

export { RENAMED_GUIDES } from "./renamed";

/** Page metadata for a guide. A guide that is not published gets none, so it can never be indexed by mistake. */
export function articleMetadata(a: Article | undefined): Metadata {
  if (!a || !isPublished(a)) return {};
  const url = `/resources/${a.slug}`;
  return {
    title: a.title,
    description: a.description,
    keywords: a.keywords.length ? a.keywords : undefined,
    authors: [{ name: a.author }],
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: `${a.title} | ToProt`,
      description: a.description,
      url,
      publishedTime: a.publishedOn,
      modifiedTime: a.updatedOn,
      authors: [a.author],
      section: categoryOf(a.category)?.name,
      tags: a.keywords,
    },
    twitter: { card: "summary_large_image", title: `${a.title} | ToProt`, description: a.description },
  };
}

/** The hub is indexed only once at least one guide has been published. */
export const hubRobots = (publishedCount: number): Metadata["robots"] =>
  publishedCount > 0 ? { index: true, follow: true } : { index: false, follow: true };

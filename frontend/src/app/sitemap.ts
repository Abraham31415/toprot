import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { allPublicToolSlugs } from "@/lib/tools/seo";
import { publishedArticles } from "@/lib/resources/articles";

// Only indexable public pages. /resources and its guides are listed once at least one guide has been reviewed and published.
const PATHS = ["", "/features", "/how-it-works", "/examples", "/pricing", "/about", "/docs", "/calculator", "/tools", "/literature", "/citations", "/contact", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const articles = publishedArticles();
  const paths = [...PATHS, ...(articles.length > 0 ? ["/resources"] : []), ...allPublicToolSlugs().map((s) => `/tools/${s}`), ...articles.map((a) => `/resources/${a.slug}`)];
  const modified = new Map(articles.map((a) => [`/resources/${a.slug}`, new Date(a.updatedOn)]));
  return paths.map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified: modified.get(p),
    changeFrequency: p === "" || p === "/features" ? "weekly" : "monthly",
    priority: p === "" ? 1 : p === "/calculator" || p === "/tools" || p === "/examples" ? 0.8 : p.startsWith("/tools/") || p.startsWith("/resources") ? 0.7 : 0.6,
  }));
}

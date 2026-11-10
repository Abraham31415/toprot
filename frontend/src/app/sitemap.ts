import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { CALCULATORS } from "@/lib/tools/registry";

// Only indexable public pages. /resources is excluded while it has no published guides.
const PATHS = ["", "/features", "/how-it-works", "/examples", "/pricing", "/about", "/docs", "/calculator", "/tools", "/literature", "/citations", "/contact", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [...PATHS, ...CALCULATORS.map((c) => `/tools/${c.slug}`)];
  return paths.map((p) => ({
    url: `${SITE_URL}${p}`,
    changeFrequency: p === "" || p === "/features" ? "weekly" : "monthly",
    priority: p === "" ? 1 : p === "/calculator" || p === "/tools" || p === "/examples" ? 0.8 : p.startsWith("/tools/") ? 0.7 : 0.6,
  }));
}

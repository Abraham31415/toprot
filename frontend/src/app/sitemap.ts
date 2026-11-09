import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Only indexable public pages. /resources is excluded while it has no published guides.
const PATHS = ["", "/features", "/how-it-works", "/examples", "/pricing", "/about", "/docs", "/calculator", "/contact", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((p) => ({
    url: `${SITE_URL}${p}`,
    changeFrequency: p === "" || p === "/features" ? "weekly" : "monthly",
    priority: p === "" ? 1 : p === "/calculator" || p === "/examples" ? 0.8 : 0.6,
  }));
}

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private, account and utility areas: never crawl.
        disallow: [
          "/dashboard",
          "/studies",
          "/supervisor",
          "/ai-usage",
          "/billing",
          "/admin",
          "/api/billing",
          "/onboarding",
          "/api/",
          "/auth/",
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password",
          "/logout",
          "/status",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

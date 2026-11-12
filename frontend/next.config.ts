import type { NextConfig } from "next";
import { SLUG_ALIASES } from "./src/lib/tools/aliases";
import { RENAMED_GUIDES } from "./src/lib/resources/renamed";

// Headers that are safe for every page. They do not change how any page works: they stop other sites from framing ToProt,
// stop browsers guessing content types, limit what is sent in the Referer header and switch off device features the
// site never uses. A full script policy (CSP with nonces) is a larger change and is not included here.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // PDF.js (inside unpdf) loads its own worker and wasm files, so keep it out of the bundle and load it from node_modules.
  serverExternalPackages: ["unpdf"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Calculators whose public address changed for search: the old address keeps working with a permanent redirect.
  async redirects() {
    return [
      ...Object.entries(SLUG_ALIASES).map(([from, to]) => ({ source: `/tools/${from}`, destination: `/tools/${to}`, permanent: true })),
      // Guides whose address changed: the old address redirects to the new one.
      ...Object.entries(RENAMED_GUIDES).map(([from, to]) => ({ source: `/resources/${from}`, destination: `/resources/${to}`, permanent: true })),
    ];
  },
  // The guide pages that are rendered on request (admin list and draft preview) read Markdown from content/guides at run time, so include it.
  outputFileTracingIncludes: {
    "/admin/guides": ["./content/guides/**/*"],
    "/resources/preview/[slug]": ["./content/guides/**/*"],
  },
};

export default nextConfig;

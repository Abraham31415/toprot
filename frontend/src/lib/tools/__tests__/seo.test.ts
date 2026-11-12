import { describe, expect, it } from "vitest";
import nextConfig from "../../../../next.config";
import sitemap from "@/app/sitemap";
import { SITE_URL } from "@/lib/site";
import { CALCULATORS, getCalculator, toolHref, ALL_TOOLS } from "../registry";
import { SLUG_ALIASES, internalSlugFor, publicSlugFor } from "../aliases";
import { SEO_PAGES, allPublicToolSlugs, getSeoPage, toolForPublicSlug } from "../seo";
import { ARTICLES } from "@/lib/resources/articles";

const REQUESTED = ["sample-size-calculator", "chi-square-calculator", "odds-ratio-calculator", "diagnostic-accuracy-calculator", "statistical-power-calculator"];

describe("search-friendly calculator pages", () => {
  it("has a dedicated page at every address that was asked for", () => {
    const slugs = allPublicToolSlugs();
    for (const s of REQUESTED) expect(slugs, s).toContain(s);
  });

  it("every page runs a calculator that exists, and slugs are unique", () => {
    expect(new Set(SEO_PAGES.map((p) => p.slug)).size).toBe(SEO_PAGES.length);
    for (const p of SEO_PAGES) {
      expect(getCalculator(p.tool), p.slug).toBeDefined();
      expect(toolForPublicSlug(p.slug)).toBe(p.tool);
    }
  });

  it("has a descriptive title, a meta description of sensible length, a heading and FAQs", () => {
    for (const p of SEO_PAGES) {
      expect(p.title.length, `${p.slug} title`).toBeGreaterThan(20);
      expect(p.title.length, `${p.slug} title`).toBeLessThanOrEqual(60);
      expect(p.description.length, `${p.slug} description`).toBeGreaterThanOrEqual(90);
      expect(p.description.length, `${p.slug} description`).toBeLessThanOrEqual(160);
      expect(p.h1.length).toBeGreaterThan(10);
      expect(p.faqs.length, p.slug).toBeGreaterThanOrEqual(4);
      expect(p.whenToUse.length).toBeGreaterThanOrEqual(2);
      expect(p.steps.length).toBeGreaterThanOrEqual(3);
      expect(p.interpret.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("only links to tools and guides that exist", () => {
    for (const p of SEO_PAGES) {
      for (const t of p.alsoTools) expect(getSeoPage(t) ?? getCalculator(t), `${p.slug} -> ${t}`).toBeDefined();
      for (const g of p.guides) expect(ARTICLES.some((a) => a.slug === g), `${p.slug} guide ${g}`).toBe(true);
    }
  });

  it("uses no em dashes in visible text", () => {
    const text = JSON.stringify(SEO_PAGES);
    expect(text).not.toMatch(/—/);
  });

  it("keeps the old internal address working through a permanent redirect, and lists only the new address", async () => {
    for (const [from, to] of Object.entries(SLUG_ALIASES)) {
      expect(getCalculator(from), from).toBeDefined();
      expect(publicSlugFor(from)).toBe(to);
      expect(internalSlugFor(to)).toBe(from);
      expect(allPublicToolSlugs()).toContain(to);
      expect(allPublicToolSlugs()).not.toContain(from);
    }
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({ source: "/tools/chi-square-test", destination: "/tools/chi-square-calculator", permanent: true });
    expect(redirects).toContainEqual({ source: "/tools/diagnostic-test-calculator", destination: "/tools/diagnostic-accuracy-calculator", permanent: true });
  });

  it("gives every calculator exactly one public address, and tool links use it", () => {
    const slugs = allPublicToolSlugs();
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const c of CALCULATORS) expect(slugs).toContain(publicSlugFor(c.slug));
    const chi = ALL_TOOLS.find((t) => t.slug === "chi-square-test")!;
    expect(toolHref(chi)).toBe("/tools/chi-square-calculator");
  });
});

describe("sitemap, robots-related config and security headers", () => {
  it("lists the requested pages and the new addresses, not the old ones, with absolute URLs", () => {
    const urls = sitemap().map((e) => e.url);
    for (const s of REQUESTED) expect(urls).toContain(`${SITE_URL}/tools/${s}`);
    expect(urls).not.toContain(`${SITE_URL}/tools/chi-square-test`);
    expect(urls.every((u) => u.startsWith("https://"))).toBe(true);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("lists no guide that has not been published, and not the preview route", () => {
    const urls = sitemap().map((e) => e.url).join("\n");
    for (const a of ARTICLES.filter((x) => x.status !== "published")) expect(urls).not.toContain(`/resources/${a.slug}`);
    expect(urls).not.toContain("/resources/preview");
  });

  it("sends security headers on every route", async () => {
    const rules = await nextConfig.headers!();
    const h = Object.fromEntries(rules[0].headers.map((x) => [x.key, x.value]));
    expect(rules[0].source).toBe("/:path*");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Referrer-Policy"]).toBeDefined();
    expect(h["Strict-Transport-Security"]).toContain("max-age=");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

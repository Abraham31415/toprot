import { describe, expect, it } from "vitest";
import { ALL_TOOLS, getCalculator } from "@/lib/tools/registry";
import { allPublicToolSlugs, getSeoPage } from "@/lib/tools/seo";
import { linksIn } from "../guide-core.mjs";
import { ARTICLES, ARTICLE_CATEGORIES, blockersFor, isPublished, problemsFor, publishedArticles, publishedGuidesForTool, readingMinutes } from "../articles";

const toolExists = (slug: string) => !!(getSeoPage(slug) ?? getCalculator(slug) ?? ALL_TOOLS.find((t) => t.slug === slug));
const guideExists = (slug: string) => ARTICLES.some((a) => a.slug === slug);

// The pages a guide may link to inside ToProt. A guide that links anywhere else fails this test, so a typo cannot ship as a dead link.
const STATIC_ROUTES = ["/tools", "/literature", "/citations", "/features", "/examples", "/docs", "/calculator", "/register", "/resources", "/pricing"];
function internalLinkOk(href: string): boolean {
  const [path] = href.split("#");
  if (!path) return true;
  if (STATIC_ROUTES.includes(path)) return true;
  const tool = path.match(/^\/tools\/([a-z0-9-]+)$/);
  if (tool) return allPublicToolSlugs().includes(tool[1]);
  const guide = path.match(/^\/resources\/([a-z0-9-]+)$/);
  return !!guide && guideExists(guide[1]);
}

const REQUESTED: [slug: string, category: string][] = [
  ["how-to-write-a-research-protocol", "methodology"],
  ["how-to-choose-a-study-design", "epidemiology"],
  ["how-to-calculate-sample-size", "biostatistics"],
  ["understanding-p-values-and-confidence-intervals", "biostatistics"],
  ["how-to-conduct-a-literature-review", "literature-reviews"],
];

describe("the guide files", () => {
  it("are found and every one parses", () => {
    expect(ARTICLES.length).toBeGreaterThanOrEqual(9);
    expect(new Set(ARTICLES.map((a) => a.slug)).size).toBe(ARTICLES.length);
  });

  it("include the five requested guides, each in the right category and at a useful length", () => {
    for (const [slug, category] of REQUESTED) {
      const a = ARTICLES.find((x) => x.slug === slug);
      expect(a, slug).toBeDefined();
      expect(a!.category).toBe(category);
      expect(a!.words, `${slug} words`).toBeGreaterThanOrEqual(1200);
      expect(a!.toc.length, `${slug} sections`).toBeGreaterThanOrEqual(6);
      expect(a!.sources.length, `${slug} sources`).toBeGreaterThanOrEqual(5);
      expect(readingMinutes(a!)).toBeGreaterThanOrEqual(5);
    }
  });

  it("have no structural problems: slugs, metadata lengths, categories, tools, related guides, dates, em dashes", () => {
    for (const a of ARTICLES) expect(problemsFor(a, { toolExists, guideExists }), a.slug).toEqual([]);
  });

  it("use only known categories, and the hub offers all six", () => {
    for (const a of ARTICLES) expect(ARTICLE_CATEGORIES.some((c) => c.id === a.category), a.slug).toBe(true);
    expect(ARTICLE_CATEGORIES).toHaveLength(6);
  });

  it("link only to pages that exist", () => {
    for (const a of ARTICLES) {
      for (const href of linksIn(a.blocks)) {
        if (/^https?:\/\//.test(href)) continue;
        expect(internalLinkOk(href), `${a.slug} links to ${href}`).toBe(true);
      }
    }
  });

  it("link contextually to working tools and the protocol builder", () => {
    for (const [slug] of REQUESTED) {
      const a = ARTICLES.find((x) => x.slug === slug)!;
      expect(a.tools.length, slug).toBeGreaterThanOrEqual(4);
      expect(linksIn(a.blocks).some((h) => h.startsWith("/tools/") || h.startsWith("/literature") || h.startsWith("/features")), `${slug} body links`).toBe(true);
    }
    const protocol = ARTICLES.find((x) => x.slug === "how-to-write-a-research-protocol")!;
    expect(linksIn(protocol.blocks)).toContain("/features#protocol-builder");
    expect(protocol.tools).toContain("protocol-builder");
  });

  it("contain no placeholder text", () => {
    const text = JSON.stringify(ARTICLES);
    expect(text).not.toMatch(/lorem ipsum|\bTODO\b|\bTBD\b|coming soon/i);
    expect(text).not.toMatch(/—/);
  });

  it("cite sources with real-looking identifiers, and never mark a source verified without a way to check it", () => {
    for (const a of ARTICLES) {
      for (const s of a.sources) {
        if (s.doi) expect(s.doi, `${a.slug} doi`).toMatch(/^10\.\d{4,9}\/\S+$/);
        if (s.verified) expect(!!(s.doi || s.url || s.note), `${a.slug}: ${s.citation.slice(0, 40)}`).toBe(true);
      }
    }
  });

  it("flag the sources that were not checked, so an editor can find them", () => {
    const flagged = ARTICLES.flatMap((a) => a.sources.filter((s) => !s.verified).map((s) => ({ a: a.slug, s })));
    expect(flagged.length).toBeGreaterThan(0);
    for (const { a, s } of flagged) expect(s.note, `${a}: ${s.citation.slice(0, 40)}`).toBeTruthy();
  });
});

describe("publication status", () => {
  it("shows no guide to readers until a person has reviewed it: every guide here is a draft", () => {
    for (const a of ARTICLES) {
      expect(a.status, a.slug).not.toBe("published");
      expect(isPublished(a), a.slug).toBe(false);
      expect(a.reviewedBy, a.slug).toBeUndefined();
    }
    expect(publishedArticles()).toEqual([]);
  });

  it("explains what blocks each draft", () => {
    for (const [slug] of REQUESTED) {
      const b = blockersFor(ARTICLES.find((x) => x.slug === slug)!).join(" ");
      expect(b).toMatch(/reviewer/);
    }
  });

  it("shows only published guides next to a tool", () => {
    expect(publishedGuidesForTool("sample-size-calculator")).toEqual([]);
  });

  it("does not credit an AI-assisted draft to a named reviewer", () => {
    for (const a of ARTICLES) expect(a.author).toMatch(/AI-assisted draft, not yet reviewed/);
  });
});

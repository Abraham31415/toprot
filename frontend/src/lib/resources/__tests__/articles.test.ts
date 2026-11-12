import { describe, expect, it } from "vitest";
import { ALL_TOOLS, getCalculator } from "@/lib/tools/registry";
import { getSeoPage } from "@/lib/tools/seo";
import { ARTICLES, ARTICLE_CATEGORIES, isPublished, publishedArticles, publishedGuidesForTool, readingMinutes, wordCount, type Article } from "../articles";

const toolExists = (slug: string) => !!(getSeoPage(slug) ?? getCalculator(slug) ?? ALL_TOOLS.find((t) => t.slug === slug));

describe("research guides", () => {
  it("covers every category the resource center promises", () => {
    for (const c of ARTICLE_CATEGORIES) expect(ARTICLES.some((a) => a.category === c.id), c.id).toBe(true);
  });

  it("has unique slugs, valid categories and sensible metadata", () => {
    expect(new Set(ARTICLES.map((a) => a.slug)).size).toBe(ARTICLES.length);
    for (const a of ARTICLES) {
      expect(a.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(ARTICLE_CATEGORIES.some((c) => c.id === a.category), a.slug).toBe(true);
      expect(a.description.length, `${a.slug} description`).toBeGreaterThanOrEqual(90);
      expect(a.description.length, `${a.slug} description`).toBeLessThanOrEqual(160);
      expect(a.title.length).toBeLessThanOrEqual(70);
      expect(a.updatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("is substantial, sourced, and has no placeholder text", () => {
    for (const a of ARTICLES) {
      expect(wordCount(a), `${a.slug} words`).toBeGreaterThanOrEqual(300);
      expect(a.sections.length, a.slug).toBeGreaterThanOrEqual(4);
      expect(a.sources.length, `${a.slug} sources`).toBeGreaterThanOrEqual(2);
      for (const s of a.sources) expect(s.citation.length).toBeGreaterThan(30);
      expect(readingMinutes(a)).toBeGreaterThanOrEqual(1);
    }
    const text = JSON.stringify(ARTICLES);
    expect(text).not.toMatch(/lorem ipsum|TODO|TBD|placeholder|coming soon/i);
    expect(text).not.toMatch(/—/);
  });

  it("connects every guide to tools and to other guides that exist", () => {
    for (const a of ARTICLES) {
      expect(a.tools.length, a.slug).toBeGreaterThan(0);
      for (const t of a.tools) expect(toolExists(t), `${a.slug} -> tool ${t}`).toBe(true);
      for (const r of a.related) expect(ARTICLES.some((x) => x.slug === r) && r !== a.slug, `${a.slug} -> ${r}`).toBe(true);
    }
  });

  it("never publishes a guide automatically: every guide is in review until a person signs it off", () => {
    for (const a of ARTICLES) {
      if (a.status === "published") {
        expect(a.reviewedBy, `${a.slug} reviewer`).toBeTruthy();
        expect(a.reviewedOn, `${a.slug} review date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(a.sources.length).toBeGreaterThan(0);
      }
    }
    // The text in this repository is a draft: a published guide needs a named reviewer, which no draft here has.
    for (const a of ARTICLES.filter((x) => x.status === "in_review")) expect(isPublished(a)).toBe(false);
  });

  it("treats a guide as published only with status, reviewer, review date and sources together", () => {
    const base: Article = { ...ARTICLES[0], status: "published", reviewedBy: "A. Reviewer", reviewedOn: "2026-11-20" };
    expect(isPublished(base)).toBe(true);
    expect(isPublished({ ...base, reviewedBy: undefined })).toBe(false);
    expect(isPublished({ ...base, reviewedOn: undefined })).toBe(false);
    expect(isPublished({ ...base, sources: [] })).toBe(false);
    expect(isPublished({ ...base, status: "in_review" })).toBe(false);
    expect(publishedArticles().every(isPublished)).toBe(true);
  });

  it("shows only published guides next to a tool", () => {
    expect(publishedGuidesForTool("sample-size-calculator")).toEqual(publishedArticles().filter((a) => a.tools.includes("sample-size-calculator")));
  });
});

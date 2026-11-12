import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Blocks } from "../markdown";
import { ArticleView, articleJsonLd, authorSchema } from "../article-view";
import { GuideBrowser } from "../guide-browser";
import { ARTICLES, ARTICLE_CATEGORIES, type Article } from "@/lib/resources/articles";
import { parseGuide, parseMarkdown } from "@/lib/resources/guide-core.mjs";
import { articleMetadata, hubRobots, RENAMED_GUIDES } from "@/lib/resources/seo";
import { guideText } from "@/lib/resources/__tests__/fixtures";
import nextConfig from "../../../../next.config";

const render = (md: string) => renderToStaticMarkup(createElement(Blocks, { blocks: parseMarkdown(md) as never }));

const PUBLISHED = parseGuide("a-published-guide", guideText({
  status: "published", reviewedBy: "Dr. Reviewer", reviewedOn: "2026-11-20", publishedOn: "2026-11-21", author: "Dr. Writer", tools: "[sample-size-calculator]",
  keywords: "[sample size, power]", featured: "true",
}, "Text.\n\n## Third heading\n\nMore text.")) as unknown as Article;
const DRAFT = parseGuide("a-draft-guide", guideText({ author: "ToProt editorial team (AI-assisted draft, not yet reviewed)" }).replace(/verified: true/, "verified: false")) as unknown as Article;

describe("rendering Markdown", () => {
  it("renders headings with anchors, lists, tables, equations, callouts and links", () => {
    const html = render("## A section\n\nText with [an internal link](/tools) and [an outside link](https://example.org) and [1].\n\n- one\n- two\n\n| H |\n|---|\n| cell |\n\n$$\nn = Z² × p / d²\n$$\n\n> **Worked example**\n>\n> Inside.");
    expect(html).toContain('<h2 id="a-section"');
    expect(html).toContain('href="/tools"');
    expect(html).toMatch(/href="https:\/\/example\.org"[^>]*rel="noopener noreferrer"/);
    expect(html).toContain('href="#ref-1"');
    expect(html).toContain("<li><span>one</span></li>");
    expect(html).toContain('<th scope="col"');
    expect(html).toContain('role="math"');
    expect(html).toContain("n = Z² × p / d²");
    expect(html).toContain("<aside");
    expect(html).toContain("Worked example");
  });

  it("never lets text in a guide add markup or scripts", () => {
    const html = render("Plain text <script>alert(1)</script> and <img src=x onerror=alert(2)>.");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("an article page", () => {
  const html = renderToStaticMarkup(createElement(ArticleView, { article: PUBLISHED }));

  it("has one h1, structured h2 headings, a table of contents and a references list", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h2 id="first-heading"');
    expect(html).toContain('aria-label="On this page"');
    expect(html).toContain('id="ref-1"');
    expect(html).toContain("doi.org/10.1000/test1");
  });

  it("shows author, publication, update and review dates", () => {
    expect(html).toContain("By Dr. Writer");
    expect(html).toContain('<time dateTime="2026-11-21">');
    expect(html).toContain('<time dateTime="2026-11-12">');
    expect(html).toContain("Reviewed by Dr. Reviewer");
  });

  it("links to the tools named in the guide", () => {
    expect(html).toContain("Try it in ToProt");
    expect(html).toContain('href="/tools/sample-size-calculator"');
  });

  it("includes structured data for the article and its breadcrumbs", () => {
    expect(html).toContain("application/ld+json");
    const [article, crumbs] = articleJsonLd(PUBLISHED);
    expect(article["@type"]).toBe("Article");
    expect(article.headline).toBe(PUBLISHED.title);
    expect(article.datePublished).toBe("2026-11-21");
    expect(article.dateModified).toBe("2026-11-12");
    expect(article.author).toEqual({ "@type": "Person", name: "Dr. Writer" });
    expect(article.reviewedBy).toEqual({ "@type": "Person", name: "Dr. Reviewer" });
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    expect(crumbs.itemListElement).toHaveLength(3);
    expect(authorSchema("ToProt editorial team")["@type"]).toBe("Organization");
  });

  it("marks a draft preview clearly, lists what blocks it and adds no structured data", () => {
    const draft = renderToStaticMarkup(createElement(ArticleView, { article: DRAFT, preview: true }));
    expect(draft).toContain("Draft preview for administrators");
    expect(draft).toContain("Readers cannot see this guide");
    expect(draft).toContain("Name the reviewer");
    expect(draft).toContain("Not verified");
    expect(draft).toContain("npm run guides -- publish a-draft-guide");
    expect(draft).not.toContain("application/ld+json");
    expect(draft).not.toContain("Reviewed by");
  });
});

describe("the Resources hub", () => {
  const card = (a: Article) => ({ slug: a.slug, title: a.title, summary: a.summary, category: a.category, keywords: a.keywords, minutes: 6, featured: a.featured, updatedOn: a.updatedOn });

  it("with nothing published shows no guide and no search, and says each category has none", () => {
    const html = renderToStaticMarkup(createElement(GuideBrowser, { guides: [], categories: ARTICLE_CATEGORIES }));
    for (const c of ARTICLE_CATEGORIES) expect(html).toContain(c.name);
    expect(html.match(/No published guides yet/g)).toHaveLength(ARTICLE_CATEGORIES.length);
    expect(html).not.toContain('role="search"');
    expect(html).not.toContain("/resources/");
    for (const a of ARTICLES) expect(html).not.toContain(a.title);
  });

  it("with a published guide shows search, a featured card and a link to it", () => {
    const html = renderToStaticMarkup(createElement(GuideBrowser, { guides: [card(PUBLISHED)], categories: ARTICLE_CATEGORIES }));
    expect(html).toContain('role="search"');
    expect(html).toContain("Featured guides");
    expect(html).toContain('href="/resources/a-published-guide"');
    expect(html).toContain("1 guide");
  });

  it("is not indexed until something is published", () => {
    expect(hubRobots(0)).toEqual({ index: false, follow: true });
    expect(hubRobots(3)).toEqual({ index: true, follow: true });
  });
});

describe("SEO metadata", () => {
  it("gives a published guide a title, description, canonical address, article dates and author", () => {
    const m = articleMetadata(PUBLISHED);
    expect(m.title).toBe(PUBLISHED.title);
    expect(m.description).toBe(PUBLISHED.description);
    expect(m.alternates?.canonical).toBe("/resources/a-published-guide");
    expect(m.authors).toEqual([{ name: "Dr. Writer" }]);
    const og = m.openGraph as { type: string; publishedTime: string; modifiedTime: string; section: string; tags: string[] };
    expect(og.type).toBe("article");
    expect(og.publishedTime).toBe("2026-11-21");
    expect(og.modifiedTime).toBe("2026-11-12");
    expect(og.section).toBe("Research Methodology");
    expect(og.tags).toEqual(["sample size", "power"]);
    expect(m.description!.length).toBeLessThanOrEqual(160);
  });

  it("gives a draft or an unknown guide no metadata, so it cannot be indexed", () => {
    expect(articleMetadata(DRAFT)).toEqual({});
    expect(articleMetadata(undefined)).toEqual({});
  });
});

describe("redirects for renamed guides", () => {
  it("send every old address to a guide that exists", async () => {
    const rules = await nextConfig.redirects!();
    for (const [from, to] of Object.entries(RENAMED_GUIDES)) {
      expect(ARTICLES.some((a) => a.slug === to), to).toBe(true);
      expect(rules).toContainEqual({ source: `/resources/${from}`, destination: `/resources/${to}`, permanent: true });
    }
  });
  it("keeps the redirects for renamed calculators", async () => {
    const rules = await nextConfig.redirects!();
    expect(rules.some((r) => r.source.startsWith("/tools/"))).toBe(true);
  });
});

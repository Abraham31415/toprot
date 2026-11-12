import { describe, expect, it, vi } from "vitest";
import { parseGuide } from "@/lib/resources/guide-core.mjs";
import { guideText } from "@/lib/resources/__tests__/fixtures";

// The guide route is tested with a controlled list: one published guide and one draft. The real files are all drafts.
vi.mock("@/lib/resources/articles", async (original) => {
  const real = await original<typeof import("@/lib/resources/articles")>();
  const core = await import("@/lib/resources/guide-core.mjs");
  const { guideText: make } = await import("@/lib/resources/__tests__/fixtures");
  const pub = core.parseGuide("live-guide", make({ status: "published", reviewedBy: "Dr. R", reviewedOn: "2026-11-20", publishedOn: "2026-11-21" }));
  const draft = core.parseGuide("draft-guide", make({}));
  const list = [pub, draft];
  return {
    ...real,
    ARTICLES: list,
    getArticle: (s: string) => list.find((a) => a.slug === s),
    isPublished: (a: { status: string }) => a.status === "published" && a === pub,
    publishedArticles: () => [pub],
  };
});

describe("the guide route", async () => {
  const page = await import("../[slug]/page");

  it("builds pages only for published guides and refuses anything else", () => {
    expect(page.dynamicParams).toBe(false);
    expect(page.generateStaticParams()).toEqual([{ slug: "live-guide" }]);
  });

  it("returns a 404 for a draft and for an unknown slug, never a placeholder", async () => {
    await expect(page.default({ params: Promise.resolve({ slug: "draft-guide" }) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await expect(page.default({ params: Promise.resolve({ slug: "nope" }) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it("renders a published guide and gives it metadata, but gives a draft none", async () => {
    const element = await page.default({ params: Promise.resolve({ slug: "live-guide" }) });
    expect(element).toBeTruthy();
    const meta = await page.generateMetadata({ params: Promise.resolve({ slug: "live-guide" }) });
    expect(meta.title).toBe("A guide for the tests");
    expect(await page.generateMetadata({ params: Promise.resolve({ slug: "draft-guide" }) })).toEqual({});
  });

  it("lists a published guide in the sitemap and leaves out the draft", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    const urls = sitemap().map((e) => e.url).join("\n");
    expect(urls).toContain("/resources/live-guide");
    expect(urls).toContain("/resources\n");
    expect(urls).not.toContain("draft-guide");
    expect(parseGuide("x", guideText()).status).toBe("draft");
  });
});

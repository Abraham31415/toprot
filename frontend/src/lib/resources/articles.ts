// Research guides for the public Resources section.
//
// The guides are Markdown files in frontend/content/guides, one per guide, so they are version controlled and reviewed like code.
// This module reads them. Nothing is published automatically: a guide is visible to readers, in the sitemap and in search results only
// when its status is "published" AND it passes the publication gate in guide-core.mjs (named reviewer and dates, at least three
// sources, every source verified, no [VERIFY] markers). Drafts can be read by administrators at /resources/preview/<slug> and are
// listed with their blockers at /admin/guides.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIES, isPublishedGuide, parseGuide, publishBlockers, readingMinutesOf, structureProblems } from "./guide-core.mjs";

export type ArticleCategory = "methodology" | "biostatistics" | "epidemiology" | "literature-reviews" | "academic-writing" | "data-management";
export type ArticleStatus = "draft" | "in_review" | "published";
export type Source = { citation: string; doi?: string; url?: string; verified: boolean; note?: string };

export type Block =
  | { type: "heading"; level: 2 | 3; text: string; id: string }
  | { type: "p"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "math" | "code"; text: string }
  | { type: "callout"; title: string | null; blocks: Block[] }
  | { type: "rule" };

export type Article = {
  slug: string;
  title: string;
  /** Meta description, 90 to 160 characters. */
  description: string;
  summary: string;
  category: ArticleCategory;
  status: ArticleStatus;
  author: string;
  reviewedBy?: string;
  /** Date a named person reviewed the guide (YYYY-MM-DD). */
  reviewedOn?: string;
  publishedOn?: string;
  /** Date the text was last changed (YYYY-MM-DD). */
  updatedOn: string;
  featured: boolean;
  keywords: string[];
  sources: Source[];
  /** Calculator or tool slugs this guide links to. */
  tools: string[];
  /** Other guide slugs. */
  related: string[];
  blocks: Block[];
  toc: { id: string; text: string }[];
  words: number;
};

export const ARTICLE_CATEGORIES = CATEGORIES as { id: ArticleCategory; name: string; blurb: string; icon: string }[];

const DIR = join(process.cwd(), "content", "guides");

function load(): Article[] {
  let files: string[] = [];
  try { files = readdirSync(DIR).filter((f) => f.endsWith(".md")).sort(); } catch { return []; }
  return files.map((f) => {
    const slug = f.replace(/\.md$/, "");
    try {
      return parseGuide(slug, readFileSync(join(DIR, f), "utf8")) as Article;
    } catch (e) {
      throw new Error(`Guide ${f} could not be read: ${(e as Error).message}`);
    }
  });
}

export const ARTICLES: Article[] = load();

const bySlug = new Map(ARTICLES.map((a) => [a.slug, a]));

export const getArticle = (slug: string): Article | undefined => bySlug.get(slug);
export const isPublished = (a: Article): boolean => isPublishedGuide(a);
export const blockersFor = (a: Article): string[] => publishBlockers(a);
export const problemsFor = (a: Article, ctx?: Parameters<typeof structureProblems>[1]): string[] => structureProblems(a, ctx);
export const publishedArticles = (): Article[] => ARTICLES.filter(isPublished);
/** Published guides that link to a given tool (internal or public slug). */
export const publishedGuidesForTool = (toolSlug: string): Article[] => publishedArticles().filter((a) => a.tools.includes(toolSlug));
export const wordCount = (a: Article): number => a.words;
export const readingMinutes = (a: Article): number => readingMinutesOf(a.words);
export const categoryOf = (id: string) => ARTICLE_CATEGORIES.find((c) => c.id === id);

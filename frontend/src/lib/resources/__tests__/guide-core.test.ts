import { describe, expect, it } from "vitest";
import {
  CATEGORIES, isPublishedGuide, linksIn, parseFrontMatter, parseGuide, parseInline, parseMarkdown, publishBlockers, setFrontMatter, slugify, structureProblems, tocOf,
} from "../guide-core.mjs";
import { guideText, WORDS } from "./fixtures";

describe("front matter", () => {
  it("reads scalars, booleans, inline lists and lists of mappings", () => {
    const { data, body } = parseFrontMatter(`---\ntitle: Hello: world\nfeatured: true\ntools: [a, b-c, "d"]\nsources:\n  - citation: "X. Y: z."\n    doi: 10.1/x\n    verified: false\n  - citation: "Second source."\n    verified: true\n---\nBody text`);
    expect(data.title).toBe("Hello: world");
    expect(data.featured).toBe(true);
    expect(data.tools).toEqual(["a", "b-c", "d"]);
    expect(data.sources).toEqual([{ citation: "X. Y: z.", doi: "10.1/x", verified: false }, { citation: "Second source.", verified: true }]);
    expect(body).toBe("Body text");
  });
  it("rejects a file with no front matter and lines it cannot read, instead of guessing", () => {
    expect(() => parseFrontMatter("No front matter here")).toThrow(/front matter/i);
    expect(() => parseFrontMatter("---\nthis is not a pair\n---\nbody")).toThrow(/not "key: value"/);
  });
  it("edits keys in place and adds missing ones before the sources", () => {
    const text = guideText();
    const out = setFrontMatter(text, { status: "published", reviewedBy: "Dr. R", featured: "true" });
    const { data } = parseFrontMatter(out);
    expect(data.status).toBe("published");
    expect(data.reviewedBy).toBe("Dr. R");
    expect(data.featured).toBe(true);
    expect(data.title).toBe("A guide for the tests");
    expect(out.indexOf("reviewedBy")).toBeLessThan(out.indexOf("sources:"));
    expect((data.sources as unknown[]).length).toBe(3);
  });
});

describe("markdown", () => {
  it("parses headings with unique ids, paragraphs, lists, tables, equations, code and rules", () => {
    const blocks = parseMarkdown("## Same\n\ntext\n\n## Same\n\n- a\n- b\n\n1. one\n2. two\n\n| H1 | H2 |\n|---|---|\n| a | b |\n\n$$\nn = Z² × p / d²\n$$\n\n```\ncode here\n```\n\n---\n");
    expect(blocks.filter((b) => b.type === "heading").map((b) => b.id)).toEqual(["same", "same-2"]);
    expect(blocks.find((b) => b.type === "ul").items).toEqual(["a", "b"]);
    expect(blocks.find((b) => b.type === "ol").items).toEqual(["one", "two"]);
    const table = blocks.find((b) => b.type === "table");
    expect(table.header).toEqual(["H1", "H2"]);
    expect(table.rows).toEqual([["a", "b"]]);
    expect(blocks.find((b) => b.type === "math").text).toBe("n = Z² × p / d²");
    expect(blocks.find((b) => b.type === "code").text).toBe("code here");
    expect(blocks.some((b) => b.type === "rule")).toBe(true);
  });
  it("parses a callout with a title and separate paragraphs", () => {
    const [c] = parseMarkdown("> **Worked example**\n>\n> First.\n>\n> Second.");
    expect(c.type).toBe("callout");
    expect(c.title).toBe("Worked example");
    expect(c.blocks.map((b: { text: string }) => b.text)).toEqual(["First.", "Second."]);
  });
  it("refuses a level-one heading, because the title comes from the front matter", () => {
    expect(() => parseMarkdown("# Title")).toThrow(/## for headings/);
  });
  it("builds the table of contents from level-two headings", () => {
    expect(tocOf(parseMarkdown("## A\n\n### Sub\n\n## B"))).toEqual([{ id: "a", text: "A" }, { id: "b", text: "B" }]);
    expect(slugify("What is a p-value?")).toBe("what-is-a-p-value");
  });
  it("parses inline formatting, links and citations", () => {
    const t = parseInline("See **bold**, *italic*, `code`, [a link](/tools) and [1,2] or [3].");
    expect(t.map((x) => x.type)).toEqual(["text", "strong", "text", "em", "text", "code", "text", "link", "text", "cite", "text", "cite", "text"]);
    expect(t.find((x) => x.type === "link")!.href).toBe("/tools");
    expect(t.filter((x) => x.type === "cite").map((x) => x.nums)).toEqual([["1", "2"], ["3"]]);
  });
  it("lists the links in a body, including inside callouts and lists", () => {
    const blocks = parseMarkdown("Text [a](/one).\n\n- item [b](/two)\n\n> **Note**\n>\n> [c](https://example.org/x)");
    expect(linksIn(blocks)).toEqual(["/one", "/two", "https://example.org/x"]);
  });
});

describe("the publication gate", () => {
  const ready = { reviewedBy: "Dr. Reviewer", reviewedOn: "2026-11-20", publishedOn: "2026-11-21", status: "published" };

  it("lets a complete, reviewed guide be published", () => {
    const g = parseGuide("a-guide", guideText(ready));
    expect(publishBlockers(g)).toEqual([]);
    expect(isPublishedGuide(g)).toBe(true);
  });

  it("is never published by status alone", () => {
    const g = parseGuide("a-guide", guideText({ status: "published" }));
    expect(g.status).toBe("published");
    expect(isPublishedGuide(g)).toBe(false);
    expect(publishBlockers(g).join(" ")).toMatch(/reviewer/);
  });

  it("is blocked by each missing requirement on its own", () => {
    expect(publishBlockers(parseGuide("g", guideText({ ...ready, reviewedBy: "" }))).join(" ")).toMatch(/reviewer/);
    expect(publishBlockers(parseGuide("g", guideText({ ...ready, reviewedOn: "" }))).join(" ")).toMatch(/review date/);
    expect(publishBlockers(parseGuide("g", guideText({ ...ready, publishedOn: "" }))).join(" ")).toMatch(/publication date/);
    expect(publishBlockers(parseGuide("g", guideText({ ...ready, author: "" }))).join(" ")).toMatch(/author/);
    expect(publishBlockers(parseGuide("g", guideText({ ...ready, reviewedOn: "20 Nov" }))).join(" ")).toMatch(/review date/);
  });

  it("is blocked by an unverified source", () => {
    const text = guideText(ready).replace("verified: true", "verified: false");
    const g = parseGuide("g", text);
    expect(g.sources.filter((s: { verified: boolean }) => !s.verified)).toHaveLength(1);
    expect(isPublishedGuide(g)).toBe(false);
    expect(publishBlockers(g).join(" ")).toMatch(/not marked verified/);
  });

  it("is blocked by a [VERIFY] marker, too few sources and too little text", () => {
    expect(isPublishedGuide(parseGuide("g", guideText(ready, "A claim [VERIFY: check the year] stays.")))).toBe(false);
    const fewSources = guideText(ready).replace(/  - citation: "Author 3[\s\S]*?verified: true\n/, "");
    expect(publishBlockers(parseGuide("g", fewSources)).join(" ")).toMatch(/at least three sources/);
    const short = guideText(ready).replace(WORDS, "Short.");
    expect(publishBlockers(parseGuide("g", short)).join(" ")).toMatch(/under 800 words/);
  });

  it("checks structure: slug, description length, category, status, em dashes and links to guides and tools", () => {
    const g = parseGuide("Bad Slug", guideText({ category: "nope", status: "weird", description: "Too short." }));
    const p = structureProblems(g).join("\n");
    expect(p).toMatch(/lowercase slug/);
    expect(p).toMatch(/Description must be/);
    expect(p).toMatch(/Unknown category/);
    expect(p).toMatch(/Unknown status/);
    const ok = parseGuide("ok", guideText({ tools: "[sample-size-calculator, no-such-tool]", related: "[ok, missing]" }));
    const q = structureProblems(ok, { toolExists: (s: string) => s === "sample-size-calculator", guideExists: (s: string) => s === "ok" }).join("\n");
    expect(q).toMatch(/Unknown tool "no-such-tool"/);
    expect(q).toMatch(/Unknown related guide "ok"/);
    expect(q).toMatch(/Unknown related guide "missing"/);
    expect(structureProblems(parseGuide("ok", guideText({}, "An em dash — appears."))).join(" ")).toMatch(/em dash/);
  });

  it("defines the six categories the Resources hub promises", () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual(["Research Methodology", "Biostatistics", "Epidemiology", "Literature Reviews", "Academic Writing", "Research Data Management"]);
  });
});

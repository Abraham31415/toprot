import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ALL_TOOLS, toolHref } from "../registry";
import { ENTRIES, DIRECTORY } from "../directory";
import { DIR_CATEGORIES, FEATURED, categoryOf, countByCategory, dirStateToSearch, filterItems, groupItems, parseDirState, scoreItem, type DirItem } from "../directory-core";
import { CATEGORIES } from "../types";
import { allPublicToolSlugs } from "../seo";
import { TOOL_ICONS } from "@/components/tools/tool-icons";
import { ToolDirectory } from "@/components/tools/tool-directory";

const find = (query: string, category: "all" | DirItem["category"] = "all") => filterItems(DIRECTORY, { category, query });
const labels = (query: string, category: "all" | DirItem["category"] = "all") => find(query, category).map((i) => i.label);

describe("directory contents", () => {
  it("lists every existing tool exactly once, with its original address", () => {
    for (const t of ALL_TOOLS) {
      const hits = DIRECTORY.filter((d) => d.slug === t.slug);
      expect(hits, t.slug).toHaveLength(1);
      expect(hits[0].href, t.slug).toBe(toolHref(t));
    }
    // Plus the two landing pages that sit beside the calculators they run.
    expect(DIRECTORY.length).toBe(ALL_TOOLS.length + 2);
    expect(new Set(DIRECTORY.map((d) => d.slug)).size).toBe(DIRECTORY.length);
  });

  it("links every calculator to a page that exists", () => {
    const pages = new Set(allPublicToolSlugs());
    for (const d of DIRECTORY.filter((x) => x.href?.startsWith("/tools/"))) expect(pages.has(d.href!.replace("/tools/", "")), d.slug).toBe(true);
  });

  it("describes each tool with a short label and one short line, and keeps the full name for the tool's own page", () => {
    for (const d of DIRECTORY) {
      expect(d.label.length, `${d.slug} label`).toBeLessThanOrEqual(28);
      expect(d.blurb.length, `${d.slug} blurb`).toBeLessThanOrEqual(70);
      expect(d.blurb.length).toBeGreaterThan(15);
      expect(`${d.label} ${d.blurb}`).not.toMatch(/—|free, no account/i);
      expect(TOOL_ICONS[d.icon], `${d.slug} icon`).toBeDefined();
    }
    const named = DIRECTORY.find((d) => d.slug === "sample-size-pre-post")!;
    expect(named.label).toBe("ANCOVA Sample Size");
    expect(named.fullName).toBe("Baseline-Adjusted Comparison (Change Score or ANCOVA)");
    expect(DIRECTORY.find((d) => d.slug === "sample-size-survival")!.label).toBe("Survival Analysis");
  });

  it("gives every tool its own entry, and every entry belongs to a real tool", () => {
    for (const t of ALL_TOOLS) expect(ENTRIES[t.slug], t.slug).toBeDefined();
    for (const k of Object.keys(ENTRIES)) expect(ALL_TOOLS.some((t) => t.slug === k), k).toBe(true);
  });

  it("never gives two tools the same label, so cards cannot be confused", () => {
    const seen = new Map<string, string>();
    for (const d of DIRECTORY) { expect(seen.has(d.label), `${d.slug} repeats "${d.label}" of ${seen.get(d.label)}`).toBe(false); seen.set(d.label, d.slug); }
  });

  it("keeps meaning when a label is shortened: sample-size tools still say so", () => {
    const scoped = ["sample-size-pre-post", "sample-size-survival", "sample-size-diagnostic-accuracy", "sample-size-cluster-trial"];
    for (const slug of scoped) expect(`${DIRECTORY.find((d) => d.slug === slug)!.label} ${DIRECTORY.find((d) => d.slug === slug)!.blurb}`.toLowerCase(), slug).toMatch(/sample size|participants|clusters/);
  });
});

describe("categories", () => {
  it("covers all seven categories, and every existing category maps to one", () => {
    expect(DIR_CATEGORIES.map((c) => c.name)).toEqual(["Sample Size & Power", "Statistical Analysis", "Epidemiology", "Research Design", "Literature & References", "Data Collection", "Writing & Reporting"]);
    for (const c of CATEGORIES) expect(DIR_CATEGORIES.some((d) => d.from.includes(c.id)), c.id).toBe(true);
    for (const c of DIR_CATEGORIES) expect(DIRECTORY.some((d) => d.category === c.id), c.id).toBe(true);
    expect(categoryOf("reporting")).toBe("writing");
  });

  it("counts add up, and a category filter returns only that category", () => {
    const counts = countByCategory(DIRECTORY);
    expect(DIR_CATEGORIES.reduce((n, c) => n + counts[c.id], 0)).toBe(counts.all);
    expect(counts.all).toBe(DIRECTORY.length);
    for (const c of DIR_CATEGORIES) {
      const items = find("", c.id);
      expect(items.length).toBe(counts[c.id]);
      expect(items.every((i) => i.category === c.id)).toBe(true);
    }
  });

  it("splits large categories into groups, with ungrouped tools last", () => {
    const sample = groupItems(find("", "sample-size"));
    expect(sample.map((g) => g.name)).toEqual(["Estimate a value", "Compare groups", "Observational studies", "Power and effect size", "Adjustments"]);
    expect(sample.reduce((n, g) => n + g.items.length, 0)).toBe(find("", "sample-size").length);
    expect(groupItems(find("", "epidemiology"))).toEqual([{ name: null, items: find("", "epidemiology") }]);
  });

  it("puts the most useful tools first within a category", () => {
    expect(find("", "sample-size")[0].slug).toBe("sample-size-calculator");
    expect(find("", "epidemiology")[0].label).toBe("Diagnostic Accuracy");
  });
});

describe("featured tools", () => {
  it("are the four most used, each linking to a real page", () => {
    expect(FEATURED.map((f) => f.label)).toEqual(["Sample Size Calculator", "Chi-Square Calculator", "Odds Ratio Calculator", "Diagnostic Accuracy Calculator"]);
    const pages = new Set(allPublicToolSlugs());
    for (const f of FEATURED) { expect(pages.has(f.href.replace("/tools/", "")), f.slug).toBe(true); expect(TOOL_ICONS[f.icon]).toBeDefined(); }
  });
});

describe("search", () => {
  it("returns everything for an empty search", () => {
    expect(find("").length).toBe(DIRECTORY.length);
    expect(find("   ").length).toBe(DIRECTORY.length);
  });

  it("finds every tool by its short label and by its full technical name", () => {
    for (const d of DIRECTORY) {
      expect(find(d.label).map((x) => x.slug), `label ${d.label}`).toContain(d.slug);
      expect(find(d.fullName).map((x) => x.slug), `name ${d.fullName}`).toContain(d.slug);
    }
  });

  it("finds tools by common abbreviations, and ranks the tool itself first", () => {
    expect(labels("OR")[0]).toBe("Odds Ratio");
    expect(labels("or")[0]).toBe("Odds Ratio");
    expect(labels("RR")[0]).toBe("Relative Risk");
    expect(labels("NNT")).toContain("Risk Difference & NNT");
    expect(labels("ancova")[0]).toBe("ANCOVA Sample Size");
    expect(labels("PICO")).toContain("Research Question");
    expect(labels("log-rank")).toContain("Survival Analysis");
    expect(labels("kobo")).toContain("Forms & Data Dictionary");
    expect(labels("zotero")).toContain("Reference Manager");
    expect(labels("HSD")).toContain("ANOVA Post-Hoc (Tukey)");
    expect(labels("rho")).toContain("Spearman Correlation");
  });

  it("does not match a short abbreviation inside ordinary words", () => {
    expect(labels("or")).not.toContain("ANCOVA Sample Size");
    expect(labels("or")).not.toContain("Single Proportion");
    expect(labels("ci").every((l) => /interval|proportion|mean|descriptive/i.test(l) || find("ci").find((i) => i.label === l)!.keywords.some((k) => /\bci\b/i.test(k)))).toBe(true);
  });

  it("finds tools by method, design and keyword", () => {
    expect(labels("t-test")).toEqual(expect.arrayContaining(["One-Sample t-Test", "Two-Sample t-Test", "Paired t-Test"]));
    expect(labels("t test")).toEqual(expect.arrayContaining(["Two-Sample t-Test"]));
    expect(labels("power")).toEqual(expect.arrayContaining(["Power Calculator", "Power: Two Means", "Power: Two Proportions"]));
    expect(labels("sensitivity")).toEqual(expect.arrayContaining(["Diagnostic Accuracy", "Diagnostic Accuracy Study"]));
    expect(labels("chi")).toContain("Chi-Square Test");
    expect(labels("case control")).toEqual(expect.arrayContaining(["Case-Control", "Matched Case-Control"]));
    expect(labels("prevalence")).toEqual(expect.arrayContaining(["Prevalence", "Single Proportion"]));
    expect(labels("cohort")).toContain("Cohort Study");
    expect(labels("apa")).toContain("Citation Formatter");
  });

  it("needs every word to match, and is not case or punctuation sensitive", () => {
    expect(labels("sample size mean")).toContain("Single Mean");
    expect(labels("sample size mean")).not.toContain("Chi-Square Test");
    expect(labels("FISHER'S exact")).toContain("Fisher's Exact Test");
    expect(labels("fishers   exact")).toContain("Fisher's Exact Test");
    expect(find("zzzzqq")).toEqual([]);
  });

  it("ranks a name match above a description match", () => {
    const r = labels("power");
    expect(r.indexOf("Power Calculator")).toBeLessThan(r.length - 1);
    expect(scoreItem(DIRECTORY.find((d) => d.label === "Power Calculator")!, "power")).toBeGreaterThan(scoreItem(DIRECTORY.find((d) => d.slug === "sample-size-two-means")!, "power"));
  });

  it("filters within a category and counts matches per category", () => {
    const inEpi = labels("risk", "epidemiology");
    expect(inEpi).toEqual(expect.arrayContaining(["Relative Risk", "Risk Difference & NNT"]));
    expect(find("risk", "epidemiology").every((i) => i.category === "epidemiology")).toBe(true);
    const counts = countByCategory(DIRECTORY, "risk");
    expect(counts.all).toBe(find("risk").length);
    expect(counts.epidemiology).toBe(find("risk", "epidemiology").length);
  });
});

describe("address state", () => {
  it("round-trips a category and a search", () => {
    const state = { category: "epidemiology" as const, query: "odds ratio" };
    expect(parseDirState(dirStateToSearch(state))).toEqual(state);
    expect(dirStateToSearch({ category: "all", query: "" })).toBe("");
    expect(dirStateToSearch({ category: "all", query: "t-test" })).toBe("?q=t-test");
  });

  it("ignores unknown categories and caps the search length", () => {
    expect(parseDirState("?category=nonsense&q=abc")).toEqual({ category: "all", query: "abc" });
    expect(parseDirState(`?q=${"x".repeat(500)}`).query.length).toBe(80);
    expect(parseDirState("")).toEqual({ category: "all", query: "" });
  });
});

describe("server-rendered page", () => {
  const html = renderToStaticMarkup(createElement(ToolDirectory, { items: DIRECTORY }));

  it("contains a link to every tool, so search engines and keyboard users reach all of them", () => {
    for (const d of DIRECTORY.filter((x) => x.href)) expect(html, d.slug).toContain(`href="${d.href}"`);
  });

  it("has the search, the category navigation and the featured tools", () => {
    expect(html).toContain('role="search"');
    expect(html).toContain('id="tool-search"');
    expect(html).toContain("Search research tools");
    for (const c of DIR_CATEGORIES) expect(html).toContain(c.name.replace("&", "&amp;"));
    for (const f of FEATURED) expect(html).toContain(f.label);
  });

  it("does not repeat a 'free, no account' badge on cards", () => {
    expect(html.toLowerCase()).not.toContain("free, no account");
  });

  it("marks tools that need an account with a lock and an accessible note", () => {
    expect(html).toContain("Needs a free account");
  });
});

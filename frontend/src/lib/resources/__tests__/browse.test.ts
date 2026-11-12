import { describe, expect, it } from "vitest";
import { categoryFromSearch, countByCategory, searchGuides, type GuideCard } from "../browse";

const G = (over: Partial<GuideCard>): GuideCard => ({ slug: "s", title: "T", summary: "S", category: "methodology", keywords: [], minutes: 5, featured: false, updatedOn: "2026-11-12", ...over });
const name = (id: string) => ({ methodology: "Research Methodology", biostatistics: "Biostatistics" })[id] ?? id;

const GUIDES = [
  G({ slug: "protocol", title: "How to write a research protocol", summary: "Plan a study.", category: "methodology", keywords: ["SPIRIT", "objectives"] }),
  G({ slug: "sample", title: "How to calculate sample size", summary: "Work out how many participants.", category: "biostatistics", keywords: ["power", "prevalence"] }),
  G({ slug: "pvalue", title: "Understanding p-values", summary: "What a p-value is, and a confidence interval.", category: "biostatistics", keywords: ["significance"] }),
];

describe("searching guides", () => {
  it("returns everything with no query and filters by category", () => {
    expect(searchGuides(GUIDES, "", "all", name)).toHaveLength(3);
    expect(searchGuides(GUIDES, "", "biostatistics", name).map((g) => g.slug)).toEqual(["sample", "pvalue"]);
  });
  it("requires every word to match, in title, summary, keywords or category name", () => {
    expect(searchGuides(GUIDES, "sample size", "all", name).map((g) => g.slug)).toEqual(["sample"]);
    expect(searchGuides(GUIDES, "spirit", "all", name).map((g) => g.slug)).toEqual(["protocol"]);
    expect(searchGuides(GUIDES, "biostatistics", "all", name)).toHaveLength(2);
    expect(searchGuides(GUIDES, "sample xyzzy", "all", name)).toEqual([]);
  });
  it("ranks a title match above a summary match, and ignores case and punctuation", () => {
    const r = searchGuides(GUIDES, "P-Value!", "all", name);
    expect(r[0].slug).toBe("pvalue");
  });
  it("combines the query with the category", () => {
    expect(searchGuides(GUIDES, "how to", "methodology", name).map((g) => g.slug)).toEqual(["protocol"]);
  });
});

describe("categories", () => {
  it("counts guides per category", () => {
    expect(countByCategory(GUIDES)).toEqual({ methodology: 1, biostatistics: 2 });
  });
  it("reads the category from the address and ignores anything unknown", () => {
    const valid = ["methodology", "biostatistics"];
    expect(categoryFromSearch("?category=biostatistics", valid)).toBe("biostatistics");
    expect(categoryFromSearch("?category=nope", valid)).toBe("all");
    expect(categoryFromSearch("", valid)).toBe("all");
  });
});

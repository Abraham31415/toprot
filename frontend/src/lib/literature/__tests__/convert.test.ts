import { describe, expect, it } from "vitest";
import { evidenceCsv, evidenceDoc, evidenceRowFor, shortCitation, workToRef, worksToCsv } from "../convert";
import type { Work } from "../types";

const W = (o: Partial<Work> = {}): Work => ({ id: "pubmed:1", source: "pubmed", type: "article-journal", title: "A trial, with commas", authors: [{ family: "Smith", given: "J" }, { family: "Jones", given: "B" }, { family: "Lee", given: "C" }], journal: "The Lancet", year: 2020, doi: "10.1000/a", pmid: "1", landingUrl: "https://pubmed.ncbi.nlm.nih.gov/1/", publicationTypes: ["Journal Article", "Randomized Controlled Trial", "Research Support, Non-U.S. Gov't"], ...o });

describe("short citations", () => {
  it("handles zero, one, two and many authors, and a missing year", () => {
    expect(shortCitation([], 2020)).toBe("Anonymous 2020");
    expect(shortCitation([{ family: "Smith" }], 2020)).toBe("Smith 2020");
    expect(shortCitation([{ family: "Smith" }, { family: "Jones" }], 2020)).toBe("Smith and Jones 2020");
    expect(shortCitation([{ family: "A" }, { family: "B" }, { family: "C" }], 2020)).toBe("A et al. 2020");
    expect(shortCitation([{ literal: "World Health Organization" }])).toBe("World Health Organization");
  });
});

describe("work to reference", () => {
  it("carries only what the source supplied", () => {
    const r = workToRef(W({ openAccess: { isOa: true, url: "x" }, citedBy: 5 }));
    expect(r).toMatchObject({ title: "A trial, with commas", journal: "The Lancet", year: 2020, doi: "10.1000/a", pmid: "1", url: "https://pubmed.ncbi.nlm.nih.gov/1/" });
    expect(r.abstract).toBeUndefined();
    expect("citedBy" in r).toBe(false);
  });
});

describe("results CSV", () => {
  it("quotes commas and marks unknown open-access status honestly", () => {
    const csv = worksToCsv([W(), W({ openAccess: { isOa: true } }), W({ openAccess: { isOa: false } })]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("title,authors,journal,year,volume,issue,pages,doi,pmid,type,source,open_access,link");
    expect(lines[1]).toContain('"A trial, with commas"');
    expect(lines[1]).toContain(",unknown,");
    expect(lines[2]).toContain(",yes,");
    expect(lines[3]).toContain(",no,");
  });
});

describe("evidence table", () => {
  it("pre-fills only citation facts, offering PubMed's publication type as a design hint", () => {
    const r = evidenceRowFor(W());
    expect(r).toMatchObject({ study: "Smith et al. 2020", journal: "The Lancet", year: "2020", design: "Randomized Controlled Trial", population: "", exposure: "", outcome: "", findings: "", limitations: "", notes: "" });
    expect(evidenceRowFor(W({ publicationTypes: undefined })).design).toBe("");
    expect(evidenceRowFor(W({ publicationTypes: ["Journal Article"] })).design).toBe("");
  });
  it("exports CSV and a Word-compatible document with escaping", () => {
    const rows = [{ ...evidenceRowFor(W()), findings: 'Cut "deaths" by <20%> & more' }];
    const csv = evidenceCsv(rows);
    expect(csv.split("\n")[0]).toBe("Study,Title,Journal,Year,Link,Study design,Population and setting,Intervention or exposure,Outcomes measured,Main findings,Limitations,Notes");
    expect(csv).toContain('"Cut ""deaths"" by <20%> & more"');
    const doc = evidenceDoc(rows, "My <review>");
    expect(doc).toContain("My &lt;review&gt;");
    expect(doc).toContain("Cut \"deaths\" by &lt;20%&gt; &amp; more");
    expect(doc).toContain("landscape");
  });
});

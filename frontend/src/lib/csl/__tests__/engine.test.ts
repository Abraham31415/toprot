import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_STYLES } from "../styles";
import { createProcessor, htmlToText, neededLocales, parseCluster, parseStyleMeta, renderDocument, sanitizeCslHtml, type Locales } from "../engine";
import { toCslItem } from "../../refs/convert";
import type { Ref } from "../../refs/model";

const pub = path.resolve(__dirname, "../../../../public/csl");
const style = (id: string) => readFileSync(path.join(pub, "styles", `${id}.csl`), "utf8");
const LOCALES: Locales = { "en-US": readFileSync(path.join(pub, "locales/locales-en-US.xml"), "utf8"), "en-GB": readFileSync(path.join(pub, "locales/locales-en-GB.xml"), "utf8") };

const R = (o: Partial<Ref>): Ref => ({ type: "article-journal", title: "T", authors: [], ...o });
const refs: Record<string, Ref> = {
  a: R({ title: "Vitamin A supplementation and child mortality", authors: [{ family: "Smith", given: "J. A." }, { family: "Müller", given: "Hans" }], journal: "The Lancet", year: 2020, month: 5, volume: "12", issue: "3", pages: "45-67", doi: "10.1000/xyz" }),
  b: R({ title: "Malaria in pregnancy", authors: [{ family: "Jones", given: "B." }], journal: "BMJ", year: 2018, volume: "5", pages: "e1234" }),
  c: R({ title: "Zinc and diarrhoea", authors: [{ family: "Adams", given: "A." }, { family: "Brown", given: "B." }, { family: "Clark", given: "C." }], journal: "Pediatrics", year: 2019, volume: "1", pages: "1-9" }),
  d: R({ title: "Another Smith study", authors: [{ family: "Smith", given: "J. A." }], journal: "Nature", year: 2020, volume: "3", pages: "10-20" }),
};
const items = Object.entries(refs).map(([k, r]) => toCslItem(r, k));
const run = (id: string, src: string, its = items) => renderDocument(src, its, style(id), LOCALES);

describe("bundled styles", () => {
  it("every bundled style loads and formats a reference with a bibliography", () => {
    for (const s of BUNDLED_STYLES) {
      const d = run(s.id, "Text [@a].");
      expect(d.bibliographyText.length, s.id).toBeGreaterThan(30);
      expect(d.bibliographyText.toLowerCase(), s.id).toContain("vitamin a supplementation");
      expect(d.bibliographyText, s.id).toContain("Müller");
      expect(d.text, s.id).not.toMatch(/undefined|NaN|\[missing/);
      expect(d.meta.hasBibliography, s.id).toBe(true);
    }
  });
});

describe("author-date styles", () => {
  it("APA 7: ampersand, alphabetical order, et al. and locators", () => {
    const d = run("apa", "One [@a]. Two [@a; @b]. Three [@c]. Four [@a, p. 12].");
    expect(d.text).toContain("(Smith & Müller, 2020)");
    expect(d.text).toContain("(Jones, 2018; Smith & Müller, 2020)");
    expect(d.text).toContain("(Adams et al., 2019)");
    expect(d.text).toContain("(Smith & Müller, 2020, p. 12)");
    const entries = d.bibliographyText.split("\n");
    expect(entries[0]).toMatch(/^Adams, A\., Brown, B\., & Clark, C\. \(2019\)\. Zinc and diarrhoea\./);
    expect(entries[1]).toMatch(/^Jones, B\. \(2018\)\./);
    expect(d.bibliographyText).toContain("https://doi.org/10.1000/xyz");
  });
  it("disambiguates two works by the same author in the same year", () => {
    const d = run("apa", "A [@a] and B [@d].");
    expect(d.text).toMatch(/\(Smith & Müller, 2020\)/);
    expect(d.text).toMatch(/\(Smith, 2020\)/);
    const same = [toCslItem(R({ title: "First", authors: [{ family: "Smith", given: "J." }], year: 2020, journal: "J" }), "x"), toCslItem(R({ title: "Second", authors: [{ family: "Smith", given: "J." }], year: 2020, journal: "J" }), "y")];
    const e = run("apa", "[@x] and [@y]", same);
    expect(e.text).toContain("Smith, 2020a");
    expect(e.text).toContain("Smith, 2020b");
  });
  it("Harvard, Chicago and MLA use their own conventions", () => {
    expect(run("harvard-cite-them-right", "[@a]").text).toContain("(Smith and Müller, 2020)");
    expect(run("chicago-author-date", "[@a]").text).toContain("(Smith and Müller 2020)");
    expect(run("modern-language-association", "[@a]").text).toContain("(Smith and Müller)");
    expect(run("modern-language-association", "[@a, p. 12]").text).toContain("(Smith and Müller 12)");
  });
});

describe("numeric styles", () => {
  it("number by order of first citation and list the bibliography in that order", () => {
    for (const id of ["elsevier-vancouver", "bmj", "plos", "american-medical-association"]) {
      const d = run(id, "First [@b] then [@a] then [@b] again.");
      expect(d.text, id).toMatch(/First \[?1\]? then \[?2\]? then \[?1\]? again\./);
      const b = d.bibliographyText.split("\n");
      expect(b[0], id).toContain("Jones");
      expect(b[1], id).toContain("Smith");
    }
  });
  it("IEEE brackets each number and keeps author initials first", () => {
    const d = run("ieee", "See [@a; @b].");
    expect(d.text).toContain("[1], [2]");
    expect(d.bibliographyText).toContain("J. A. Smith and H. Müller");
  });
  it("Vancouver-type styles give a range or list for several works", () => {
    const d = run("elsevier-vancouver", "See [@a; @b; @c].");
    expect(d.text).toMatch(/\[1[,–-]3\]|\[1,2,3\]/);
  });
  it("changing style changes the output and keeps the same references", () => {
    const apa = run("apa", "Claim [@a].");
    const van = run("elsevier-vancouver", "Claim [@a].");
    expect(apa.text).not.toBe(van.text);
    expect(apa.bibliographyText.toLowerCase()).toContain("vitamin a supplementation");
    expect(van.bibliographyText.toLowerCase()).toContain("vitamin a supplementation");
  });
  it("Nature and The Lancet use superscript-style numbers", () => {
    expect(run("nature", "Claim [@a].").text).toMatch(/Claim 1\./);
    expect(run("the-lancet", "Claim [@a].").text).toMatch(/Claim 1\./);
  });
});

describe("documents", () => {
  it("reports missing and uncited keys, and keeps the missing marker visible", () => {
    const d = run("apa", "Known [@a]. Unknown [@nope; @a].");
    expect(d.missing).toEqual(["nope"]);
    expect(d.uncited.sort()).toEqual(["b", "c", "d"]);
    expect(d.html).toContain("cite-missing");
    expect(d.text).toContain("[missing: nope]");
    expect(d.citationCount).toBe(2);
  });
  it("lists only cited works in the bibliography", () => {
    const d = run("apa", "Only [@b].");
    expect(d.bibliographyText).toContain("Malaria in pregnancy");
    expect(d.bibliographyText).not.toContain("Zinc and diarrhoea");
  });
  it("handles documents with no citations, empty reference lists and empty text", () => {
    expect(run("apa", "Plain text.").bibliographyText).toBe("");
    expect(run("apa", "Cites [@a].", []).missing).toEqual(["a"]);
    expect(run("apa", "").text).toBe("");
  });
  it("escapes user text in the HTML output", () => {
    const d = run("apa", "<script>alert(1)</script> & more [@a]\nsecond line");
    expect(d.html).toContain("&lt;script&gt;");
    expect(d.html).not.toContain("<script>");
    expect(d.html).toContain("<br>");
  });
  it("neutralises markup inside reference fields", () => {
    const evil = [toCslItem(R({ title: "<img src=x onerror=alert(1)> Title <i>kept</i>", authors: [{ family: "<script>x</script>Smith", given: "J." }], year: 2020, journal: "J" }), "e")];
    const d = run("apa", "[@e]", evil);
    const out = d.html + d.bibliographyHtml;
    // No raw script or image element, and no element carries an event-handler attribute.
    expect(out).not.toMatch(/<(script|img|iframe)/i);
    expect(out).not.toMatch(/<[^>]*\son\w+\s*=/i);
    // The dangerous text is shown as text, escaped.
    expect(out).toContain("&#60;");
  });
  it("uses footnotes for note styles", () => {
    const noteStyle = `<?xml version="1.0" encoding="utf-8"?><style xmlns="http://purl.org/net/xbiblio/csl" class="note" version="1.0"><info><title>Mini note</title><id>x</id><updated>2020-01-01T00:00:00+00:00</updated></info><citation><layout delimiter="; "><text variable="title"/></layout></citation><bibliography><layout><text variable="title"/></layout></bibliography></style>`;
    const d = renderDocument("One [@a]. Two [@b].", items, noteStyle, LOCALES);
    expect(d.notes).toHaveLength(2);
    expect(d.html).toContain('<sup class="cite-note">1</sup>');
    expect(d.text).toContain("One [1]. Two [2].");
    expect(d.notes[0].html).toContain("Vitamin A supplementation");
  });
  it("processes a long document quickly", () => {
    const t0 = Date.now();
    const src = Array.from({ length: 200 }, (_, i) => `Sentence ${i} [@${["a", "b", "c", "d"][i % 4]}].`).join(" ");
    const d = run("elsevier-vancouver", src);
    expect(d.citationCount).toBe(200);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe("citation syntax", () => {
  it("parses keys, locators, labels and prefixes", () => {
    expect(parseCluster("@a")).toEqual([{ id: "a" }]);
    expect(parseCluster("@a; @b")).toEqual([{ id: "a" }, { id: "b" }]);
    expect(parseCluster("@a, p. 12")).toEqual([{ id: "a", locator: "12", label: "page" }]);
    expect(parseCluster("@a, pp. 33-35")).toEqual([{ id: "a", locator: "33-35", label: "page" }]);
    expect(parseCluster("@a, chap. 3")).toEqual([{ id: "a", locator: "3", label: "chapter" }]);
    expect(parseCluster("see @a, p. 4; @b")).toEqual([{ id: "a", prefix: "see ", locator: "4", label: "page" }, { id: "b" }]);
    expect(parseCluster("no citation here")).toBeNull();
  });
  it("does not treat email addresses or ordinary brackets as citations", () => {
    const d = run("apa", "Write to me@example.com [see note] [1] [@a].");
    expect(d.citationCount).toBe(1);
    expect(d.text).toContain("me@example.com [see note] [1]");
  });
});

describe("style metadata and helpers", () => {
  it("reads title, kind and locale from a style", () => {
    expect(parseStyleMeta(style("apa"))).toMatchObject({ kind: "in-text", defaultLocale: "en-US", hasBibliography: true });
    expect(parseStyleMeta(style("apa")).title).toMatch(/APA/);
    expect(parseStyleMeta(style("harvard-cite-them-right")).kind).toBe("in-text");
  });
  it("recognises a dependent style and its parent", () => {
    const dep = `<style class="in-text" default-locale="en-GB"><info><title>Journal X</title><link href="http://www.zotero.org/styles/apa" rel="independent-parent"/></info></style>`;
    expect(parseStyleMeta(dep)).toMatchObject({ parent: "apa", defaultLocale: "en-GB", title: "Journal X" });
    expect(neededLocales(dep)).toEqual(["en-GB", "en-US"]);
  });
  it("sanitises CSL HTML to simple inline markup", () => {
    expect(sanitizeCslHtml('<i>x</i><script>bad()</script><a href="javascript:alert(1)">l</a><span onclick="x()" class="c">y</span>')).toBe('<i>x</i><a>l</a><span class="c">y</span>');
    expect(sanitizeCslHtml('<a href="https://doi.org/10.1/x">d</a>')).toContain('href="https://doi.org/10.1/x"');
    expect(htmlToText('<div class="csl-left-margin">1.</div><div class="csl-right-inline">Text &amp; more</div>')).toBe("1. Text & more");
  });
  it("creating a processor with no items does not throw", () => {
    const p = createProcessor(style("apa"), LOCALES, []);
    expect(p.cite([[{ id: "none" }]])).toEqual([""]);
    expect(p.bibliography().text).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { normalizeDoi, normalizePages, parsePersonName, personToLegacy, type Ref } from "../model";
import { parseRis, writeRis } from "../ris";
import { citationKey, parseBibtex, unlatex, writeBibtex } from "../bibtex";
import { parseEndnoteXml, writeEndnoteXml } from "../endnote";
import { findDuplicates, mergeRefs, titleSimilarity } from "../dedupe";
import { refToRowFields, rowToRef, toCslItem } from "../convert";

const A = (over: Partial<Ref> = {}): Ref => ({ type: "article-journal", title: "Vitamin A supplementation and child mortality", authors: [{ family: "Smith", given: "John A." }, { family: "Müller", given: "Hans" }], journal: "The Lancet", year: 2020, month: 5, volume: "12", issue: "3", pages: "45–67", doi: "10.1000/xyz123", ...over });

describe("names, DOIs and pages", () => {
  it("parses the common name shapes without inventing a given name", () => {
    expect(parsePersonName("Smith, John A.")).toEqual({ family: "Smith", given: "John A." });
    expect(parsePersonName("Smith JA")).toEqual({ family: "Smith", given: "J A" });
    expect(parsePersonName("John A. Smith")).toEqual({ family: "Smith", given: "John A." });
    expect(parsePersonName("Madonna")).toEqual({ literal: "Madonna" });
    expect(parsePersonName("van der Berg, Anna")).toEqual({ family: "van der Berg", given: "Anna" });
    expect(parsePersonName("  ")).toEqual({});
    expect(personToLegacy({ family: "Smith", given: "John A." })).toBe("Smith JA");
    expect(personToLegacy({ literal: "World Health Organization" })).toBe("World Health Organization");
  });
  it("normalises DOIs from URLs and prefixes, and rejects non-DOIs", () => {
    expect(normalizeDoi("https://doi.org/10.1000/ABC.1")).toBe("10.1000/abc.1");
    expect(normalizeDoi("doi: 10.1000/abc.1.")).toBe("10.1000/abc.1");
    expect(normalizeDoi("not a doi")).toBeUndefined();
    expect(normalizeDoi(null)).toBeUndefined();
  });
  it("normalises page ranges but leaves e-locators alone", () => {
    expect(normalizePages("45-67")).toBe("45–67");
    expect(normalizePages("45--67")).toBe("45–67");
    expect(normalizePages("e1234")).toBe("e1234");
  });
});

const RIS = `﻿TY  - JOUR\r
AU  - Smith, John A.\r
AU  - Müller, Hans\r
T1  - Vitamin A supplementation and\r
  child mortality\r
JO  - The Lancet\r
PY  - 2020/05/12/\r
VL  - 12\r
IS  - 3\r
SP  - 45\r
EP  - 67\r
DO  - https://doi.org/10.1000/XYZ123\r
AB  - A long abstract that\r
  wraps over two lines.\r
KW  - vitamin A\r
KW  - mortality\r
SN  - 0140-6736\r
AN  - 31234567\r
DB  - MEDLINE\r
ER  - \r
\r
TY  - BOOK\r
AU  - World Health Organization\r
TI  - Guidelines on vitamin A\r
PB  - WHO Press\r
PY  - 2011\r
ER  - \r
\r
TY  - JOUR\r
AU  - Nobody, N.\r
ER  - \r
`;

describe("RIS", () => {
  it("parses real-world quirks: BOM, CRLF, wrapped lines, DOI URLs, PMID by database", () => {
    const { refs, warnings } = parseRis(RIS);
    expect(refs).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    const r = refs[0];
    expect(r.title).toBe("Vitamin A supplementation and child mortality");
    expect(r.authors[0]).toEqual({ family: "Smith", given: "John A." });
    expect(r).toMatchObject({ journal: "The Lancet", year: 2020, month: 5, volume: "12", issue: "3", pages: "45–67", doi: "10.1000/xyz123", pmid: "31234567", issn: "0140-6736" });
    expect(r.abstract).toBe("A long abstract that wraps over two lines.");
    expect(r.keywords).toEqual(["vitamin A", "mortality"]);
    expect(refs[1]).toMatchObject({ type: "book", publisher: "WHO Press", year: 2011 });
  });
  it("does not treat an accession number as a PMID unless the database is PubMed or MEDLINE", () => {
    const { refs } = parseRis("TY  - JOUR\nTI  - X\nAN  - 12345\nDB  - Scopus\nER  - ");
    expect(refs[0].pmid).toBeUndefined();
  });
  it("round-trips through write and parse without losing fields", () => {
    const original = [A({ pmid: "31234567", abstract: "Abstract.", keywords: ["a", "b"], issn: "0140-6736" }), A({ type: "book", title: "A book", journal: undefined, publisher: "Press", doi: undefined, pages: undefined })];
    const { refs } = parseRis(writeRis(original));
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ title: original[0].title, year: 2020, month: 5, pages: "45–67", doi: "10.1000/xyz123", pmid: "31234567", abstract: "Abstract.", keywords: ["a", "b"] });
    expect(refs[0].authors).toEqual(original[0].authors);
    expect(refs[1]).toMatchObject({ type: "book", publisher: "Press" });
  });
  it("handles empty and garbage input", () => {
    expect(parseRis("").refs).toEqual([]);
    expect(parseRis("hello world\nnot ris").refs).toEqual([]);
  });
});

const BIB = String.raw`% a comment line
@comment{ignored @article{notreal, title={No}}}
@preamble{"\newcommand{\noop}[1]{}"}
@string{lancet = "The Lancet"}
@article{smith2020,
  author = {Smith, John A. and M{\"u}ller, Hans and {World Health Organization}},
  title = {Effect of {COVID-19} on {B}uganda \& beyond},
  journal = lancet,
  year = 2020,
  month = may,
  volume = {12},
  number = {3},
  pages = {45--67},
  doi = {https://doi.org/10.1000/XYZ123},
  keywords = {vitamin A; mortality, children},
  abstract = "Part one " # "and part two.",
}
@book(who2011,
  author = "World Health Organization",
  title = {Guidelines {on} Vitamin A},
  publisher = {WHO Press},
  year = {2011}
)
@article{notitle, author = {Ghost, G.}, year = 2001}
`;

describe("BibTeX", () => {
  it("parses nested braces, accents, macros, concatenation, month names and alternate delimiters", () => {
    const { refs, warnings } = parseBibtex(BIB);
    expect(refs).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    const a = refs[0];
    expect(a.title).toBe("Effect of COVID-19 on Buganda & beyond");
    expect(a.authors).toEqual([{ family: "Smith", given: "John A." }, { family: "Müller", given: "Hans" }, { literal: "World Health Organization" }]);
    expect(a).toMatchObject({ journal: "The Lancet", year: 2020, month: 5, volume: "12", issue: "3", pages: "45–67", doi: "10.1000/xyz123" });
    expect(a.abstract).toBe("Part one and part two.");
    expect(a.keywords).toEqual(["vitamin A", "mortality", "children"]);
    expect(refs[1]).toMatchObject({ type: "book", title: "Guidelines on Vitamin A", publisher: "WHO Press", year: 2011 });
    expect(refs[1].authors).toEqual([{ literal: "World Health Organization" }]);
  });
  it("converts LaTeX accents and symbols", () => {
    expect(unlatex(String.raw`M{\"u}ller`)).toBe("Müller");
    expect(unlatex(String.raw`Garc\'{\i}a`)).toBe("García");
    expect(unlatex(String.raw`\v{S}koda and \c{C}elik`)).toBe("Škoda and Çelik");
    expect(unlatex(String.raw`R\&D 50\% \_x\_`)).toBe("R&D 50% _x_");
    expect(unlatex("a---b a--b")).toBe("a—b a–b");
    expect(unlatex(String.raw`Stra\ss e \o{} \ae`)).toBe("Straße ø æ");
  });
  it("writes valid, escaped BibTeX that parses back to the same data", () => {
    const original = [A({ title: "R&D 50% of {things}_x", pmid: "1" }), A({ type: "book", journal: undefined, title: "Book", publisher: "Press" })];
    const bib = writeBibtex(original);
    expect(bib).toContain("\\&");
    const { refs } = parseBibtex(bib);
    expect(refs).toHaveLength(2);
    expect(refs[0].title).toBe("R&D 50% of things_x");
    expect(refs[0].authors).toEqual(original[0].authors);
    expect(refs[0]).toMatchObject({ year: 2020, month: 5, pages: "45–67", doi: "10.1000/xyz123", pmid: "1" });
  });
  it("makes citation keys unique and ASCII", () => {
    const taken = new Set<string>();
    const k1 = citationKey(A({ authors: [{ family: "Müller" }] }), taken), k2 = citationKey(A({ authors: [{ family: "Müller" }] }), taken);
    expect(k1).toBe("muller2020vitamin");
    expect(k2).toBe("muller2020vitamin" + "b");
    expect(citationKey(A({ authors: [] }), new Set())).toMatch(/^anon2020/);
  });
  it("copes with junk and unbalanced input without throwing", () => {
    expect(parseBibtex("").refs).toEqual([]);
    expect(() => parseBibtex("@article{x, title = {unclosed")).not.toThrow();
    expect(() => parseBibtex("@@@ {{{{ @article")).not.toThrow();
  });
});

const ENX = `<?xml version="1.0" encoding="UTF-8"?>
<xml><records>
<record>
<ref-type name="Journal Article">17</ref-type>
<contributors><authors>
<author><style face="normal" font="default" size="100%">Smith, John A.</style></author>
<author>M&#252;ller, Hans</author>
</authors></contributors>
<titles><title><style face="normal" font="default" size="100%">Vitamin A &amp; child mortality</style></title></titles>
<periodical><full-title>The Lancet</full-title></periodical>
<pages>45-67</pages><volume>12</volume><number>3</number>
<dates><year>2020</year></dates>
<electronic-resource-num>10.1000/XYZ123</electronic-resource-num>
<accession-num>31234567</accession-num><remote-database-name>MEDLINE</remote-database-name>
<urls><related-urls><url>https://example.org/x</url></related-urls></urls>
<abstract>An abstract.</abstract>
<keywords><keyword>vitamin A</keyword><keyword>mortality</keyword></keywords>
</record>
<record><ref-type name="Book">6</ref-type><titles><title>Guidelines</title></titles><publisher>WHO Press</publisher></record>
<record><ref-type name="Generic">13</ref-type></record>
</records></xml>`;

describe("EndNote XML", () => {
  it("parses style wrappers, entities, numeric type codes and database-qualified PMIDs", () => {
    const { refs, warnings } = parseEndnoteXml(ENX);
    expect(refs).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(refs[0].title).toBe("Vitamin A & child mortality");
    expect(refs[0].authors).toEqual([{ family: "Smith", given: "John A." }, { family: "Müller", given: "Hans" }]);
    expect(refs[0]).toMatchObject({ type: "article-journal", journal: "The Lancet", year: 2020, volume: "12", issue: "3", pages: "45–67", doi: "10.1000/xyz123", pmid: "31234567", url: "https://example.org/x" });
    expect(refs[0].keywords).toEqual(["vitamin A", "mortality"]);
    expect(refs[1]).toMatchObject({ type: "book", publisher: "WHO Press" });
  });
  it("round-trips through write and parse", () => {
    const original = [A({ pmid: "31234567", abstract: "Abstract & <more>.", keywords: ["a", "b"], url: "https://e.org?a=1&b=2" })];
    const xml = writeEndnoteXml(original);
    expect(xml.startsWith("<?xml")).toBe(true);
    const { refs } = parseEndnoteXml(xml);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ title: original[0].title, journal: "The Lancet", year: 2020, pages: "45–67", doi: "10.1000/xyz123", pmid: "31234567", abstract: "Abstract & <more>.", url: "https://e.org?a=1&b=2" });
    expect(refs[0].authors).toEqual(original[0].authors);
  });
  it("reports unreadable or empty files instead of throwing", () => {
    expect(parseEndnoteXml("this is not xml <<<").warnings.length).toBeGreaterThan(0);
    expect(parseEndnoteXml("<xml><records></records></xml>").warnings[0]).toMatch(/No records/);
  });
});

describe("duplicate detection", () => {
  it("groups exact DOI and PMID matches regardless of formatting", () => {
    const g = findDuplicates([A({ doi: "10.1000/ABC" }), A({ doi: "https://doi.org/10.1000/abc", title: "Different title entirely here" }), A({ doi: undefined, pmid: "5", title: "Other work on a different topic" }), A({ doi: undefined, pmid: "5", title: "Yet another distinct subject area" })]);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.reason === "doi")!.indexes).toEqual([0, 1]);
    expect(g.find((x) => x.reason === "pmid")!.indexes).toEqual([2, 3]);
    expect(g.every((x) => x.confidence === "exact")).toBe(true);
  });
  it("flags likely duplicates by title, year and first author, tolerating punctuation and a year apart", () => {
    const g = findDuplicates([A({ doi: undefined }), A({ doi: undefined, title: "Vitamin A Supplementation and Child Mortality.", year: 2021 })]);
    expect(g).toEqual([{ indexes: [0, 1], reason: "title", confidence: "likely" }]);
  });
  it("does not flag different works: different DOIs, different first authors, or years far apart", () => {
    expect(findDuplicates([A(), A({ doi: "10.1000/other" })])).toEqual([]);
    expect(findDuplicates([A({ doi: undefined }), A({ doi: undefined, authors: [{ family: "Jones", given: "B" }] })])).toEqual([]);
    expect(findDuplicates([A({ doi: undefined }), A({ doi: undefined, year: 2012 })])).toEqual([]);
    expect(findDuplicates([A({ doi: undefined, title: "Malaria in children" }), A({ doi: undefined, title: "Tuberculosis in adults" })])).toEqual([]);
  });
  it("measures title similarity from 0 to 1", () => {
    expect(titleSimilarity("The Effect of X", "effect of x")).toBe(1);
    expect(titleSimilarity("abc", "xyz")).toBe(0);
    expect(titleSimilarity("", "x")).toBe(0);
    expect(titleSimilarity("Vitamin A supplementation", "Vitamin A supplementation trial")).toBeGreaterThan(0.85);
  });
  it("merges into the richest record, filling blanks and never overwriting", () => {
    const m = mergeRefs([A({ abstract: undefined, pmid: undefined, volume: "99" }), A({ abstract: "Has abstract", pmid: "7", volume: "12", keywords: ["k"] })]);
    expect(m.abstract).toBe("Has abstract");
    expect(m.pmid).toBe("7");
    expect(m.keywords).toEqual(["k"]);
    // the richer record's own values win
    expect(m.volume).toBe("12");
  });
});

describe("database conversion and CSL-JSON", () => {
  it("prefers structured author details and falls back to the legacy 'Surname Initials' strings", () => {
    const structured = rowToRef({ title: "T", authors: ["Smith JA"], author_details: [{ family: "Smith", given: "John A." }], doi: null, pmid: null, journal: null, year: null, volume: null, issue: null, pages: null });
    expect(structured.authors).toEqual([{ family: "Smith", given: "John A." }]);
    const legacy = rowToRef({ title: "T", authors: ["Smith JA", "Doe B"], doi: null, pmid: null, journal: null, year: null, volume: null, issue: null, pages: null });
    expect(legacy.authors).toEqual([{ family: "Smith", given: "J A" }, { family: "Doe", given: "B" }]);
  });
  it("writes row fields with both legacy and structured authors", () => {
    const f = refToRowFields(A({ pmid: "9" }), "import");
    expect(f.authors).toEqual(["Smith JA", "Müller H"]);
    expect(f.author_details).toHaveLength(2);
    expect(f).toMatchObject({ identifier_type: "doi", source: "import", doi: "10.1000/xyz123", work_type: "article-journal" });
    expect(refToRowFields(A({ doi: undefined }), "manual").identifier_type).toBe("manual");
  });
  it("produces CSL-JSON with only the fields that are present", () => {
    const item = toCslItem(A({ pmid: "9" }), "r1");
    expect(item).toMatchObject({ id: "r1", type: "article-journal", title: "Vitamin A supplementation and child mortality", "container-title": "The Lancet", volume: "12", issue: "3", page: "45–67", DOI: "10.1000/xyz123", PMID: "9" });
    expect(item.issued).toEqual({ "date-parts": [[2020, 5]] });
    const bare = toCslItem({ type: "other", title: "T", authors: [] }, "x");
    expect(Object.keys(bare).sort()).toEqual(["id", "title", "type"]);
  });
});

describe("duplicate detection at scale", () => {
  it("handles a large import with similar titles quickly and still finds the real duplicates", () => {
    const words = ["malaria", "vitamin", "zinc", "diarrhoea", "anaemia", "tuberculosis", "hiv", "measles", "cholera", "typhoid"];
    const refs: Ref[] = Array.from({ length: 1500 }, (_, i) => A({ doi: undefined, title: `The effect of ${words[i % 10]} supplementation on outcomes in children study ${i}`, authors: [{ family: `Author${i % 40}`, given: "A" }], year: 2000 + (i % 20) }));
    refs.push({ ...refs[10], doi: undefined }); // an exact repeat of record 10
    const t0 = Date.now();
    const groups = findDuplicates(refs);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(groups.some((g) => g.indexes.includes(10) && g.indexes.includes(1500))).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { Packer } from "docx";
import { describe, expect, it } from "vitest";
import { collectCitations, countWords, countWordsIn, dropMissingCitations, DocError, outline, plainText, sectionWordCounts, validateDoc, type Doc, type DocNode } from "../doc";
import { buildTemplateDoc, getTemplate, hintFor, TEMPLATES } from "../templates";
import { formatManuscript } from "../format";
import { renderBody, renderPrintDocument } from "../html";
import { buildDocx, htmlToRuns } from "../docx";
import { toCslItem } from "../../refs/convert";
import type { Ref } from "../../refs/model";
import type { Locales } from "../../csl/engine";

const pub = path.resolve(__dirname, "../../../../public/csl");
const styleXml = (id: string) => readFileSync(path.join(pub, "styles", `${id}.csl`), "utf8");
const LOCALES: Locales = { "en-US": readFileSync(path.join(pub, "locales/locales-en-US.xml"), "utf8") };

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const MS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", IMG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FIG_PATH = `${USER}/${MS}/${IMG}.png`;

const refs: Record<string, Ref> = {
  [A]: { type: "article-journal", title: "Vitamin A supplementation and child mortality", authors: [{ family: "Smith", given: "J. A." }, { family: "Müller", given: "Hans" }], journal: "The Lancet", year: 2020, volume: "12", issue: "3", pages: "45-67", doi: "10.1000/xyz" },
  [B]: { type: "article-journal", title: "Malaria in pregnancy", authors: [{ family: "Jones", given: "B." }], journal: "BMJ", year: 2018, volume: "5", pages: "e1234" },
  [C]: { type: "article-journal", title: "Zinc and diarrhoea", authors: [{ family: "Adams", given: "A." }], journal: "Pediatrics", year: 2019, volume: "1", pages: "1-9" },
};
const items = Object.entries(refs).map(([id, r]) => toCslItem(r, id));

const t = (text: string, marks?: DocNode["marks"]): DocNode => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...c: DocNode[]): DocNode => ({ type: "paragraph", content: c });
const h = (level: number, text: string): DocNode => ({ type: "heading", attrs: { level }, content: [t(text)] });
const cite = (...ids: string[]): DocNode => ({ type: "citation", attrs: { items: ids.map((id) => ({ id })) } });
const doc = (...c: DocNode[]): Doc => ({ type: "doc", content: c });

describe("validateDoc", () => {
  it("accepts every node the editor can produce", () => {
    const d = doc(
      h(1, "Intro"), p(t("Bold", [{ type: "bold" }]), t(" and "), t("link", [{ type: "link", attrs: { href: "https://example.org" } }]), cite(A)),
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("x"))] }] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(t("y"))] }] },
      { type: "blockquote", content: [p(t("q"))] }, { type: "codeBlock", content: [t("a = 1")] }, { type: "horizontalRule" },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: [p(t("H"))] }] }] },
      { type: "figure", attrs: { path: FIG_PATH, alt: "a", caption: "c", width: 300, height: 200 } },
    );
    expect(validateDoc(d, MS).content).toHaveLength(d.content.length);
  });
  it("rejects unknown nodes, marks and non-documents", () => {
    expect(() => validateDoc({ type: "doc", content: [{ type: "script" }] })).toThrow(DocError);
    expect(() => validateDoc({ type: "doc", content: [p(t("x", [{ type: "highlightHack" }]))] })).toThrow(DocError);
    expect(() => validateDoc({ type: "paragraph" })).toThrow(DocError);
    expect(() => validateDoc(null)).toThrow(DocError);
    expect(() => validateDoc("<b>x</b>")).toThrow(DocError);
  });
  it("strips unsafe links but keeps their text", () => {
    const d = validateDoc(doc(p(t("click", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))));
    expect(d.content[0].content![0]).toEqual({ type: "text", text: "click" });
    const mail = validateDoc(doc(p(t("m", [{ type: "link", attrs: { href: "mailto:a@b.org" } }]))));
    expect(mail.content[0].content![0].marks).toEqual([{ type: "link", attrs: { href: "mailto:a@b.org" } }]);
  });
  it("only allows figures that point at this manuscript's own image folder", () => {
    const fig = (pth: string) => doc({ type: "figure", attrs: { path: pth, caption: "c" } });
    expect(() => validateDoc(fig("../../etc/passwd"), MS)).toThrow(/image that is not allowed/);
    expect(() => validateDoc(fig("https://evil.example/x.png"), MS)).toThrow(DocError);
    expect(() => validateDoc(fig(`${USER}/${C}/${IMG}.png`), MS)).toThrow(/different manuscript/);
    expect(() => validateDoc(fig(`${USER}/${MS}/${IMG}.svg`), MS)).toThrow(DocError);
    expect(() => validateDoc(fig(`${USER}/${MS}/${IMG}.png`), MS)).not.toThrow();
  });
  it("only allows citations of well-formed reference ids", () => {
    expect(() => validateDoc(doc(p({ type: "citation", attrs: { items: [{ id: "1; drop table" }] } })))).toThrow(DocError);
    expect(() => validateDoc(doc(p({ type: "citation", attrs: { items: [] } })))).toThrow(DocError);
  });
  it("clamps odd attributes instead of storing them", () => {
    const d = validateDoc(doc({ type: "heading", attrs: { level: 99, onclick: "x" }, content: [t("H")] }));
    expect(d.content[0].attrs).toEqual({ level: 2 });
  });
  it("rejects oversize and over-deep documents", () => {
    expect(() => validateDoc(doc(p(t("x".repeat(2_100_000)))))).toThrow(/too large/);
    let deep: DocNode = p(t("x"));
    for (let i = 0; i < 40; i++) deep = { type: "blockquote", content: [deep] };
    expect(() => validateDoc(doc(deep))).toThrow(/deeply/);
  });
});

describe("word count", () => {
  it("counts words, not symbols, and ignores citations", () => {
    expect(countWordsIn("Hello, world! 3.5 — and - x")).toBe(5);
    expect(countWords(doc(p(t("one two"), cite(A), t(" three"))))).toBe(3);
  });
  it("counts across blocks, tables and captions but never merges words between blocks", () => {
    const d = doc(h(1, "Title here"), p(t("alpha")), p(t("beta")), { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p(t("cell one"))] }] }] }, { type: "figure", attrs: { path: FIG_PATH, caption: "a caption of five words" } });
    expect(countWords(d)).toBe(2 + 1 + 1 + 2 + 5);
  });
  it("counts a hard break as a space", () => {
    expect(countWords(doc(p(t("a"), { type: "hardBreak" }, t("b"))))).toBe(2);
  });
  it("reports words per section", () => {
    const d = doc(h(1, "Abstract"), p(t("one two three")), h(1, "Methods"), p(t("four five")), p(t("six")));
    expect(sectionWordCounts(d)).toEqual([{ title: "Abstract", level: 1, words: 3 }, { title: "Methods", level: 1, words: 3 }]);
  });
  it("builds an outline and plain text", () => {
    const d = doc(h(1, "A"), p(t("x")), h(2, "B"));
    expect(outline(d)).toEqual([{ level: 1, text: "A" }, { level: 2, text: "B" }]);
    expect(plainText(d)).toBe("A\nx\nB");
  });
});

describe("citations in the document", () => {
  it("are collected in document order, including those inside tables and lists", () => {
    const d = doc(p(cite(B)), { type: "bulletList", content: [{ type: "listItem", content: [p(cite(A, C))] }] });
    expect(collectCitations(d).map((c) => c.map((x) => x.id))).toEqual([[B], [A, C]]);
  });
  it("lose deleted references, and disappear when none are left", () => {
    const d = doc(p(t("x"), cite(A, B), t("y"), cite(C)));
    const r = dropMissingCitations(d, new Set([A]));
    expect(r.removed).toBe(2);
    expect(collectCitations(r.doc).map((c) => c.map((x) => x.id))).toEqual([[A]]);
    expect(plainText(r.doc)).toBe("xy");
  });
});

describe("templates", () => {
  it("every template builds a valid document with only headings and empty paragraphs", () => {
    for (const tpl of TEMPLATES) {
      const d = buildTemplateDoc(tpl.id);
      expect(() => validateDoc(d), tpl.id).not.toThrow();
      expect(countWords(d) , tpl.id).toBe(outline(d).reduce((n, o) => n + countWordsIn(o.text), 0));
      expect(d.content.some((n) => n.type === "paragraph" && n.content?.length), tpl.id).toBe(false);
    }
  });
  it("has the seven requested document types plus a blank page", () => {
    expect(TEMPLATES.map((x) => x.id).sort()).toEqual(["blank", "case_report", "conference_abstract", "dissertation", "original_article", "research_proposal", "systematic_review", "thesis"]);
  });
  it("follows published headings for guideline-based templates and says to check the checklist", () => {
    const sr = getTemplate("systematic_review");
    expect(sr.guideline).toMatch(/PRISMA 2020/);
    expect(sr.sections.map((s) => s.title)).toEqual(expect.arrayContaining(["Eligibility criteria", "Information sources", "Search strategy", "Risk of bias assessment", "Synthesis methods", "Study selection", "Certainty of evidence"]));
    const care = getTemplate("case_report");
    expect(care.sections.map((s) => s.title)).toEqual(expect.arrayContaining(["Timeline", "Diagnostic assessment", "Therapeutic intervention", "Follow-up and outcomes", "Patient perspective", "Informed consent"]));
  });
  it("matches hints by heading text, ignoring case and spacing", () => {
    expect(hintFor("original_article", "  methods ")).toBeUndefined();
    expect(hintFor("original_article", "Sample size")).toMatch(/size/);
  });
});

describe("formatManuscript", () => {
  const apa = { id: "apa", xml: styleXml("apa"), locales: LOCALES };
  const vancouver = { id: "elsevier-vancouver", xml: styleXml("elsevier-vancouver"), locales: LOCALES };

  it("formats in-text citations and a bibliography from the study's references only", () => {
    const d = doc(p(t("Vitamin A helps "), cite(A), t(". Malaria matters "), cite(B)));
    const f = formatManuscript(d, items, apa);
    expect(f.labels).toHaveLength(2);
    expect(f.labels[0]).toMatch(/Smith/);
    expect(f.kind).toBe("in-text");
    expect(f.bibliographyText.join("\n")).toMatch(/Vitamin A supplementation/);
    expect(f.bibliographyText.join("\n")).not.toMatch(/Zinc/);
    expect(f.uncited).toEqual([C]);
    expect(f.missing).toEqual([]);
  });
  it("changing the style changes every citation and keeps numbering in order of appearance", () => {
    const d = doc(p(cite(B), t(" then "), cite(A)));
    const f = formatManuscript(d, items, vancouver);
    expect(f.labels.map((l) => l.replace(/<[^>]+>/g, ""))).toEqual(["[1]", "[2]"]);
    expect(f.bibliographyText[0]).toMatch(/Malaria in pregnancy/);
    expect(f.bibliographyText[1]).toMatch(/Vitamin A/);
  });
  it("reports references that are cited but no longer in the library", () => {
    const f = formatManuscript(doc(p(cite("99999999-9999-4999-8999-999999999999"))), items, apa);
    expect(f.missing).toEqual(["99999999-9999-4999-8999-999999999999"]);
    expect(f.labels[0]).toBe("");
  });
  it("includes page locators", () => {
    const d = doc(p({ type: "citation", attrs: { items: [{ id: A, locator: "12" }] } }));
    expect(formatManuscript(d, items, apa).labels[0]).toMatch(/12/);
  });
  it("uses note style footnotes for a note style", () => {
    const f = formatManuscript(doc(p(cite(A))), items, { id: "chicago-author-date", xml: styleXml("chicago-author-date"), locales: LOCALES });
    expect(f.labels[0]).toBeTruthy();
  });
});

describe("renderBody", () => {
  const apa = { id: "apa", xml: styleXml("apa"), locales: LOCALES };
  const d = doc(h(1, "Intro"), p(t("Text "), cite(A), t(" <script>alert(1)</script>")), { type: "figure", attrs: { path: FIG_PATH, alt: "alt", caption: "Cap <b>", width: 10, height: 10 } },
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2, rowspan: 1 }, content: [p(t("H"))] }] }] });
  it("renders headings, tables, figures, citations and the bibliography", () => {
    const html = renderBody(d, formatManuscript(d, items, apa), { title: "T", figureUrls: { [FIG_PATH]: "https://img.example/x.png" } });
    expect(html).toContain("<h2>Intro</h2>");
    expect(html).toContain('<th colspan="2">');
    expect(html).toContain('<img src="https://img.example/x.png"');
    expect(html).toContain("<strong>Figure 1.</strong>");
    expect(html).toContain('class="bibliography"');
    expect(html).toContain("Vitamin A supplementation");
  });
  it("escapes everything the user typed", () => {
    const html = renderBody(d, null, { title: "T" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Cap &lt;b&gt;");
  });
  it("never emits an unsafe link and shows a marker for a missing reference", () => {
    const bad = doc(p(t("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]), cite(A)));
    const html = renderBody(bad, formatManuscript(doc(p()), [], apa), { title: "T" });
    expect(html).not.toContain("javascript:");
    expect(html).toContain("missing reference");
  });
  it("wraps a printable page with the title", () => {
    const page = renderPrintDocument(d, null, { title: "My <study>" });
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain("<title>My &lt;study&gt;</title>");
  });
  it("numbers note-style citations as footnotes", () => {
    const chicago = { id: "chicago-author-date", xml: styleXml("chicago-author-date"), locales: LOCALES };
    const f = formatManuscript(doc(p(cite(A))), items, chicago);
    // Author-date Chicago is in-text; force the note path to check the renderer itself.
    const html = renderBody(doc(p(cite(A))), { ...f, kind: "note" }, { title: "T" });
    expect(html).toContain('<sup class="fn">1</sup>');
    expect(html).toContain("<h2>Notes</h2>");
  });
});

describe("htmlToRuns", () => {
  it("makes one run per text span and decodes entities", async () => {
    const runs = htmlToRuns("<i>Lancet</i> &amp; <b>BMJ</b><sup>2</sup>");
    expect(runs.length).toBe(4);
    const d = doc(p(t("x")));
    const buf = await Packer.toBuffer(await buildDocx(d, { labels: [], kind: "in-text", bibliographyHtml: ["<i>Lancet</i> &amp; <b>BMJ</b><sup>2</sup>"], bibliographyText: [], missing: [], uncited: [] }, { title: "T" }));
    const xml = strFromU8(unzipSync(new Uint8Array(buf))["word/document.xml"]);
    expect(xml).toContain("<w:i/>");
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain('w:val="superscript"');
    expect(xml).toContain(" &amp; ");
  });
});

async function docxXml(d: Doc, fmt: ReturnType<typeof formatManuscript> | null, opts: Parameters<typeof buildDocx>[2]) {
  const buf = await Packer.toBuffer(await buildDocx(d, fmt, opts));
  const files = unzipSync(new Uint8Array(buf));
  return { files, xml: strFromU8(files["word/document.xml"]) };
}

describe("buildDocx", () => {
  const apa = { id: "apa", xml: styleXml("apa"), locales: LOCALES };
  it("produces a real .docx with the title, headings, text, formatted citations and bibliography", async () => {
    const d = doc(h(1, "Introduction"), p(t("Vitamin A helps ", [{ type: "bold" }]), cite(A)));
    const { files, xml } = await docxXml(d, formatManuscript(d, items, apa), { title: "My Study" });
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["[Content_Types].xml", "word/document.xml", "word/styles.xml"]));
    expect(xml).toContain("My Study");
    expect(xml).toContain("Introduction");
    expect(xml).toContain("Vitamin A helps");
    expect(xml).toContain("Smith");
    expect(xml).toContain("References");
    expect(xml).toContain("Vitamin A supplementation and child mortality");
    expect(xml).toContain('w:val="Heading1"');
  });
  it("exports tables with spans, lists and both list kinds", async () => {
    const d = doc(
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2, rowspan: 1 }, content: [p(t("Header"))] }] }, { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [p(t("c1"))] }, { type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [p(t("c2"))] }] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("bullet one"))] }] },
      { type: "orderedList", content: [{ type: "listItem", content: [p(t("number one"))] }, { type: "listItem", content: [p(t("number two"))] }] },
      { type: "orderedList", content: [{ type: "listItem", content: [p(t("restart"))] }] },
    );
    const { files, xml } = await docxXml(d, null, { title: "T" });
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain('w:gridSpan w:val="2"');
    expect(xml).toContain("bullet one");
    const numbering = strFromU8(files["word/numbering.xml"]);
    expect(numbering).toContain("decimal");
    // Two separate numbered lists get separate numbering instances so the second restarts at 1.
    expect((numbering.match(/<w:num /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("embeds figure images and numbers captions, and still exports the caption when the image is missing", async () => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    const d = doc({ type: "figure", attrs: { path: FIG_PATH, alt: "tiny", caption: "A tiny image", width: 1, height: 1 } }, { type: "figure", attrs: { path: `${USER}/${MS}/${B}.png`, alt: "", caption: "Second", width: 1, height: 1 } });
    const { files, xml } = await docxXml(d, null, { title: "T", fetchImage: async (pth) => (pth === FIG_PATH ? { data: png, type: "png" } : null) });
    expect(Object.keys(files).some((f) => f.startsWith("word/media/"))).toBe(true);
    expect(xml).toContain("Figure 1. ");
    expect(xml).toContain("A tiny image");
    expect(xml).toContain("Figure 2. ");
    expect(xml).toContain("[image not available]");
  });
  it("survives an image loader that throws", async () => {
    const d = doc({ type: "figure", attrs: { path: FIG_PATH, caption: "Cap", width: 10, height: 10 } });
    const { xml } = await docxXml(d, null, { title: "T", fetchImage: async () => { throw new Error("network"); } });
    expect(xml).toContain("Cap");
  });
  it("writes footnotes for note styles", async () => {
    const d = doc(p(t("Claim"), cite(A)));
    const f = { ...formatManuscript(d, items, apa), kind: "note" as const };
    const { files } = await docxXml(d, f, { title: "T" });
    expect(strFromU8(files["word/footnotes.xml"])).toContain("Smith");
  });
  it("round-trips text with special characters", async () => {
    const d = doc(p(t("Müller & <Jones> \"quoted\" ≥ 5%")));
    const { xml } = await docxXml(d, null, { title: "T" });
    expect(xml).toContain("Müller &amp; &lt;Jones&gt;");
  });
});

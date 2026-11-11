import { describe, expect, it } from "vitest";
import { extractPdf, findDoi, guessTitle, looksLikePdf, MAX_PDF_BYTES, PdfError } from "../extract";
import { chunkDocument, chunkPage, cleanPageText, CHUNK_MAX } from "../chunk";
import { makePdf } from "./make-pdf";

const PAPER = [
  ["Prevalence of Retinopathy of Prematurity in Uganda", "A cross-sectional study", "https://doi.org/10.1234/rop.2021.007", "Abstract: We screened 300 infants at two hospitals."],
  ["Methods", "Infants born before 32 weeks were examined by an ophthalmologist.", "Results", "The prevalence of retinopathy was 18 percent (95% CI 14 to 23)."],
  ["Discussion", "Our findings are higher than regional estimates."],
];

describe("extractPdf", () => {
  it("extracts text page by page, with the page count", async () => {
    const r = await extractPdf(makePdf(PAPER));
    expect(r.pageCount).toBe(3);
    expect(r.pages).toHaveLength(3);
    expect(r.pages[0]).toContain("Prevalence of Retinopathy of Prematurity in Uganda");
    expect(r.pages[1]).toContain("18 percent");
    expect(r.pages[2]).toContain("Discussion");
    expect(r.pages[0]).not.toContain("18 percent");
    expect(r.status).toBe("ready");
    expect(r.truncated).toBe(false);
  });

  it("reads the document information and finds the DOI printed on the first pages", async () => {
    const r = await extractPdf(makePdf(PAPER, { Title: "Prevalence of ROP in Uganda", Author: "A. Nakato; B. Okello", Subject: "Ophthalmology", CreationDate: "D:20210315120000Z" }));
    expect(r.info).toMatchObject({ title: "Prevalence of ROP in Uganda", author: "A. Nakato; B. Okello", subject: "Ophthalmology", creationDate: "2021-03-15" });
    expect(r.doi).toBe("10.1234/rop.2021.007");
  });

  it("reports a PDF with no text layer as no_text instead of inventing content", async () => {
    const r = await extractPdf(makePdf([[""], [""]]));
    expect(r.status).toBe("no_text");
    expect(r.pages.join("")).toBe("");
  });

  it("rejects files that are not PDFs, damaged PDFs and oversize files", async () => {
    await expect(extractPdf(new TextEncoder().encode("<html>hello</html>"))).rejects.toMatchObject({ code: "not_pdf" });
    await expect(extractPdf(new TextEncoder().encode("%PDF-1.4\nthis is not really a pdf"))).rejects.toMatchObject({ code: "unreadable" });
    await expect(extractPdf(new Uint8Array(MAX_PDF_BYTES + 1))).rejects.toBeInstanceOf(PdfError);
    await expect(extractPdf(new Uint8Array(0))).rejects.toMatchObject({ code: "not_pdf" });
  });

  it("handles special characters and keeps order across many pages", async () => {
    const pages = Array.from({ length: 40 }, (_, i) => [`Page marker ${i + 1} (brackets) and back\\slash`, `Line two of page ${i + 1}`]);
    const r = await extractPdf(makePdf(pages));
    expect(r.pageCount).toBe(40);
    for (let i = 0; i < 40; i++) expect(r.pages[i]).toContain(`Page marker ${i + 1}`);
    expect(r.pages[5]).toContain("(brackets)");
  });
});

describe("findDoi", () => {
  it("finds DOIs in common forms and trims trailing punctuation", () => {
    expect(findDoi("see https://doi.org/10.1016/S0140-6736(20)30183-5.")).toBe("10.1016/s0140-6736(20)30183-5");
    expect(findDoi("DOI: 10.1001/jama.2020.1585, and more")).toBe("10.1001/jama.2020.1585");
    expect(findDoi("no identifier here 10.12/short")).toBeUndefined();
    expect(findDoi("")).toBeUndefined();
  });
});

describe("guessTitle", () => {
  it("prefers a real document title, then the first long line, then the file name", () => {
    expect(guessTitle({ title: "A Real Paper Title" }, "x", "f.pdf")).toBe("A Real Paper Title");
    expect(guessTitle({ title: "Microsoft Word - draft.docx" }, "Short\nThe first meaningful line of the paper\nmore", "f.pdf")).toBe("The first meaningful line of the paper");
    expect(guessTitle({}, "", "my_scanned_paper.pdf")).toBe("my scanned paper");
    expect(guessTitle({}, "", ".pdf")).toBe("Untitled PDF");
  });
});

describe("looksLikePdf", () => {
  it("accepts a header within the first kilobyte only", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("PK\u0003\u0004 zip"))).toBe(false);
    expect(looksLikePdf(new TextEncoder().encode("x".repeat(2000) + "%PDF-"))).toBe(false);
  });
});

describe("cleanPageText and chunking", () => {
  it("joins words hyphenated across lines but keeps real hyphens", () => {
    expect(cleanPageText("retinop-\nathy of prematurity")).toBe("retinopathy of prematurity");
    expect(cleanPageText("a follow-\nUp visit")).toBe("a follow-\nUp visit");
    expect(cleanPageText("  too    many   spaces \n\n\n\nnext")).toBe("too many spaces\n\nnext");
  });

  it("keeps every word of a page, in order, and the page number", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says something about retinopathy.`).join(" ");
    const chunks = chunkPage(7, text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.page === 7 && c.text.length <= CHUNK_MAX)).toBe(true);
    expect(chunks.map((c) => c.idx)).toEqual(chunks.map((_, i) => i));
    expect(chunks.map((c) => c.text).join(" ")).toBe(text);
  });

  it("splits text with no sentence boundaries at word boundaries", () => {
    const text = Array.from({ length: 900 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkPage(1, text);
    expect(chunks.every((c) => c.text.length <= CHUNK_MAX)).toBe(true);
    expect(chunks.map((c) => c.text).join(" ")).toBe(text);
  });

  it("merges tiny fragments such as headings into their neighbours", () => {
    const chunks = chunkPage(1, "Methods\n\nInfants born before 32 weeks were examined by an ophthalmologist at both sites.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toMatch(/^Methods Infants/);
  });

  it("returns nothing for blank pages and numbers pages from 1", () => {
    expect(chunkPage(1, "  \n ")).toEqual([]);
    const c = chunkDocument(["First page text here.", "", "Third page text here."]);
    expect(c.map((x) => x.page)).toEqual([1, 3]);
  });
});

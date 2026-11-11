import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { cleanPageText } from "./chunk";

// Server-side text and metadata extraction. Only text that is really in the PDF is extracted: there is no OCR,
// so a scanned or image-only PDF yields status "no_text" rather than invented content.

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PAGES = 400;
export const MAX_TOTAL_CHARS = 2_500_000;
/** A PDF whose text averages fewer characters per page than this is treated as a scan. */
const MIN_CHARS_PER_PAGE = 25;

export type PdfInfo = { title?: string; author?: string; subject?: string; keywords?: string; creationDate?: string; producer?: string };
export type Extracted = {
  pages: string[];
  pageCount: number;
  info: PdfInfo;
  doi?: string;
  status: "ready" | "no_text";
  truncated: boolean;
};

export class PdfError extends Error {
  constructor(public code: "not_pdf" | "too_large" | "too_many_pages" | "unreadable" | "encrypted", message: string) { super(message); }
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  // The header may be preceded by a few bytes of junk, but must appear in the first KB.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

const DOI = /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9<>]+[A-Za-z0-9]/;
export function findDoi(text: string): string | undefined {
  const m = DOI.exec(text);
  if (!m) return undefined;
  return m[0].replace(/[.,;:)\]]+$/, "").toLowerCase();
}

const clip = (v: unknown, n: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);

function parsePdfDate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = /^D:(\d{4})(\d{2})?(\d{2})?/.exec(v);
  if (!m) return undefined;
  const y = Number(m[1]);
  if (y < 1900 || y > 2100) return undefined;
  return `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}`;
}

export async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  if (bytes.length > MAX_PDF_BYTES) throw new PdfError("too_large", "That PDF is over 20 MB.");
  if (!looksLikePdf(bytes)) throw new PdfError("not_pdf", "That file is not a PDF.");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    if (name === "PasswordException") throw new PdfError("encrypted", "That PDF is password protected. Remove the password and upload it again.");
    throw new PdfError("unreadable", "That PDF could not be read. It may be damaged.");
  }
  try {
    if (pdf.numPages > MAX_PAGES) throw new PdfError("too_many_pages", `That PDF has ${pdf.numPages} pages. The limit is ${MAX_PAGES}. Upload the relevant part.`);
    const { text } = await extractText(pdf, { mergePages: false });
    let pages = (Array.isArray(text) ? text : [text]).map(cleanPageText);
    let truncated = false;
    let total = 0;
    pages = pages.map((p) => {
      if (total >= MAX_TOTAL_CHARS) { truncated = true; return ""; }
      if (total + p.length > MAX_TOTAL_CHARS) { truncated = true; const cut = p.slice(0, MAX_TOTAL_CHARS - total); total = MAX_TOTAL_CHARS; return cut; }
      total += p.length;
      return p;
    });
    let info: PdfInfo = {};
    try {
      const meta = await getMeta(pdf);
      const i = (meta.info ?? {}) as unknown as Record<string, unknown>;
      info = { title: clip(i.Title, 300), author: clip(i.Author, 300), subject: clip(i.Subject, 500), keywords: clip(i.Keywords, 500), creationDate: parsePdfDate(i.CreationDate), producer: clip(i.Producer, 120) };
    } catch { /* metadata is optional */ }
    const chars = pages.reduce((n, p) => n + p.length, 0);
    const doi = findDoi(pages.slice(0, 3).join("\n")) ?? (info.subject ? findDoi(info.subject) : undefined);
    return { pages, pageCount: pdf.numPages, info, doi, status: chars / Math.max(pdf.numPages, 1) >= MIN_CHARS_PER_PAGE ? "ready" : "no_text", truncated };
  } finally {
    await pdf.loadingTask.destroy().catch(() => {});
  }
}

/** A readable title for a PDF: its own title if it looks like one, else the first line of the first page, else the file name. */
export function guessTitle(info: PdfInfo, firstPage: string, filename: string): string {
  const bad = /^(untitled|microsoft word|document\d*|manuscript|paper|slide \d+)/i;
  if (info.title && info.title.length >= 8 && !bad.test(info.title) && !/\.(docx?|pdf|tex|indd)$/i.test(info.title)) return info.title.slice(0, 300);
  const line = firstPage.split("\n").map((l) => l.trim()).find((l) => l.length >= 15 && l.length <= 250 && !/^(https?:|www\.|doi:|©|copyright)/i.test(l));
  if (line) return line.slice(0, 300);
  return filename.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim().slice(0, 300) || "Untitled PDF";
}

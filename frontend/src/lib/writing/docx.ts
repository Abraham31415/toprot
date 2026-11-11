import {
  AlignmentType, Document, ExternalHyperlink, Footer, FootnoteReferenceRun, HeadingLevel, ImageRun, LevelFormat, Paragraph, PageNumber,
  ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import { safeHref, type Doc, type DocNode } from "./doc";
import type { FormattedManuscript } from "./format";

export type FigureImage = { data: Uint8Array; type: "png" | "jpg" | "gif" };
export type DocxOptions = {
  title: string;
  author?: string;
  bibliographyHeading?: string;
  /** Loads a figure's bytes by storage path. Return null if it cannot be loaded; the caption is still exported. */
  fetchImage?: (path: string) => Promise<FigureImage | null>;
};

const FONT = "Times New Roman";
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
const MAX_IMG_WIDTH = 600;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#38;": "&", "&#60;": "<", "&#62;": ">", "&nbsp;": " ", "&#160;": " " };
const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|nbsp|#38|#60|#62|#160);/g, (m) => ENTITIES[m] ?? m).replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

type Fmt = { bold?: boolean; italics?: boolean; underline?: boolean; sup?: boolean; sub?: boolean; smallCaps?: boolean };

/** Turns the small subset of HTML that CSL produces (i, b, sup, sub, span with font styles) into Word runs. */
export function htmlToRuns(html: string, base: Fmt = {}): TextRun[] {
  const runs: TextRun[] = [];
  const stack: Fmt[] = [base];
  const re = /<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|([^<]+)/gi;
  for (const m of html.matchAll(re)) {
    if (m[4] !== undefined) {
      const f = stack[stack.length - 1];
      const text = decode(m[4]);
      if (text) runs.push(new TextRun({ text, font: FONT, bold: f.bold, italics: f.italics, underline: f.underline ? {} : undefined, superScript: f.sup, subScript: f.sub, smallCaps: f.smallCaps }));
      continue;
    }
    const closing = m[1] === "/", tag = m[2].toLowerCase(), attrs = m[3] ?? "";
    if (tag === "br") { runs.push(new TextRun({ break: 1 })); continue; }
    if (closing) { if (stack.length > 1) stack.pop(); continue; }
    const cur = { ...stack[stack.length - 1] };
    if (tag === "i" || tag === "em") cur.italics = true;
    if (tag === "b" || tag === "strong") cur.bold = true;
    if (tag === "u") cur.underline = true;
    if (tag === "sup") cur.sup = true;
    if (tag === "sub") cur.sub = true;
    if (/font-style:\s*italic/.test(attrs)) cur.italics = true;
    if (/font-weight:\s*bold/.test(attrs)) cur.bold = true;
    if (/font-variant:\s*small-caps/.test(attrs)) cur.smallCaps = true;
    stack.push(cur);
  }
  return runs;
}

export async function buildDocx(doc: Doc, fmt: FormattedManuscript | null, opts: DocxOptions): Promise<Document> {
  let citeIdx = 0, figN = 0;
  const footnotes: Record<number, { children: Paragraph[] }> = {};
  const orderedRefs: string[] = [];
  const images = new Map<string, FigureImage | null>();

  // Load every figure first so the conversion itself stays synchronous.
  if (opts.fetchImage) {
    const paths: string[] = [];
    const find = (n: DocNode) => { if (n.type === "figure") paths.push(String(n.attrs?.path)); n.content?.forEach(find); };
    doc.content.forEach(find);
    await Promise.all([...new Set(paths)].map(async (p) => { try { images.set(p, await opts.fetchImage!(p)); } catch { images.set(p, null); } }));
  }

  const inline = (n: DocNode, marks: Fmt = {}): (TextRun | ExternalHyperlink | FootnoteReferenceRun)[] => {
    if (n.type === "text") {
      const f: Fmt = { ...marks };
      let href: string | null = null;
      for (const m of n.marks ?? []) {
        if (m.type === "bold") f.bold = true;
        if (m.type === "italic") f.italics = true;
        if (m.type === "underline") f.underline = true;
        if (m.type === "superscript") f.sup = true;
        if (m.type === "subscript") f.sub = true;
        if (m.type === "link") href = safeHref(m.attrs?.href);
      }
      const strike = n.marks?.some((m) => m.type === "strike");
      const code = n.marks?.some((m) => m.type === "code");
      const run = new TextRun({ text: n.text ?? "", font: code ? "Consolas" : FONT, bold: f.bold, italics: f.italics, underline: f.underline || href ? {} : undefined, strike, superScript: f.sup, subScript: f.sub, color: href ? "1F4E9E" : undefined });
      return [href ? new ExternalHyperlink({ link: href, children: [run] }) : run];
    }
    if (n.type === "hardBreak") return [new TextRun({ break: 1 })];
    if (n.type === "citation") {
      const label = fmt?.labels[citeIdx++] ?? "";
      if (!label) return [new TextRun({ text: "[missing reference]", font: FONT, color: "B00020" })];
      if (fmt?.kind === "note") {
        const id = Object.keys(footnotes).length + 1;
        footnotes[id] = { children: [new Paragraph({ children: htmlToRuns(label) })] };
        return [new FootnoteReferenceRun(id)];
      }
      return htmlToRuns(label, marks);
    }
    return (n.content ?? []).flatMap((c) => inline(c, marks));
  };
  const inlines = (n: DocNode, marks?: Fmt) => (n.content ?? []).flatMap((c) => inline(c, marks));

  type Block = Paragraph | Table;
  const block = (n: DocNode, listCtx?: { ref: string; level: number; bullet: boolean }): Block[] => {
    switch (n.type) {
      case "paragraph": {
        const p = new Paragraph({
          children: inlines(n),
          ...(listCtx ? (listCtx.bullet ? { bullet: { level: listCtx.level } } : { numbering: { reference: listCtx.ref, level: listCtx.level } }) : {}),
        });
        return [p];
      }
      case "heading": return [new Paragraph({ heading: HEADINGS[Math.min(Math.max(Number(n.attrs?.level ?? 2), 1), 4) - 1], children: inlines(n, {}) })];
      case "bulletList":
      case "orderedList": {
        const bullet = n.type === "bulletList";
        let ref = listCtx?.ref ?? "";
        const level = listCtx ? listCtx.level + 1 : 0;
        if (!bullet && !listCtx) { ref = `ol-${orderedRefs.length}`; orderedRefs.push(ref); }
        if (!bullet && listCtx) ref = listCtx.ref;
        if (!bullet && !ref) { ref = `ol-${orderedRefs.length}`; orderedRefs.push(ref); }
        return (n.content ?? []).flatMap((li) => (li.content ?? []).flatMap((c) => block(c, { ref, level: Math.min(level, 5), bullet })));
      }
      case "blockquote": return (n.content ?? []).flatMap((c) => block(c)).map((b) => b);
      case "codeBlock": return [new Paragraph({ children: [new TextRun({ text: (n.content ?? []).map((c) => c.text ?? "").join(""), font: "Consolas", size: 20 })], shading: { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" } })];
      case "horizontalRule": return [new Paragraph({ border: { bottom: { style: "single", size: 6, color: "999999", space: 1 } }, children: [] })];
      case "table": {
        const rows = (n.content ?? []).map((row) => new TableRow({
          children: (row.content ?? []).map((cell) => {
            const kids = (cell.content ?? []).flatMap((c) => block(c));
            const header = cell.type === "tableHeader";
            return new TableCell({
              children: kids.length ? kids : [new Paragraph("")],
              columnSpan: Number(cell.attrs?.colspan ?? 1) > 1 ? Number(cell.attrs?.colspan) : undefined,
              rowSpan: Number(cell.attrs?.rowspan ?? 1) > 1 ? Number(cell.attrs?.rowspan) : undefined,
              shading: header ? { type: ShadingType.CLEAR, fill: "E8E8E8", color: "auto" } : undefined,
              margins: { top: 40, bottom: 40, left: 80, right: 80 },
            });
          }),
          tableHeader: row.content?.[0]?.type === "tableHeader",
        }));
        return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }), new Paragraph("")];
      }
      case "figure": {
        figN++;
        const out: Paragraph[] = [];
        const img = images.get(String(n.attrs?.path));
        if (img) {
          const w = Number(n.attrs?.width ?? 600), h = Number(n.attrs?.height ?? 400);
          const scale = Math.min(1, MAX_IMG_WIDTH / w);
          out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(w * scale), height: Math.round(h * scale) }, altText: { name: "Figure", description: String(n.attrs?.alt ?? "") || `Figure ${figN}`, title: `Figure ${figN}` } })] }));
        } else out.push(new Paragraph({ children: [new TextRun({ text: "[image not available]", font: FONT, italics: true })] }));
        out.push(new Paragraph({ children: [new TextRun({ text: `Figure ${figN}. `, bold: true, font: FONT, size: 22 }), new TextRun({ text: String(n.attrs?.caption ?? ""), font: FONT, size: 22 })] }));
        return out;
      }
      default: return [];
    }
  };

  const children: Block[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: opts.title, font: FONT, bold: true, size: 40 })] }),
    ...doc.content.flatMap((b) => block(b)),
  ];
  const entries = fmt?.bibliographyHtml ?? [];
  if (entries.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: opts.bibliographyHeading ?? "References", font: FONT })] }));
    for (const html of entries) {
      // Hanging indent, as most reference styles use. Numbered styles keep their number as part of the entry text.
      children.push(new Paragraph({ children: htmlToRuns(html), indent: { left: 540, hanging: 540 }, spacing: { after: 120 } }));
    }
  }

  const numbering = {
    config: orderedRefs.map((reference) => ({
      reference,
      levels: Array.from({ length: 6 }, (_, level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } } })),
    })),
  };

  return new Document({
    creator: opts.author ?? "ToProt",
    title: opts.title,
    numbering,
    footnotes,
    styles: {
      default: { document: { run: { font: FONT, size: 24 }, paragraph: { spacing: { line: 360, after: 120 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 32, bold: true }, paragraph: { spacing: { before: 320, after: 120 }, keepNext: true } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 27, bold: true }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 24, bold: true }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true } },
        { id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 24, bold: true, italics: true }, paragraph: { spacing: { before: 160, after: 60 }, keepNext: true } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1418, bottom: 1418, left: 1247, right: 1247 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20 })] })] }) },
      children,
    }],
  });
}

// The manuscript document model: the subset of TipTap/ProseMirror JSON that ToProt stores.
// Everything that reaches the database goes through validateDoc, so stored content only ever holds
// node and mark types this app knows how to edit, render and export.

export type Mark = { type: string; attrs?: Record<string, unknown> };
export type CitationRef = { id: string; locator?: string };
export type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: Mark[];
  text?: string;
};
export type Doc = { type: "doc"; content: DocNode[] };

export const EMPTY_DOC: Doc = { type: "doc", content: [] };

export const MAX_DOC_BYTES = 2_000_000;
const MAX_NODES = 150_000;
const MAX_DEPTH = 24;
const MAX_TEXT = 200_000;

const BLOCKS = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "horizontalRule", "table", "tableRow", "tableCell", "tableHeader", "figure"]);
const INLINES = new Set(["text", "hardBreak", "citation"]);
const MARKS = new Set(["bold", "italic", "underline", "strike", "code", "superscript", "subscript", "link"]);

export const FIGURE_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class DocError extends Error {}

export function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const h = href.trim();
  if (h.length > 2000) return null;
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length ? v.slice(0, max) : undefined);

function cleanAttrs(node: DocNode, manuscriptId: string | null): Record<string, unknown> | undefined {
  const a = node.attrs ?? {};
  switch (node.type) {
    case "heading": return { level: int(a.level, 1, 4, 2) };
    case "orderedList": return { start: int(a.start, 1, 100000, 1) };
    case "tableCell":
    case "tableHeader": {
      const out: Record<string, unknown> = { colspan: int(a.colspan, 1, 30, 1), rowspan: int(a.rowspan, 1, 200, 1) };
      if (Array.isArray(a.colwidth) && a.colwidth.every((n) => typeof n === "number" && n > 0 && n < 5000)) out.colwidth = a.colwidth;
      return out;
    }
    case "codeBlock": return { language: str(a.language, 40) ?? null };
    case "figure": {
      const path = typeof a.path === "string" ? a.path : "";
      if (!FIGURE_PATH.test(path)) throw new DocError("A figure points to an image that is not allowed.");
      if (manuscriptId && path.split("/")[1] !== manuscriptId) throw new DocError("A figure belongs to a different manuscript.");
      return { path, alt: str(a.alt, 300) ?? "", caption: str(a.caption, 1000) ?? "", width: int(a.width, 1, 20000, 600), height: int(a.height, 1, 20000, 400) };
    }
    case "citation": {
      const raw = Array.isArray(a.items) ? a.items : [];
      const items: CitationRef[] = [];
      for (const it of raw.slice(0, 30)) {
        const o = it as Record<string, unknown>;
        if (typeof o?.id !== "string" || !UUID.test(o.id)) throw new DocError("A citation points to an unknown reference.");
        const locator = str(o.locator, 60);
        items.push(locator ? { id: o.id, locator } : { id: o.id });
      }
      if (!items.length) throw new DocError("A citation has no references.");
      return { items };
    }
    default: return undefined;
  }
}

function cleanMarks(marks: unknown): Mark[] | undefined {
  if (marks === undefined) return undefined;
  if (!Array.isArray(marks)) throw new DocError("Invalid formatting.");
  const out: Mark[] = [];
  for (const m of marks) {
    const type = (m as Mark)?.type;
    if (typeof type !== "string" || !MARKS.has(type)) throw new DocError(`Unsupported formatting: ${String(type).slice(0, 30)}.`);
    if (type === "link") {
      const href = safeHref((m as Mark).attrs?.href);
      if (!href) continue; // an unsafe link keeps its text but loses the link
      out.push({ type, attrs: { href } });
    } else out.push({ type });
  }
  return out.length ? out : undefined;
}

type Budget = { nodes: number };

function cleanNode(n: unknown, depth: number, budget: Budget, manuscriptId: string | null): DocNode {
  if (typeof n !== "object" || n === null || Array.isArray(n)) throw new DocError("Invalid content.");
  const node = n as DocNode;
  if (depth > MAX_DEPTH) throw new DocError("Content is nested too deeply.");
  if (++budget.nodes > MAX_NODES) throw new DocError("The document is too large.");
  const type = node.type;
  if (typeof type !== "string" || !(BLOCKS.has(type) || INLINES.has(type))) throw new DocError(`Unsupported content: ${String(type).slice(0, 30)}.`);
  const out: DocNode = { type };
  if (type === "text") {
    if (typeof node.text !== "string" || !node.text.length) throw new DocError("Invalid text.");
    if (node.text.length > MAX_TEXT) throw new DocError("A paragraph is too long.");
    out.text = node.text;
    const marks = cleanMarks(node.marks);
    if (marks) out.marks = marks;
    return out;
  }
  const attrs = cleanAttrs(node, manuscriptId);
  if (attrs) out.attrs = attrs;
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) throw new DocError("Invalid content.");
    if (type === "horizontalRule" || type === "hardBreak" || type === "figure" || type === "citation") throw new DocError(`${type} cannot hold content.`);
    out.content = node.content.map((c) => cleanNode(c, depth + 1, budget, manuscriptId));
  }
  return out;
}

/** Validates and normalises editor JSON. Throws DocError with a message safe to show the user. */
export function validateDoc(input: unknown, manuscriptId: string | null = null): Doc {
  if (typeof input !== "object" || input === null || (input as DocNode).type !== "doc") throw new DocError("That is not a manuscript.");
  const size = JSON.stringify(input).length;
  if (size > MAX_DOC_BYTES) throw new DocError("This manuscript is too large to save. Split it into chapters or remove large tables.");
  const content = (input as DocNode).content ?? [];
  if (!Array.isArray(content)) throw new DocError("Invalid content.");
  const budget: Budget = { nodes: 0 };
  return { type: "doc", content: content.map((c) => cleanNode(c, 1, budget, manuscriptId)) };
}

// ---- Reading a document ----

/** Plain text of one block, with hard breaks as spaces and citations omitted. */
function inlineText(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  return (node.content ?? []).map(inlineText).join("");
}

const WORD = /[\p{L}\p{N}]/u;
export function countWordsIn(text: string): number {
  let n = 0;
  for (const tok of text.split(/\s+/)) if (tok && WORD.test(tok)) n++;
  return n;
}

const TEXT_BLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

/** Visits every text-bearing block in order. Figure captions count as text; citations never do. */
export function eachTextBlock(doc: DocNode, fn: (text: string, node: DocNode) => void): void {
  const walk = (n: DocNode) => {
    if (TEXT_BLOCKS.has(n.type)) { fn(n.content?.map(inlineText).join("") ?? "", n); return; }
    if (n.type === "figure") { const c = String(n.attrs?.caption ?? ""); if (c) fn(c, n); return; }
    n.content?.forEach(walk);
  };
  walk(doc);
}

export function countWords(doc: DocNode): number {
  let n = 0;
  eachTextBlock(doc, (t) => { n += countWordsIn(t); });
  return n;
}

/** Words per top-level section (heading level 1 or 2), so a section can be checked against its limit. */
export function sectionWordCounts(doc: Doc): { title: string; level: number; words: number }[] {
  const out: { title: string; level: number; words: number }[] = [];
  let cur: { title: string; level: number; words: number } | null = null;
  for (const block of doc.content) {
    if (block.type === "heading") {
      cur = { title: block.content?.map(inlineText).join("") ?? "", level: Number(block.attrs?.level ?? 2), words: 0 };
      out.push(cur);
    } else if (cur) {
      eachTextBlock({ type: "doc", content: [block] } as DocNode, (t) => { cur!.words += countWordsIn(t); });
    }
  }
  return out;
}

export type Heading = { level: number; text: string };
export function outline(doc: Doc): Heading[] {
  return doc.content.filter((b) => b.type === "heading").map((b) => ({ level: Number(b.attrs?.level ?? 2), text: b.content?.map(inlineText).join("") ?? "" }));
}

/** Citation clusters in the order they appear in the document. */
export function collectCitations(doc: DocNode): CitationRef[][] {
  const out: CitationRef[][] = [];
  const walk = (n: DocNode) => {
    if (n.type === "citation") { out.push((n.attrs?.items as CitationRef[]) ?? []); return; }
    n.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

export function citedIds(doc: DocNode): string[] {
  return [...new Set(collectCitations(doc).flat().map((c) => c.id))];
}

/** Removes references that no longer exist from every citation. A citation left empty is removed. */
export function dropMissingCitations(doc: Doc, known: Set<string>): { doc: Doc; removed: number } {
  let removed = 0;
  const walk = (nodes: DocNode[]): DocNode[] => nodes.flatMap((n) => {
    if (n.type === "citation") {
      const items = ((n.attrs?.items as CitationRef[]) ?? []).filter((i) => known.has(i.id));
      removed += ((n.attrs?.items as CitationRef[]) ?? []).length - items.length;
      return items.length ? [{ ...n, attrs: { items } }] : [];
    }
    return [n.content ? { ...n, content: walk(n.content) } : n];
  });
  return { doc: { type: "doc", content: walk(doc.content) }, removed };
}

export function plainText(doc: Doc): string {
  const lines: string[] = [];
  const walk = (n: DocNode) => {
    if (TEXT_BLOCKS.has(n.type)) { lines.push(n.content?.map(inlineText).join("") ?? ""); return; }
    n.content?.forEach(walk);
  };
  walk(doc);
  return lines.join("\n");
}

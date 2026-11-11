// Splits extracted page text into passages for search and question answering.
// Every passage keeps the PDF page it came from, which is what makes page references possible.

export type Chunk = { page: number; idx: number; text: string };

export const CHUNK_TARGET = 1200;
export const CHUNK_MAX = 1800;
export const MAX_CHUNKS = 6000;

/**
 * Tidies text as extracted from a PDF without changing what it says: joins words hyphenated across a line break
 * (only when the next line starts in lower case, so "follow-up" at a line end is kept), collapses runs of spaces,
 * and keeps paragraph breaks.
 */
export function cleanPageText(raw: string): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/([A-Za-zÀ-ɏ]{2,})-\n(?=[a-zà-ÿ])/g, "$1")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^.!?]+(?:[.!?]+["')\]]*(?:\s+|$)|$)|[.!?]+/g);
  return (parts ?? [paragraph]).map((s) => s.trim()).filter(Boolean);
}

/** Cuts text that has no sentence boundary (tables, reference lists) at word boundaries so no passage exceeds the maximum. */
function hardSplit(s: string): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > CHUNK_MAX) {
    const at = rest.lastIndexOf(" ", CHUNK_MAX);
    const cut = at > CHUNK_MAX / 2 ? at : CHUNK_MAX;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Splits one page. Paragraphs are kept whole where they fit; longer ones are cut at sentence boundaries, then at word boundaries. */
export function chunkPage(page: number, text: string): Chunk[] {
  const clean = cleanPageText(text);
  if (!clean) return [];
  const pieces: string[] = [];
  for (const para of clean.split(/\n{2,}|\n(?=[A-Z0-9][^\n]{0,80}\n)/)) {
    const p = para.replace(/\n/g, " ").replace(/ {2,}/g, " ").trim();
    if (!p) continue;
    if (p.length <= CHUNK_MAX) { pieces.push(p); continue; }
    let cur = "";
    for (const s of splitSentences(p)) {
      if (s.length > CHUNK_MAX) {
        if (cur) { pieces.push(cur); cur = ""; }
        pieces.push(...hardSplit(s));
        continue;
      }
      if (cur && cur.length + s.length + 1 > CHUNK_TARGET) { pieces.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
    }
    if (cur) pieces.push(cur);
  }
  // Merge tiny neighbours (headings, one-line fragments) so passages carry enough context.
  const merged: string[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last !== undefined && (last.length < 200 || p.length < 80) && last.length + p.length + 1 <= CHUNK_TARGET) merged[merged.length - 1] = `${last} ${p}`;
    else merged.push(p);
  }
  return merged.map((t, idx) => ({ page, idx, text: t }));
}

export function chunkDocument(pages: string[]): Chunk[] {
  const out: Chunk[] = [];
  pages.forEach((text, i) => { out.push(...chunkPage(i + 1, text)); });
  return out;
}

// A small, dependency-free reader for Office Open XML spreadsheets (.xlsx). It reads cell values only (no formulas are evaluated:
// the cached value Excel saved is used), shared and inline strings, booleans, and recognises date-formatted numbers.
// Works in the browser and in Node (uses DecompressionStream for deflate).

import { DataError } from "../types";

type ZipEntry = { name: string; method: number; compressedSize: number; size: number; offset: number };

const MAX_UNCOMPRESSED = 400 * 1024 * 1024; // zip-bomb guard: refuse archives that claim to inflate beyond this
const MAX_ENTRIES = 5000;

function readEntries(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new DataError("This file is not a valid .xlsx workbook (no zip directory found).");
  const count = dv.getUint16(eocd + 10, true);
  if (count > MAX_ENTRIES) throw new DataError("This workbook has too many internal parts to read safely.");
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  let total = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new DataError("The workbook's zip directory is damaged.");
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    total += size;
    if (total > MAX_UNCOMPRESSED) throw new DataError("This workbook expands to more data than can be imported.");
    out.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(buf: Uint8Array, e: ZipEntry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new DataError("The workbook's zip data is damaged.");
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  const raw = buf.subarray(start, start + e.compressedSize);
  let bytes: Uint8Array;
  if (e.method === 0) bytes = raw;
  else if (e.method === 8) bytes = await inflateRaw(raw);
  else throw new DataError("This workbook uses a compression method that is not supported.");
  if (bytes.length > e.size + 1024 && e.size > 0) throw new DataError("A workbook part is larger than its declared size.");
  return new TextDecoder("utf-8").decode(bytes);
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function xmlText(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITY[e]);
}
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** Concatenates every <t> inside a fragment (handles rich-text runs). Phonetic runs (<rPh>) are skipped. */
function allText(fragment: string): string {
  const cleaned = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let s = "";
  for (const m of cleaned.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) s += m[1] ? xmlText(m[1]) : "";
  return s;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function isDateFormat(id: number, code: string | undefined): boolean {
  if (BUILTIN_DATE_FORMATS.has(id)) return true;
  if (!code) return false;
  const stripped = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[dmyhs]/i.test(stripped) && !/[0#?]/.test(stripped.replace(/[dmyhs]/gi, ""));
}

/** Excel serial date to ISO. Handles the 1900 leap-year bug and the 1904 date system. */
export function excelSerialToIso(serial: number, date1904 = false): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = Math.round(serial * 86400) * 1000;
  const d = new Date(epoch + ms);
  const iso = d.toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 19);
}

function colNumber(ref: string): number {
  let n = 0;
  for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); }
  return n - 1;
}

export type XlsxSheet = { name: string; rows: (string | number | null)[][] };

/** Lists sheet names, then reads the requested sheet (default the first) as a grid of raw values. */
export async function readXlsx(bytes: Uint8Array, sheetName?: string, maxRows = Infinity): Promise<{ sheets: string[]; sheet: XlsxSheet; dateColumns: Set<number> }> {
  const entries = readEntries(bytes);
  const byName = new Map(entries.map((e) => [e.name.replace(/^\/+/, ""), e]));
  const get = async (n: string) => { const e = byName.get(n); return e ? readEntry(bytes, e) : null; };

  const wb = await get("xl/workbook.xml");
  if (!wb) throw new DataError("This file is not an .xlsx workbook (it may be an older .xls file: save it as .xlsx or CSV and try again).");
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wb);
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: xmlText(attr(m[0], "name") ?? ""), rid: attr(m[0], "r:id") ?? "" }));
  if (!sheets.length) throw new DataError("The workbook has no sheets.");
  const target = sheetName ? sheets.find((s) => s.name === sheetName) : sheets[0];
  if (!target) throw new DataError(`The workbook has no sheet called "${sheetName}".`);

  const rels = (await get("xl/_rels/workbook.xml.rels")) ?? "";
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, "Id") === target.rid);
  let path = rel ? attr(rel, "Target") ?? "" : "worksheets/sheet1.xml";
  path = path.startsWith("/") ? path.slice(1) : `xl/${path}`;
  path = path.replace(/[^/]+\/\.\.\//g, "");

  const sst = (await get("xl/sharedStrings.xml")) ?? "";
  const shared = [...sst.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => (m[1] ? allText(m[1]) : ""));

  const styles = (await get("xl/styles.xml")) ?? "";
  const fmtCodes = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) fmtCodes.set(Number(attr(m[0], "numFmtId")), xmlText(attr(m[0], "formatCode") ?? ""));
  const xfBlock = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const xfIsDate = [...xfBlock.matchAll(/<xf\b[^>]*>/g)].map((m) => { const id = Number(attr(m[0], "numFmtId") ?? 0); return isDateFormat(id, fmtCodes.get(id)); });

  const xml = await get(path);
  if (xml === null) throw new DataError("The selected sheet could not be found inside the workbook.");

  const rows: (string | number | null)[][] = [];
  const dateCount = new Map<number, number>();
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let lastRow = 0;
  for (const rm of xml.matchAll(rowRe)) {
    if (rows.length >= maxRows) break;
    const rAttr = rm[1] ? attr(` ${rm[1]}`, "r") : undefined;
    const rowNo = rAttr ? Number(rAttr) : lastRow + 1;
    while (lastRow + 1 < rowNo && rows.length < maxRows) { rows.push([]); lastRow++; } // keep blank rows so row numbers line up
    lastRow = rowNo;
    const row: (string | number | null)[] = [];
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = ` ${cm[1]}`;
      const ref = attr(tag, "r");
      const col = ref ? colNumber(ref) : row.length;
      const t = attr(tag, "t");
      const s = Number(attr(tag, "s") ?? 0);
      const body = cm[2] ?? "";
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val: string | number | null = null;
      if (t === "s") val = v !== undefined ? shared[Number(v)] ?? null : null;
      else if (t === "inlineStr") val = allText(body);
      else if (t === "str") val = v !== undefined ? xmlText(v) : null;
      else if (t === "b") val = v === "1" ? 1 : v === "0" ? 0 : null;
      else if (t === "e") val = null;
      else if (v !== undefined && v !== "") {
        const num = Number(v);
        if (Number.isFinite(num) && xfIsDate[s]) { val = excelSerialToIso(num, date1904); dateCount.set(col, (dateCount.get(col) ?? 0) + 1); }
        else val = Number.isFinite(num) ? num : xmlText(v);
      }
      while (row.length < col) row.push(null);
      row[col] = val;
    }
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((c) => c === null || c === "")) rows.pop();
  return { sheets: sheets.map((s) => s.name), sheet: { name: target.name, rows }, dateColumns: new Set(dateCount.keys()) };
}

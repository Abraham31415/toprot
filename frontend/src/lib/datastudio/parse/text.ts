// Text decoding and delimited-text parsing (CSV, TSV, semicolon and pipe separated). RFC 4180 quoting.

export type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

/** Detects the encoding from a byte-order mark, then by checking whether the bytes are valid UTF-8; falls back to Windows-1252. */
export function detectEncoding(bytes: Uint8Array): { encoding: Encoding; bom: number } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: "utf-8", bom: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: "utf-16le", bom: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: "utf-16be", bom: 2 };
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 4_000_000)));
    return { encoding: "utf-8", bom: 0 };
  } catch {
    return { encoding: "windows-1252", bom: 0 };
  }
}

export function decodeText(bytes: Uint8Array, forced?: Encoding): { text: string; encoding: Encoding } {
  const det = detectEncoding(bytes);
  const encoding = forced ?? det.encoding;
  const skip = forced && forced !== det.encoding ? 0 : det.bom;
  return { text: new TextDecoder(encoding).decode(bytes.subarray(skip)), encoding };
}

export type Delimiter = "," | "\t" | ";" | "|";
const CANDIDATES: Delimiter[] = [",", "\t", ";", "|"];

/** Picks the delimiter that gives the most consistent, widest field count over the first lines (quotes respected). */
export function detectDelimiter(text: string): Delimiter {
  const sample = text.slice(0, 64_000);
  let best: Delimiter = ",", bestScore = -1;
  for (const d of CANDIDATES) {
    const rows = parseDelimited(sample, d, 30).rows;
    if (rows.length === 0) continue;
    const counts = rows.slice(0, rows.length > 1 ? rows.length - 1 : 1).map((r) => r.length); // last line may be cut off
    const first = counts[0];
    if (first < 2) continue;
    const consistent = counts.filter((c) => c === first).length / counts.length;
    const score = consistent * 100 + Math.min(first, 50);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** Parses delimited text. Handles quoted fields with embedded delimiters, quotes ("") and newlines; CRLF, LF and CR line ends. */
export function parseDelimited(text: string, delim: string, maxRows = Infinity): { rows: string[][]; malformedQuotes: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false, malformed = false, fieldStarted = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && !fieldStarted) { inQuotes = true; fieldStarted = true; continue; }
    if (ch === '"') malformed = true;
    if (ch === delim) { row.push(field); field = ""; fieldStarted = false; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; fieldStarted = false;
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
      if (rows.length >= maxRows) return { rows, malformedQuotes: malformed };
      continue;
    }
    field += ch; fieldStarted = true;
  }
  if (inQuotes) malformed = true;
  if (field !== "" || row.length) { row.push(field); if (!(row.length === 1 && row[0] === "")) rows.push(row); }
  return { rows, malformedQuotes: malformed };
}

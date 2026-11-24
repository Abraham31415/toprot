// One entry point for every supported import format. Used twice with the same code: in the browser for the preview,
// and on the server, which re-parses the stored upload and is the only one whose result is saved.

import { DataError, type Dataset, type VarType, type Warning } from "../types";
import { inferDataset, type ColumnReport, type DateOrder } from "./infer";
import { decodeText, detectDelimiter, parseDelimited, type Delimiter, type Encoding } from "./text";
import { readXlsx } from "./xlsx";

export type ImportFormat = "csv" | "tsv" | "txt" | "xlsx" | "json";
export const SUPPORTED_EXTENSIONS: Record<string, ImportFormat> = { csv: "csv", tsv: "tsv", tab: "tsv", txt: "txt", xlsx: "xlsx", json: "json" };
/** Formats researchers often have that are not read yet, with what to do instead. */
export const UNSUPPORTED_HELP: Record<string, string> = {
  xls: "Older Excel (.xls) files are not supported. In Excel choose File > Save As > Excel Workbook (.xlsx) or CSV, then import that.",
  sav: "SPSS .sav files are not supported yet. In SPSS choose File > Export > CSV (tick 'Save value labels where defined' if you want labels as text), then import the CSV.",
  por: "SPSS portable files are not supported yet. Export to CSV from SPSS, then import the CSV.",
  dta: "Stata .dta files are not supported yet. In Stata run: export delimited using \"file.csv\", nolabel  (or with labels), then import the CSV.",
  parquet: "Parquet files are not supported yet. Convert to CSV (for example with pandas: pd.read_parquet(f).to_csv(...)) and import that.",
  ods: "OpenDocument spreadsheets are not supported. Save as .xlsx or CSV first.",
};

export type ImportOptions = {
  header?: boolean;
  delimiter?: Delimiter;
  encoding?: Encoding;
  sheet?: string;
  missingTokens?: string[];
  dateOrder?: DateOrder;
  decimalComma?: boolean;
  skipRows?: number;
  typeOverrides?: Record<number, VarType>;
};

export type ImportLimits = { maxRows: number; maxColumns: number; maxBytes: number };

export type ImportReport = {
  format: ImportFormat;
  encoding?: Encoding;
  delimiter?: Delimiter;
  sheets?: string[];
  sheet?: string;
  rows: number;
  columns: number;
};

export type ImportResult = { dataset: Dataset; warnings: Warning[]; report: ImportReport; columns: ColumnReport[] };

export function formatOf(filename: string): ImportFormat {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const f = SUPPORTED_EXTENSIONS[ext];
  if (f) return f;
  if (UNSUPPORTED_HELP[ext]) throw new DataError(UNSUPPORTED_HELP[ext]);
  throw new DataError("Unsupported file type. Import a CSV, TSV, TXT, XLSX or JSON file.");
}

/** Checks magic bytes so a renamed binary is never parsed as text (and a text file is never fed to the zip reader). */
function sniff(bytes: Uint8Array, format: ImportFormat): void {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (format === "xlsx" && !isZip) throw new DataError(isOle ? UNSUPPORTED_HELP.xls : "This file does not look like an .xlsx workbook.");
  if (format !== "xlsx") {
    if (isZip || isOle) throw new DataError("This file is a binary spreadsheet, not text. Rename it with the right extension (.xlsx) or export it as CSV.");
    const head = bytes.subarray(0, 8000);
    let nul = 0;
    for (const b of head) if (b === 0) nul++;
    const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
    if (nul > head.length * 0.1 && !utf16) throw new DataError("This file contains binary data and cannot be read as text.");
  }
}

function jsonGrid(text: string): (string | number | null)[][] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new DataError("The JSON file could not be parsed."); }
  const toCell = (v: unknown): string | number | null => (v === null || v === undefined ? null : typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "string" ? v : JSON.stringify(v));
  // Array of records
  if (Array.isArray(data)) {
    if (!data.every((r) => r && typeof r === "object" && !Array.isArray(r))) throw new DataError("A JSON dataset must be an array of objects (one per row) or an object of equal-length arrays (one per column).");
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const r of data as Record<string, unknown>[]) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    return [keys, ...(data as Record<string, unknown>[]).map((r) => keys.map((k) => toCell(r[k])))];
  }
  // Object of columns
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (!keys.length || !keys.every((k) => Array.isArray(obj[k]))) throw new DataError("A JSON dataset must be an array of objects (one per row) or an object of equal-length arrays (one per column).");
    const len = Math.max(...keys.map((k) => (obj[k] as unknown[]).length));
    return [keys, ...Array.from({ length: len }, (_, i) => keys.map((k) => toCell((obj[k] as unknown[])[i])))];
  }
  throw new DataError("A JSON dataset must be an array of objects or an object of arrays.");
}

export async function parseFile(bytes: Uint8Array, filename: string, options: ImportOptions = {}, limits?: ImportLimits): Promise<ImportResult> {
  const format = formatOf(filename);
  if (bytes.length === 0) throw new DataError("The file is empty.");
  if (limits && bytes.length > limits.maxBytes) throw new DataError(`The file is ${(bytes.length / 1048576).toFixed(1)} MB; your plan allows up to ${(limits.maxBytes / 1048576).toFixed(0)} MB per file.`);
  sniff(bytes, format);

  const rowCap = limits ? limits.maxRows + (options.header === false ? 0 : 1) + (options.skipRows ?? 0) + 1 : Infinity;
  let grid: (string | number | null)[][];
  const report: Partial<ImportReport> = { format };
  let dateColumns: Set<number> | undefined;
  const warnings: Warning[] = [];

  if (format === "xlsx") {
    const x = await readXlsx(bytes, options.sheet, rowCap);
    grid = x.sheet.rows;
    report.sheets = x.sheets;
    report.sheet = x.sheet.name;
    dateColumns = x.dateColumns;
    if (x.sheets.length > 1) warnings.push({ level: "note", text: `The workbook has ${x.sheets.length} sheets; "${x.sheet.name}" was read. Choose another sheet if needed.` });
  } else {
    const { text, encoding } = decodeText(bytes, options.encoding);
    report.encoding = encoding;
    if (encoding === "windows-1252") warnings.push({ level: "note", text: "The file is not UTF-8, so it was read as Windows-1252 (Western European). Check accented characters in the preview." });
    if (format === "json") grid = jsonGrid(text);
    else {
      const delim = options.delimiter ?? (format === "tsv" ? "\t" : detectDelimiter(text));
      report.delimiter = delim;
      const parsed = parseDelimited(text, delim, rowCap);
      grid = parsed.rows;
      if (parsed.malformedQuotes) warnings.push({ level: "warning", text: "Some quotation marks are unbalanced or misplaced. Check that rows were split correctly." });
    }
  }
  if (options.skipRows) grid = grid.slice(options.skipRows);
  // Drop trailing fully-empty columns (common in spreadsheets).
  const width = grid.reduce((w, r) => Math.max(w, r.length), 0);
  let lastUsed = -1;
  for (let j = 0; j < width; j++) if (grid.some((r) => r[j] !== null && r[j] !== undefined && r[j] !== "")) lastUsed = j;
  if (lastUsed < width - 1) grid = grid.map((r) => r.slice(0, lastUsed + 1));
  if (!grid.length || lastUsed < 0) throw new DataError("No data was found in the file.");

  const dataRows = grid.length - (options.header === false ? 0 : 1);
  if (limits && dataRows > limits.maxRows) throw new DataError(`The file has more than ${limits.maxRows.toLocaleString("en-GB")} rows, the most your plan allows in one dataset.`);
  if (limits && lastUsed + 1 > limits.maxColumns) throw new DataError(`The file has ${lastUsed + 1} columns; your plan allows up to ${limits.maxColumns}.`);

  const inferred = inferDataset(grid, { ...options, dateColumns });
  const rows = inferred.dataset.columns[0]?.length ?? 0;
  if (rows === 0) warnings.push({ level: "warning", text: "The file has a header but no data rows." });
  return {
    dataset: inferred.dataset,
    warnings: [...warnings, ...inferred.warnings],
    report: { ...(report as ImportReport), rows, columns: inferred.dataset.variables.length },
    columns: inferred.columns,
  };
}

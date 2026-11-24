// Turns a raw grid (strings and numbers) into a typed Dataset, inferring each variable's type and measurement level and
// reporting anything suspicious. Inference is a suggestion: the import screen lets the user override every type.

import { sanitizeName, type Cell, type Dataset, type Measure, type Variable, type VarType, type Warning } from "../types";

export const DEFAULT_MISSING_TOKENS = ["", "NA", "N/A", "na", "n/a", "NaN", "nan", ".", "null", "NULL", "None", "-", "missing", "#N/A"];
const SUSPECT_CODES = new Set([-9, -99, -999, -9999, 99, 999, 9999, 99999]);

export type DateOrder = "dmy" | "mdy";
export type InferOptions = {
  header?: boolean;
  missingTokens?: string[];
  dateOrder?: DateOrder;
  decimalComma?: boolean;
  /** Force a type for a column (by position). */
  typeOverrides?: Record<number, VarType>;
  /** Columns already known to hold dates (from a spreadsheet's cell formats). */
  dateColumns?: Set<number>;
};

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
export function parseNumber(s: string, decimalComma = false): number | null {
  let t = s.trim();
  if (decimalComma) t = t.replace(/\./g, "").replace(",", ".");
  if (!NUM_RE.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
function validYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1000 || y > 9999) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Parses a date string to ISO "YYYY-MM-DD" (or with time). Accepts ISO, D/M/Y or M/D/Y (by dateOrder), with / - or . separators. */
export function parseDate(s: string, order: DateOrder = "dmy"): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validYmd(y, mo, d)) return null;
    const base = `${y}-${pad(mo)}-${pad(d)}`;
    return m[4] ? `${base}T${pad(Number(m[4]))}:${m[5]}:${m[6] ?? "00"}` : base;
  }
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    const [d, mo] = order === "dmy" ? [a, b] : [b, a];
    return validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  return null;
}

export type ColumnReport = { index: number; name: string; original: string; inferred: VarType; missing: number; distinct: number; examples: string[] };

export function inferDataset(grid: (string | number | null)[][], opts: InferOptions = {}): { dataset: Dataset; warnings: Warning[]; columns: ColumnReport[] } {
  const header = opts.header ?? true;
  const missingTokens = new Set(opts.missingTokens ?? DEFAULT_MISSING_TOKENS);
  const warnings: Warning[] = [];
  const width = grid.reduce((w, r) => Math.max(w, r.length), 0);
  const headRow = header ? grid[0] ?? [] : [];
  const body = header ? grid.slice(1) : grid;

  // Ragged rows
  const ragged = body.filter((r) => r.length !== width && r.length > 0).length;
  if (ragged) warnings.push({ level: "warning", text: `${ragged} row(s) have fewer fields than the widest row; the missing fields were left empty. Check the delimiter and quoting.` });

  // Names
  const names: string[] = [];
  const seen = new Map<string, number>();
  let dupes = 0, renamed = 0;
  for (let j = 0; j < width; j++) {
    const raw = header ? String(headRow[j] ?? "").trim() : "";
    let name = sanitizeName(raw, `V${j + 1}`);
    if (raw && name !== raw) renamed++;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      dupes++;
      let k = (seen.get(key) ?? 1) + 1;
      while (seen.has(`${key}_${k}`)) k++;
      seen.set(key, k);
      name = `${name}_${k}`;
    }
    seen.set(name.toLowerCase(), 1);
    names.push(name);
  }
  if (dupes) warnings.push({ level: "warning", text: `${dupes} duplicate column name(s) were made unique by adding a number.` });
  if (renamed) warnings.push({ level: "note", text: `${renamed} column name(s) contained spaces or symbols and were turned into valid variable names. The original header is kept as the variable label.` });

  const variables: Variable[] = [];
  const columns: Cell[][] = [];
  const reports: ColumnReport[] = [];

  for (let j = 0; j < width; j++) {
    const raw = body.map((r) => r[j] ?? null);
    const isMiss = (c: string | number | null) => c === null || (typeof c === "string" && missingTokens.has(c.trim()));
    const present = raw.filter((c) => !isMiss(c));
    const strs = present.map((c) => (typeof c === "number" ? String(c) : c!.trim()));

    let type: VarType;
    const forced = opts.typeOverrides?.[j];
    const nums = present.map((c) => (typeof c === "number" ? c : parseNumber(c as string, opts.decimalComma)));
    const numOk = nums.filter((n) => n !== null).length;
    const dates = present.map((c) => (typeof c === "string" ? parseDate(c, opts.dateOrder) : null));
    const dateOk = dates.filter((d) => d !== null).length;
    if (forced) type = forced;
    else if (opts.dateColumns?.has(j) && present.every((c) => typeof c === "string" && parseDate(c, "dmy") !== null)) type = "date";
    else if (present.length && numOk === present.length) type = "numeric";
    else if (present.length && dateOk === present.length) type = "date";
    else type = present.length ? "string" : "numeric";

    // Ambiguous day/month: every date parses both ways and none has a day > 12.
    if (type === "date" && !forced && !opts.dateColumns?.has(j)) {
      const ambiguous = strs.every((s) => { const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}$/); return m && Number(m[1]) <= 12 && Number(m[2]) <= 12; });
      if (ambiguous && strs.length) warnings.push({ level: "warning", text: `"${names[j]}": dates such as "${strs[0]}" could be day/month or month/day. They were read as ${opts.dateOrder === "mdy" ? "month/day" : "day/month"}/year; change the date order if that is wrong.` });
    }

    let col: Cell[];
    if (type === "numeric") {
      col = raw.map((c) => (isMiss(c) ? null : typeof c === "number" ? c : parseNumber(c as string, opts.decimalComma)));
      const failed = present.length - numOk;
      if (forced && failed) warnings.push({ level: "warning", text: `"${names[j]}": ${failed} value(s) are not numbers and were set to missing.` });
    } else if (type === "date") {
      col = raw.map((c) => (isMiss(c) ? null : typeof c === "string" ? parseDate(c, opts.dateOrder) : null));
      const failed = present.length - dateOk;
      if (forced && failed) warnings.push({ level: "warning", text: `"${names[j]}": ${failed} value(s) are not dates and were set to missing.` });
    } else {
      col = raw.map((c) => (isMiss(c) ? null : typeof c === "number" ? String(c) : (c as string).trim()));
      if (!forced && present.length >= 10 && numOk / present.length >= 0.9) {
        const bad = [...new Set(present.filter((_, i) => nums[i] === null).map(String))].slice(0, 5);
        warnings.push({ level: "warning", text: `"${names[j]}" is mostly numbers but has text values (${bad.map((b) => `"${b}"`).join(", ")}). It was imported as text; fix those values or declare them as missing codes, then change the type to numeric.` });
      }
    }

    const distinct = new Set(col.filter((c) => c !== null).map(String));
    let measure: Measure = type === "string" ? "nominal" : "scale";
    if (type === "numeric") {
      const vals = col.filter((c): c is number => typeof c === "number");
      const allInt = vals.every((v) => Number.isInteger(v));
      if (allInt && distinct.size <= 2 && vals.length > 0) measure = "nominal";
      else if (allInt && distinct.size <= 7 && vals.length >= 20) warnings.push({ level: "note", text: `"${names[j]}" has only ${distinct.size} whole-number values; if they are codes for categories, set its measurement level to nominal or ordinal and add value labels.` });
      const suspects = [...distinct].map(Number).filter((v) => SUSPECT_CODES.has(v));
      if (suspects.length) {
        const share = vals.filter((v) => suspects.includes(v)).length;
        const others = vals.filter((v) => !suspects.includes(v));
        const maxOther = others.length ? Math.max(...others.map(Math.abs)) : 0;
        if (maxOther < Math.min(...suspects.map(Math.abs))) warnings.push({ level: "warning", text: `"${names[j]}" contains ${suspects.join(", ")} (${share} value(s)), which look like missing-value codes. If so, declare them as missing codes in the variable view; until then they are treated as real numbers.` });
      }
    }
    if (present.length === 0 && raw.length) warnings.push({ level: "warning", text: `"${names[j]}" is entirely empty.` });

    const original = header ? String(headRow[j] ?? "").trim() : "";
    const v: Variable = { name: names[j], type, measure, role: "none" };
    if (original && original !== names[j]) v.label = original.slice(0, 256);
    if (/^(id|.*_id|subject|participant|record_?id|patient_?id)$/i.test(names[j]) && distinct.size === present.length && present.length === raw.length && raw.length) v.role = "id";
    variables.push(v);
    columns.push(col);
    reports.push({ index: j, name: names[j], original, inferred: type, missing: raw.length - present.length, distinct: distinct.size, examples: [...distinct].slice(0, 4) });
  }

  // Identical rows
  if (body.length > 1 && width) {
    const keys = new Set<string>();
    let dup = 0;
    for (let i = 0; i < body.length; i++) {
      const k = JSON.stringify(columns.map((c) => c[i]));
      if (keys.has(k)) dup++; else keys.add(k);
    }
    if (dup) warnings.push({ level: "warning", text: `${dup} row(s) are exact duplicates of an earlier row. They were kept; use Remove duplicates in Clean to review them.` });
  }
  const idVar = variables.find((v) => v.role === "id");
  if (!idVar) {
    const idLike = variables.findIndex((v) => /^(id|.*_id|record_?id)$/i.test(v.name));
    if (idLike >= 0) {
      const vals = columns[idLike].filter((c) => c !== null).map(String);
      if (new Set(vals).size < vals.length) warnings.push({ level: "warning", text: `"${variables[idLike].name}" looks like an identifier but has duplicate values.` });
    }
  }
  return { dataset: { variables, columns }, warnings, columns: reports };
}

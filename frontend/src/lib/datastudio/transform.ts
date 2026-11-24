// Data management operations. Every operation is plain JSON (validated by OperationSchema), so it can be previewed, logged in a
// version's history and replayed. apply() never mutates its input; it returns a new dataset and a one-line summary.

import { z } from "zod";
import { evaluate, parseExpr, referencedVariables } from "./expr";
import { summarize } from "./engine/describe";
import { parseDate, parseNumber } from "./parse/infer";
import { DataError, MEASURES, ROLES, VALID_NAME, VAR_TYPES, colIndex, isMissing, nRows, type Cell, type Dataset, type Variable, type VarType } from "./types";

const name = z.string().regex(VALID_NAME, "Use letters, digits, underscore or dot, starting with a letter.");
const cellValue = z.union([z.number(), z.string().max(10000), z.null()]);

export const OperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("rename"), from: name, to: name }),
  z.object({
    op: z.literal("set_variable"), name,
    patch: z.object({
      label: z.string().max(256).optional(), type: z.enum(VAR_TYPES as [VarType, ...VarType[]]).optional(),
      measure: z.enum(MEASURES as [string, ...string[]]).optional(), role: z.enum(ROLES as [string, ...string[]]).optional(),
      valueLabels: z.record(z.string().max(64), z.string().max(256)).nullable().optional(),
      missingCodes: z.array(z.union([z.number(), z.string().max(64)])).max(50).nullable().optional(),
      validMin: z.number().nullable().optional(), validMax: z.number().nullable().optional(),
      decimals: z.number().int().min(0).max(12).nullable().optional(), protocolLink: z.string().max(500).optional(),
    }).strict(),
  }),
  z.object({ op: z.literal("compute"), name, expr: z.string().min(1).max(2000), label: z.string().max(256).optional(), overwrite: z.boolean().optional() }),
  z.object({
    op: z.literal("recode"), source: name, target: name,
    rules: z.array(z.object({ from: z.union([cellValue, z.object({ lo: z.number().nullable(), hi: z.number().nullable() })]), to: cellValue })).min(1).max(500),
    otherwise: z.union([z.literal("copy"), z.literal("missing"), z.object({ value: cellValue })]),
    valueLabels: z.record(z.string().max(64), z.string().max(256)).optional(),
  }),
  z.object({ op: z.literal("replace"), name, find: cellValue, replace: cellValue }),
  z.object({ op: z.literal("filter_rows"), expr: z.string().min(1).max(2000) }),
  z.object({ op: z.literal("delete_rows"), rows: z.array(z.number().int().min(0)).min(1).max(100000) }),
  z.object({ op: z.literal("insert_rows"), at: z.number().int().min(0), count: z.number().int().min(1).max(1000) }),
  z.object({ op: z.literal("delete_columns"), names: z.array(name).min(1).max(2000) }),
  z.object({ op: z.literal("insert_column"), name, type: z.enum(VAR_TYPES as [VarType, ...VarType[]]), after: name.nullable().optional() }),
  z.object({ op: z.literal("set_cells"), edits: z.array(z.object({ row: z.number().int().min(0), name, value: cellValue })).min(1).max(50000) }),
  z.object({ op: z.literal("drop_duplicates"), by: z.array(name).max(2000).optional() }),
  z.object({ op: z.literal("drop_missing"), names: z.array(name).min(1).max(2000), how: z.enum(["any", "all"]) }),
  z.object({ op: z.literal("impute"), name, method: z.enum(["mean", "median", "mode", "constant"]), value: cellValue.optional(), flag: z.boolean().optional() }),
  z.object({ op: z.literal("standardize"), name, target: name, method: z.enum(["z", "minmax", "center"]) }),
  z.object({ op: z.literal("math"), name, target: name, fn: z.enum(["ln", "log10", "log2", "log1p", "sqrt", "square", "inverse", "abs"]) }),
  z.object({ op: z.literal("text_clean"), name, trim: z.boolean(), case: z.enum(["none", "lower", "upper", "title"]) }),
  z.object({ op: z.literal("flag_outliers"), name, target: name, method: z.enum(["iqr", "z"]), k: z.number().positive().max(10) }),
  z.object({ op: z.literal("bin"), name, target: name, breaks: z.array(z.number()).min(1).max(50), labels: z.array(z.string().max(100)).optional(), rightClosed: z.boolean().optional() }),
  z.object({ op: z.literal("sort"), by: z.array(z.object({ name, desc: z.boolean() })).min(1).max(10) }),
  z.object({ op: z.literal("wide_to_long"), id: name, stubs: z.array(z.string().min(1).max(60)).min(1).max(20), timeName: name, sep: z.string().max(5) }),
  z.object({ op: z.literal("long_to_wide"), id: name, time: name, values: z.array(name).min(1).max(50), sep: z.string().max(5) }),
]);
export type Operation = z.infer<typeof OperationSchema>;

export const OP_LABEL: Record<Operation["op"], string> = {
  rename: "Rename variable", set_variable: "Edit variable properties", compute: "Compute variable", recode: "Recode values", replace: "Replace values",
  filter_rows: "Filter rows", delete_rows: "Delete rows", insert_rows: "Insert rows", delete_columns: "Delete variables", insert_column: "Insert variable",
  set_cells: "Edit cells", drop_duplicates: "Remove duplicate rows", drop_missing: "Remove rows with missing values", impute: "Impute missing values",
  standardize: "Standardize or normalize", math: "Mathematical transformation", text_clean: "Clean text", flag_outliers: "Flag outliers", bin: "Group into bands",
  sort: "Sort rows", wide_to_long: "Reshape wide to long", long_to_wide: "Reshape long to wide",
};

/** Operations that remove rows or columns or overwrite values; the interface asks for explicit confirmation before saving them. */
export const DESTRUCTIVE = new Set<Operation["op"]>(["filter_rows", "delete_rows", "delete_columns", "drop_duplicates", "drop_missing", "impute", "replace", "set_cells", "wide_to_long", "long_to_wide"]);

const clone = (d: Dataset): Dataset => ({ variables: d.variables.map((v) => ({ ...v })), columns: d.columns.map((c) => c.slice()) });
const assertNew = (d: Dataset, n: string, allowSame?: string) => {
  if (n !== allowSame && d.variables.some((v) => v.name.toLowerCase() === n.toLowerCase())) throw new DataError(`A variable called "${n}" already exists.`);
};
function upsertColumn(d: Dataset, target: string, v: Variable, col: Cell[], after?: number): void {
  const j = d.variables.findIndex((x) => x.name === target);
  if (j >= 0) { d.variables[j] = v; d.columns[j] = col; }
  else {
    assertNew(d, target);
    const at = after === undefined ? d.variables.length : after + 1;
    d.variables.splice(at, 0, v); d.columns.splice(at, 0, col);
  }
}
const keepRows = (d: Dataset, keep: boolean[]) => { d.columns = d.columns.map((c) => c.filter((_, i) => keep[i])); };
const numericCol = (d: Dataset, n: string) => {
  const j = colIndex(d, n);
  if (d.variables[j].type !== "numeric") throw new DataError(`"${n}" is not numeric.`);
  return j;
};

/** Converts a column's cells to another type. Values that cannot be converted become missing, and are counted. */
export function convertColumn(col: Cell[], to: VarType): { col: Cell[]; failed: number } {
  let failed = 0;
  const out = col.map((c) => {
    if (c === null) return null;
    if (to === "string") return typeof c === "number" ? String(c) : c;
    if (to === "numeric") { if (typeof c === "number") return c; const n = parseNumber(c); if (n === null) failed++; return n; }
    if (typeof c === "number") { failed++; return null; }
    const d = parseDate(c); if (d === null) failed++; return d;
  });
  return { col: out, failed };
}

function rowGetter(d: Dataset, i: number) {
  const idx = new Map(d.variables.map((v, j) => [v.name, j]));
  return (n: string): Cell => {
    const j = idx.get(n);
    if (j === undefined) throw new DataError(`Unknown variable "${n}" in the expression.`);
    const c = d.columns[j][i];
    return isMissing(d.variables[j], c) ? null : c;
  };
}

export function apply(input: Dataset, raw: Operation): { dataset: Dataset; summary: string } {
  const op = OperationSchema.parse(raw);
  const d = clone(input);
  const n = nRows(d);
  switch (op.op) {
    case "rename": {
      const j = colIndex(d, op.from);
      assertNew(d, op.to, op.from);
      d.variables[j].name = op.to;
      return { dataset: d, summary: `Renamed ${op.from} to ${op.to}.` };
    }
    case "set_variable": {
      const j = colIndex(d, op.name);
      const v = d.variables[j];
      const p = op.patch;
      let note = "";
      if (p.type && p.type !== v.type) {
        const r = convertColumn(d.columns[j], p.type);
        d.columns[j] = r.col; v.type = p.type;
        if (p.type === "string") v.measure = "nominal";
        if (r.failed) note = ` ${r.failed} value(s) could not be converted and are now missing.`;
      }
      if (p.label !== undefined) v.label = p.label || undefined;
      if (p.measure) v.measure = p.measure as Variable["measure"];
      if (p.role) v.role = p.role as Variable["role"];
      if (p.valueLabels !== undefined) v.valueLabels = p.valueLabels && Object.keys(p.valueLabels).length ? p.valueLabels : undefined;
      if (p.missingCodes !== undefined) v.missingCodes = p.missingCodes?.length ? p.missingCodes : undefined;
      if (p.validMin !== undefined) v.validMin = p.validMin ?? undefined;
      if (p.validMax !== undefined) v.validMax = p.validMax ?? undefined;
      if (p.decimals !== undefined) v.decimals = p.decimals ?? undefined;
      if (p.protocolLink !== undefined) v.protocolLink = p.protocolLink || undefined;
      if (v.type === "string" && v.measure === "scale") throw new DataError("A text variable cannot have the scale measurement level.");
      return { dataset: d, summary: `Updated properties of ${op.name}.${note}` };
    }
    case "compute": {
      const tree = parseExpr(op.expr);
      for (const r of referencedVariables(tree)) colIndex(d, r);
      const exists = d.variables.some((v) => v.name === op.name);
      if (exists && !op.overwrite) throw new DataError(`"${op.name}" already exists. Choose another name or allow overwriting.`);
      const vals: Cell[] = [];
      for (let i = 0; i < n; i++) vals.push(evaluate(tree, rowGetter(d, i)));
      const present = vals.filter((v) => v !== null);
      const type: VarType = present.every((v) => typeof v === "number") ? "numeric" : "string";
      const col = type === "string" ? vals.map((v) => (v === null ? null : String(v))) : vals;
      const isBinary = type === "numeric" && present.every((v) => v === 0 || v === 1);
      upsertColumn(d, op.name, { name: op.name, label: op.label, type, measure: type === "string" || isBinary ? "nominal" : "scale", role: "none", formula: op.expr }, col);
      return { dataset: d, summary: `Computed ${op.name} = ${op.expr} (${n - present.length} missing).` };
    }
    case "recode": {
      const j = colIndex(d, op.source);
      const src = d.variables[j];
      let changed = 0;
      const col = d.columns[j].map((c) => {
        const val = isMissing(src, c) ? null : c;
        for (const r of op.rules) {
          const f = r.from;
          const hit = f !== null && typeof f === "object"
            ? typeof val === "number" && (f.lo === null || val >= f.lo) && (f.hi === null || val <= f.hi)
            : f === null ? val === null : val !== null && String(val) === String(f);
          if (hit) { changed++; return r.to; }
        }
        if (op.otherwise === "copy") return val;
        if (op.otherwise === "missing") return null;
        return op.otherwise.value;
      });
      const present = col.filter((c) => c !== null);
      const type: VarType = present.every((c) => typeof c === "number") ? "numeric" : "string";
      const out = type === "string" ? col.map((c) => (c === null ? null : String(c))) : col;
      const usesRanges = op.rules.some((r) => r.from !== null && typeof r.from === "object");
      const base: Variable = op.target === op.source ? { ...src, valueLabels: undefined, missingCodes: undefined } : { name: op.target, type, measure: usesRanges ? "ordinal" : "nominal", role: "none", label: src.label ? `${src.label} (recoded)` : undefined };
      const measure = type === "string" ? "nominal" : base.measure === "scale" ? (usesRanges ? "ordinal" : "nominal") : base.measure;
      upsertColumn(d, op.target, { ...base, name: op.target, type, measure, valueLabels: op.valueLabels }, out, j);
      return { dataset: d, summary: `Recoded ${op.source} into ${op.target}: ${changed} value(s) matched a rule.` };
    }
    case "replace": {
      const j = colIndex(d, op.name);
      let k = 0;
      d.columns[j] = d.columns[j].map((c) => { if (c === op.find || (c !== null && op.find !== null && String(c) === String(op.find))) { k++; return op.replace; } return c; });
      const t = d.variables[j].type;
      if (op.replace !== null && ((t === "numeric") !== (typeof op.replace === "number"))) throw new DataError(`The replacement value does not match the type of ${op.name} (${t}).`);
      return { dataset: d, summary: `Replaced ${k} value(s) in ${op.name}.` };
    }
    case "filter_rows": {
      const tree = parseExpr(op.expr);
      for (const r of referencedVariables(tree)) colIndex(d, r);
      const keep = Array.from({ length: n }, (_, i) => { const v = evaluate(tree, rowGetter(input, i)); return typeof v === "number" && v !== 0; });
      keepRows(d, keep);
      const kept = keep.filter(Boolean).length;
      return { dataset: d, summary: `Kept ${kept} of ${n} rows where ${op.expr} (removed ${n - kept}).` };
    }
    case "delete_rows": {
      const del = new Set(op.rows.filter((r) => r < n));
      keepRows(d, Array.from({ length: n }, (_, i) => !del.has(i)));
      return { dataset: d, summary: `Deleted ${del.size} row(s).` };
    }
    case "insert_rows": {
      const at = Math.min(op.at, n);
      d.columns = d.columns.map((c) => [...c.slice(0, at), ...Array<Cell>(op.count).fill(null), ...c.slice(at)]);
      return { dataset: d, summary: `Inserted ${op.count} empty row(s) at row ${at + 1}.` };
    }
    case "delete_columns": {
      const del = new Set(op.names);
      for (const x of op.names) colIndex(d, x);
      const keep = d.variables.map((v) => !del.has(v.name));
      d.variables = d.variables.filter((_, j) => keep[j]);
      d.columns = d.columns.filter((_, j) => keep[j]);
      return { dataset: d, summary: `Deleted ${del.size} variable(s): ${op.names.join(", ")}.` };
    }
    case "insert_column": {
      const after = op.after ? colIndex(d, op.after) : undefined;
      upsertColumn(d, op.name, { name: op.name, type: op.type, measure: op.type === "string" ? "nominal" : "scale", role: "none" }, Array<Cell>(n).fill(null), after);
      return { dataset: d, summary: `Inserted empty variable ${op.name}.` };
    }
    case "set_cells": {
      for (const e of op.edits) {
        if (e.row >= n) throw new DataError(`Row ${e.row + 1} does not exist.`);
        const j = colIndex(d, e.name);
        const t = d.variables[j].type;
        let v: Cell = e.value;
        if (v !== null && t === "numeric" && typeof v !== "number") { v = parseNumber(v); if (v === null) throw new DataError(`"${e.value}" is not a number (${e.name}, row ${e.row + 1}).`); }
        if (v !== null && t === "date") { v = parseDate(String(v)); if (v === null) throw new DataError(`"${e.value}" is not a date (${e.name}, row ${e.row + 1}). Use YYYY-MM-DD.`); }
        if (v !== null && t === "string") v = String(v);
        d.columns[j][e.row] = v;
      }
      return { dataset: d, summary: `Edited ${op.edits.length} cell(s).` };
    }
    case "drop_duplicates": {
      const cols = (op.by?.length ? op.by : d.variables.map((v) => v.name)).map((x) => colIndex(d, x));
      const seen = new Set<string>();
      const keep = Array.from({ length: n }, (_, i) => { const k = JSON.stringify(cols.map((j) => d.columns[j][i])); if (seen.has(k)) return false; seen.add(k); return true; });
      keepRows(d, keep);
      const removed = keep.filter((k) => !k).length;
      return { dataset: d, summary: `Removed ${removed} duplicate row(s)${op.by?.length ? ` (matching on ${op.by.join(", ")})` : ""}; the first occurrence of each was kept.` };
    }
    case "drop_missing": {
      const cols = op.names.map((x) => colIndex(d, x));
      const keep = Array.from({ length: n }, (_, i) => { const m = cols.map((j) => isMissing(d.variables[j], d.columns[j][i])); return op.how === "any" ? !m.some(Boolean) : !m.every(Boolean); });
      keepRows(d, keep);
      const removed = keep.filter((k) => !k).length;
      return { dataset: d, summary: `Removed ${removed} row(s) with missing values in ${op.how === "any" ? "any" : "all"} of ${op.names.join(", ")}.` };
    }
    case "impute": {
      const j = colIndex(d, op.name);
      const v = d.variables[j];
      const present = d.columns[j].filter((c) => !isMissing(v, c));
      let fill: Cell;
      if (op.method === "constant") { if (op.value === undefined || op.value === null) throw new DataError("Enter the value to fill in."); fill = op.value; }
      else if (op.method === "mode") {
        const counts = new Map<string, { v: Cell; c: number }>();
        for (const c of present) { const k = String(c); const e = counts.get(k) ?? { v: c, c: 0 }; e.c++; counts.set(k, e); }
        fill = [...counts.values()].sort((a, b) => b.c - a.c || String(a.v).localeCompare(String(b.v)))[0]?.v ?? null;
      } else {
        if (v.type !== "numeric") throw new DataError(`Mean or median imputation needs a numeric variable; ${op.name} is ${v.type}.`);
        const s = summarize(present as number[]);
        fill = op.method === "mean" ? s.mean : s.median;
      }
      if (fill === null || (typeof fill === "number" && !Number.isFinite(fill))) throw new DataError(`${op.name} has no observed values to impute from.`);
      if ((v.type === "numeric") !== (typeof fill === "number")) throw new DataError(`The fill value does not match the type of ${op.name}.`);
      let k = 0;
      const flag: Cell[] = [];
      d.columns[j] = d.columns[j].map((c) => { const m = isMissing(v, c); flag.push(m ? 1 : 0); if (m) { k++; return fill; } return c; });
      if (op.flag) upsertColumn(d, `${op.name}_imputed`.slice(0, 64), { name: `${op.name}_imputed`.slice(0, 64), label: `1 = ${op.name} was imputed`, type: "numeric", measure: "nominal", role: "none", valueLabels: { "0": "Observed", "1": "Imputed" } }, flag, j);
      return { dataset: d, summary: `Filled ${k} missing value(s) in ${op.name} with the ${op.method === "constant" ? "value" : op.method} ${typeof fill === "number" ? +fill.toPrecision(8) : fill}. Single imputation understates uncertainty; report it.` };
    }
    case "standardize": {
      const j = numericCol(d, op.name);
      const v = d.variables[j];
      const xs = d.columns[j].filter((c) => !isMissing(v, c)) as number[];
      const s = summarize(xs);
      if (op.method !== "center" && !(s.sd > 0)) throw new DataError(`${op.name} has no variation, so it cannot be standardized.`);
      const f = op.method === "z" ? (x: number) => (x - s.mean) / s.sd : op.method === "center" ? (x: number) => x - s.mean : (x: number) => (x - s.min) / (s.max - s.min);
      const col = d.columns[j].map((c) => (isMissing(v, c) ? null : f(c as number)));
      const label = op.method === "z" ? `z-score of ${op.name}` : op.method === "center" ? `${op.name} centred at its mean` : `${op.name} rescaled to 0-1`;
      upsertColumn(d, op.target, { name: op.target, label, type: "numeric", measure: "scale", role: "none", formula: `${op.method}(${op.name}); mean ${s.mean}, sd ${s.sd}, min ${s.min}, max ${s.max}` }, col, j);
      return { dataset: d, summary: `Created ${op.target} (${label}).` };
    }
    case "math": {
      const j = numericCol(d, op.name);
      const v = d.variables[j];
      const fns: Record<typeof op.fn, (x: number) => number | null> = {
        ln: (x) => (x > 0 ? Math.log(x) : null), log10: (x) => (x > 0 ? Math.log10(x) : null), log2: (x) => (x > 0 ? Math.log2(x) : null),
        log1p: (x) => (x > -1 ? Math.log1p(x) : null), sqrt: (x) => (x >= 0 ? Math.sqrt(x) : null), square: (x) => x * x,
        inverse: (x) => (x !== 0 ? 1 / x : null), abs: (x) => Math.abs(x),
      };
      let lost = 0;
      const col = d.columns[j].map((c) => { if (isMissing(v, c)) return null; const r = fns[op.fn](c as number); if (r === null) lost++; return r; });
      upsertColumn(d, op.target, { name: op.target, label: `${op.fn}(${op.name})`, type: "numeric", measure: "scale", role: "none", formula: `${op.fn}(${op.name})` }, col, j);
      return { dataset: d, summary: `Created ${op.target} = ${op.fn}(${op.name}).${lost ? ` ${lost} value(s) were outside the function's domain and are missing.` : ""}` };
    }
    case "text_clean": {
      const j = colIndex(d, op.name);
      if (d.variables[j].type !== "string") throw new DataError(`${op.name} is not a text variable.`);
      let k = 0;
      d.columns[j] = d.columns[j].map((c) => {
        if (c === null) return c;
        let s = String(c);
        if (op.trim) s = s.trim().replace(/\s+/g, " ");
        if (op.case === "lower") s = s.toLowerCase();
        else if (op.case === "upper") s = s.toUpperCase();
        else if (op.case === "title") s = s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
        if (s !== c) k++;
        return s === "" ? null : s;
      });
      return { dataset: d, summary: `Cleaned ${k} value(s) in ${op.name}.` };
    }
    case "flag_outliers": {
      const j = numericCol(d, op.name);
      const v = d.variables[j];
      const s = summarize(d.columns[j].filter((c) => !isMissing(v, c)) as number[]);
      const lo = op.method === "iqr" ? s.q1 - op.k * s.iqr : s.mean - op.k * s.sd;
      const hi = op.method === "iqr" ? s.q3 + op.k * s.iqr : s.mean + op.k * s.sd;
      let k = 0;
      const col = d.columns[j].map((c) => { if (isMissing(v, c)) return null; const o = (c as number) < lo || (c as number) > hi; if (o) k++; return o ? 1 : 0; });
      upsertColumn(d, op.target, { name: op.target, label: `Outlier in ${op.name} (${op.method === "iqr" ? `outside Q1-${op.k}·IQR to Q3+${op.k}·IQR` : `more than ${op.k} SD from the mean`})`, type: "numeric", measure: "nominal", role: "none", valueLabels: { "0": "Not flagged", "1": "Outlier" } }, col, j);
      return { dataset: d, summary: `Flagged ${k} outlier(s) in ${op.name} into ${op.target} (limits ${+lo.toPrecision(6)} to ${+hi.toPrecision(6)}). Nothing was removed.` };
    }
    case "bin": {
      const j = numericCol(d, op.name);
      const v = d.variables[j];
      const b = [...op.breaks].sort((x, y) => x - y);
      if (op.labels && op.labels.length !== b.length + 1) throw new DataError(`Give ${b.length + 1} labels for ${b.length} cut point(s).`);
      const col = d.columns[j].map((c) => {
        if (isMissing(v, c)) return null;
        const x = c as number;
        let k = 0;
        while (k < b.length && (op.rightClosed ? x > b[k] : x >= b[k])) k++;
        return k + 1;
      });
      const fmt = (x: number) => String(+x.toPrecision(8));
      const auto = b.length + 1;
      const labels: Record<string, string> = {};
      for (let k = 0; k < auto; k++) {
        labels[String(k + 1)] = op.labels?.[k] ?? (k === 0 ? `${op.rightClosed ? "≤" : "<"} ${fmt(b[0])}` : k === auto - 1 ? `${op.rightClosed ? ">" : "≥"} ${fmt(b[k - 1])}` : `${fmt(b[k - 1])} to ${op.rightClosed ? "" : "<"}${fmt(b[k])}`);
      }
      upsertColumn(d, op.target, { name: op.target, label: `${op.name} grouped`, type: "numeric", measure: "ordinal", role: "none", valueLabels: labels, formula: `bands of ${op.name} at ${b.join(", ")}` }, col, j);
      return { dataset: d, summary: `Created ${op.target} with ${auto} bands of ${op.name}.` };
    }
    case "sort": {
      const keys = op.by.map((k) => ({ j: colIndex(d, k.name), desc: k.desc }));
      const idx = Array.from({ length: n }, (_, i) => i);
      idx.sort((a, b) => {
        for (const k of keys) {
          const x = d.columns[k.j][a], y = d.columns[k.j][b];
          if (x === y) continue;
          if (x === null) return 1; if (y === null) return -1; // missing last
          const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
          if (c !== 0) return k.desc ? -c : c;
        }
        return a - b;
      });
      d.columns = d.columns.map((c) => idx.map((i) => c[i]));
      return { dataset: d, summary: `Sorted by ${op.by.map((k) => `${k.name}${k.desc ? " (descending)" : ""}`).join(", ")}.` };
    }
    case "wide_to_long": return wideToLong(input, op.id, op.stubs, op.timeName, op.sep);
    case "long_to_wide": return longToWide(input, op.id, op.time, op.values, op.sep);
  }
}

function wideToLong(d: Dataset, id: string, stubs: string[], timeName: string, sep: string): { dataset: Dataset; summary: string } {
  const idJ = colIndex(d, id);
  const times = new Set<string>();
  const stubCols = new Map<string, Map<string, number>>();
  for (const s of stubs) {
    const m = new Map<string, number>();
    d.variables.forEach((v, j) => { if (v.name.startsWith(s + sep) && v.name.length > s.length + sep.length) { const t = v.name.slice(s.length + sep.length); m.set(t, j); times.add(t); } });
    if (!m.size) throw new DataError(`No variables start with "${s}${sep}".`);
    stubCols.set(s, m);
  }
  const used = new Set<number>([...stubCols.values()].flatMap((m) => [...m.values()]));
  const keepJ = d.variables.map((_, j) => j).filter((j) => !used.has(j));
  const tList = [...times].sort((a, b) => (Number.isFinite(+a) && Number.isFinite(+b) ? +a - +b : a.localeCompare(b)));
  const numericTime = tList.every((t) => Number.isFinite(+t));
  const n = nRows(d);
  const vars: Variable[] = [...keepJ.map((j) => ({ ...d.variables[j] })), { name: timeName, type: numericTime ? "numeric" : "string", measure: numericTime ? "ordinal" : "nominal", role: "time" }];
  for (const s of stubs) { const any = [...stubCols.get(s)!.values()][0]; vars.push({ ...d.variables[any], name: s, label: undefined }); }
  const cols: Cell[][] = vars.map(() => []);
  for (let i = 0; i < n; i++)
    for (const t of tList) {
      let k = 0;
      for (const j of keepJ) cols[k++].push(d.columns[j][i]);
      cols[k++].push(numericTime ? +t : t);
      for (const s of stubs) { const j = stubCols.get(s)!.get(t); cols[k++].push(j === undefined ? null : d.columns[j][i]); }
    }
  if (new Set(d.columns[idJ].map(String)).size !== n) throw new DataError(`"${id}" is not unique, so each row cannot be identified after reshaping.`);
  const out = { variables: vars, columns: cols };
  for (const s of stubs) { const j = vars.findIndex((v) => v.name === s); const types = new Set([...stubCols.get(s)!.values()].map((x) => d.variables[x].type)); if (types.size > 1) { const r = convertColumn(cols[j], "string"); out.columns[j] = r.col; vars[j].type = "string"; vars[j].measure = "nominal"; } }
  return { dataset: out, summary: `Reshaped to long format: ${n} rows × ${tList.length} times = ${n * tList.length} rows, with ${timeName} as the time variable.` };
}

function longToWide(d: Dataset, id: string, time: string, values: string[], sep: string): { dataset: Dataset; summary: string } {
  const idJ = colIndex(d, id), tJ = colIndex(d, time);
  const valJ = values.map((v) => colIndex(d, v));
  const n = nRows(d);
  const times: string[] = [];
  const seenT = new Set<string>();
  for (const t of d.columns[tJ]) { if (t === null) throw new DataError(`"${time}" has missing values; every row needs a time.`); const k = String(t); if (!seenT.has(k)) { seenT.add(k); times.push(k); } }
  times.sort((a, b) => (Number.isFinite(+a) && Number.isFinite(+b) ? +a - +b : a.localeCompare(b)));
  const constJ = d.variables.map((_, j) => j).filter((j) => j !== idJ && j !== tJ && !valJ.includes(j));
  const order: string[] = [];
  const rowsById = new Map<string, number[]>();
  for (let i = 0; i < n; i++) { const k = String(d.columns[idJ][i]); if (!rowsById.has(k)) { rowsById.set(k, []); order.push(k); } rowsById.get(k)!.push(i); }
  // Variables that are not reshaped must be constant within an id; otherwise information would be silently dropped.
  const varying = constJ.filter((j) => order.some((k) => new Set(rowsById.get(k)!.map((i) => String(d.columns[j][i]))).size > 1));
  if (varying.length) throw new DataError(`These variables change within an ${id} but were not chosen to reshape: ${varying.map((j) => d.variables[j].name).slice(0, 5).join(", ")}. Add them to the values to reshape, or remove them first.`);
  const vars: Variable[] = [{ ...d.variables[idJ] }, ...constJ.map((j) => ({ ...d.variables[j] }))];
  for (const vj of valJ) for (const t of times) {
    const nm = `${d.variables[vj].name}${sep}${t}`.replace(/[^A-Za-z0-9_.]/g, "_").slice(0, 64);
    if (vars.some((v) => v.name === nm)) throw new DataError(`Reshaping would create the name "${nm}" twice.`);
    vars.push({ ...d.variables[vj], name: nm, label: `${d.variables[vj].label ?? d.variables[vj].name} at ${time} = ${t}`, role: "none" });
  }
  const cols: Cell[][] = vars.map(() => []);
  for (const k of order) {
    const rows = rowsById.get(k)!;
    let c = 0;
    cols[c++].push(d.columns[idJ][rows[0]]);
    for (const j of constJ) cols[c++].push(d.columns[j][rows[0]]);
    const byT = new Map<string, number>();
    for (const i of rows) { const t = String(d.columns[tJ][i]); if (byT.has(t)) throw new DataError(`${id} ${k} has more than one row at ${time} = ${t}.`); byT.set(t, i); }
    for (const vj of valJ) for (const t of times) { const i = byT.get(t); cols[c++].push(i === undefined ? null : d.columns[vj][i]); }
  }
  return { dataset: { variables: vars, columns: cols }, summary: `Reshaped to wide format: ${order.length} rows, ${valJ.length * times.length} reshaped variables.` };
}

/** Replays a list of operations. Used to verify a version's log and to re-run a cleaning pipeline on a new dataset. */
export function applyAll(d: Dataset, ops: Operation[]): { dataset: Dataset; summaries: string[] } {
  const summaries: string[] = [];
  let cur = d;
  ops.forEach((o, i) => {
    try { const r = apply(cur, o); cur = r.dataset; summaries.push(r.summary); }
    catch (e) { throw new DataError(`Step ${i + 1} (${OP_LABEL[o.op]}) failed: ${(e as Error).message}`); }
  });
  return { dataset: cur, summaries };
}

/** Appends rows of b to a. Variables are matched by name; a variable present in only one dataset is filled with missing. */
export function appendDatasets(a: Dataset, b: Dataset): { dataset: Dataset; summary: string } {
  const vars: Variable[] = a.variables.map((v) => ({ ...v }));
  for (const v of b.variables) if (!vars.some((x) => x.name === v.name)) vars.push({ ...v });
  const cols: Cell[][] = vars.map((v) => {
    const ja = a.variables.findIndex((x) => x.name === v.name), jb = b.variables.findIndex((x) => x.name === v.name);
    if (ja >= 0 && jb >= 0 && a.variables[ja].type !== b.variables[jb].type) throw new DataError(`"${v.name}" is ${a.variables[ja].type} in one dataset and ${b.variables[jb].type} in the other.`);
    return [...(ja >= 0 ? a.columns[ja] : Array<Cell>(nRows(a)).fill(null)), ...(jb >= 0 ? b.columns[jb] : Array<Cell>(nRows(b)).fill(null))];
  });
  return { dataset: { variables: vars, columns: cols }, summary: `Appended ${nRows(b)} row(s); ${vars.length - a.variables.length} new variable(s).` };
}

/** Merges b into a on key variables. how: left keeps every row of a; inner keeps matches only. A key repeated in b is refused (many-to-many). */
export function mergeDatasets(a: Dataset, b: Dataset, keys: string[], how: "left" | "inner"): { dataset: Dataset; summary: string } {
  const ka = keys.map((k) => colIndex(a, k)), kb = keys.map((k) => colIndex(b, k));
  const keyOf = (d: Dataset, js: number[], i: number) => JSON.stringify(js.map((j) => (d.columns[j][i] === null ? null : String(d.columns[j][i]))));
  const index = new Map<string, number>();
  for (let i = 0; i < nRows(b); i++) {
    const k = keyOf(b, kb, i);
    if (index.has(k)) throw new DataError(`The key ${keys.join(", ")} is not unique in the dataset being merged in (${k}). Only one-to-one and many-to-one merges are supported.`);
    index.set(k, i);
  }
  const addJ = b.variables.map((_, j) => j).filter((j) => !kb.includes(j));
  for (const j of addJ) if (a.variables.some((v) => v.name === b.variables[j].name)) throw new DataError(`Both datasets have a variable called "${b.variables[j].name}". Rename one first.`);
  const keep: number[] = [], match: (number | undefined)[] = [];
  for (let i = 0; i < nRows(a); i++) { const m = index.get(keyOf(a, ka, i)); if (m !== undefined || how === "left") { keep.push(i); match.push(m); } }
  const matched = match.filter((m) => m !== undefined).length;
  return {
    dataset: { variables: [...a.variables.map((v) => ({ ...v })), ...addJ.map((j) => ({ ...b.variables[j] }))], columns: [...a.columns.map((c) => keep.map((i) => c[i])), ...addJ.map((j) => match.map((m) => (m === undefined ? null : b.columns[j][m])))] },
    summary: `Merged on ${keys.join(", ")} (${how}): ${matched} of ${nRows(a)} rows matched; ${addJ.length} variable(s) added.`,
  };
}

/**
 * Parses recode rules written one per line: "1 = 0", "male = M", "18 to 39 = 1", "40 to = 2" (open range), "to 17 = 0", "missing = 9".
 * Text values may be quoted. Numbers are read as numbers.
 */
export function parseRecodeRules(text: string): { from: Cell | { lo: number | null; hi: number | null }; to: Cell }[] {
  const value = (s: string): Cell => {
    const t = s.trim();
    if (t === "" || /^missing$/i.test(t)) return null;
    const q = t.match(/^"(.*)"$|^'(.*)'$/);
    if (q) return q[1] ?? q[2];
    return Number.isFinite(Number(t)) ? Number(t) : t;
  };
  return text.split(/\n|;/).map((r) => r.trim()).filter(Boolean).map((r) => {
    const m = r.match(/^(.+?)\s*(?:=|->)\s*(.*)$/);
    if (!m) throw new DataError(`Rule "${r}" should look like "old = new" or "18 to 39 = new".`);
    const range = m[1].trim().match(/^(-?\d*\.?\d*)\s+(?:to|thru)\s*(-?\d*\.?\d*)$|^(?:to|thru)\s+(-?\d*\.?\d+)$/i);
    if (range) {
      const lo = range[1] !== undefined && range[1] !== "" ? Number(range[1]) : null;
      const hi = range[2] !== undefined && range[2] !== "" ? Number(range[2]) : range[3] !== undefined ? Number(range[3]) : null;
      if (lo === null && hi === null) throw new DataError(`Rule "${r}" has an empty range.`);
      return { from: { lo, hi }, to: value(m[2]) };
    }
    return { from: value(m[1]), to: value(m[2]) };
  });
}

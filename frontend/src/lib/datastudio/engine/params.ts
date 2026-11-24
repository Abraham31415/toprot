// Validates an analysis request against its method definition and the dataset, so every runner receives clean, typed parameters.
// Runs on the server before any computation; the same function gives the form its error messages.

import { DataError, isMissing, type Dataset } from "../types";
import { METHOD_BY_ID, type Field, type MethodDef } from "./registry";

export type Params = Record<string, unknown>;

export function distinctPresent(d: Dataset, name: string, cap = 1000): string[] {
  const j = d.variables.findIndex((v) => v.name === name);
  if (j < 0) return [];
  const v = d.variables[j];
  const s = new Set<string>();
  for (const c of d.columns[j]) { if (!isMissing(v, c)) { s.add(String(c)); if (s.size > cap) break; } }
  return [...s];
}

export function fitsFilter(d: Dataset, name: string, f: Field["filter"]): string | null {
  const v = d.variables.find((x) => x.name === name);
  if (!v) return `"${name}" does not exist.`;
  if (v.type === "date") return `"${name}" is a date; derive a number from it first (for example days_between or year).`;
  switch (f) {
    case "numeric": case "scale": return v.type === "numeric" ? null : `"${name}" must be numeric.`;
    case "binary": { const k = distinctPresent(d, name, 3).length; return k === 2 ? null : `"${name}" must have exactly two values; it has ${k > 2 ? "more than two" : k}.`; }
    case "categorical": { const k = distinctPresent(d, name, 60).length; return k <= 50 ? null : `"${name}" has more than 50 distinct values, too many for a grouping variable.`; }
    default: return null;
  }
}

export function validateParams(methodId: string, raw: Params, d: Dataset): { def: MethodDef; params: Params } {
  const def = METHOD_BY_ID.get(methodId);
  if (!def) throw new DataError(`Unknown analysis "${methodId}".`);
  const out: Params = {};
  for (const f of def.fields) {
    let v = raw[f.key];
    if (v === undefined || v === "" || v === null || (Array.isArray(v) && v.length === 0)) v = f.default;
    if (v === undefined || v === "" || v === null || (Array.isArray(v) && v.length === 0)) {
      if (f.required) throw new DataError(`Choose ${f.label.toLowerCase()}.`);
      continue;
    }
    switch (f.kind) {
      case "variable": {
        if (typeof v !== "string") throw new DataError(`${f.label}: choose one variable.`);
        const e = fitsFilter(d, v, f.filter); if (e) throw new DataError(`${f.label}: ${e}`);
        out[f.key] = v; break;
      }
      case "variables": {
        if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new DataError(`${f.label}: choose variables.`);
        const uniq = [...new Set(v as string[])];
        if (uniq.length > 200) throw new DataError(`${f.label}: at most 200 variables.`);
        if (f.minItems && uniq.length < f.minItems) throw new DataError(`${f.label}: choose at least ${f.minItems}.`);
        for (const n of uniq) { const e = fitsFilter(d, n, f.filter); if (e) throw new DataError(`${f.label}: ${e}`); }
        out[f.key] = uniq; break;
      }
      case "level": {
        const parent = out[f.levelOf!] as string | undefined;
        if (!parent) throw new DataError(`${f.label}: choose the variable first.`);
        const lv = distinctPresent(d, parent);
        if (!lv.includes(String(v))) throw new DataError(`${f.label}: "${v}" is not a value of ${parent}.`);
        out[f.key] = String(v); break;
      }
      case "number": {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) throw new DataError(`${f.label} must be a number.`);
        if (f.min !== undefined && n < f.min) throw new DataError(`${f.label} must be at least ${f.min}.`);
        if (f.max !== undefined && n > f.max) throw new DataError(`${f.label} must be at most ${f.max}.`);
        out[f.key] = n; break;
      }
      case "select": {
        if (!f.options!.some((o) => o.value === String(v))) throw new DataError(`${f.label}: invalid choice.`);
        out[f.key] = String(v); break;
      }
      case "boolean": out[f.key] = v === true || v === "true"; break;
      case "pairs": {
        if (!Array.isArray(v)) throw new DataError(`${f.label}: invalid.`);
        const pairs = (v as unknown[]).filter((p): p is [string, string] => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "string") && p[0] !== p[1]);
        if (pairs.length > 20) throw new DataError(`${f.label}: at most 20 interactions.`);
        out[f.key] = pairs; break;
      }
    }
  }
  if (out.conf !== undefined) out.conf = Number(out.conf);
  // Cross-field rules
  const same = (a: string, b: string) => out[a] !== undefined && out[a] === out[b];
  if (same("a", "b") || same("x", "y") || same("outcome", "group") || same("row", "col") || same("exposure", "outcome") || same("test", "reference")) throw new DataError("Choose two different variables.");
  if (Array.isArray(out.predictors) && out.outcome && (out.predictors as string[]).includes(out.outcome as string)) throw new DataError("The outcome cannot also be a predictor.");
  if (same("levelA", "levelB")) throw new DataError("Choose two different groups.");
  return { def, params: out };
}

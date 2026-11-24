// A small, safe expression language for computed variables and row filters. It is parsed into a tree and evaluated by this code:
// nothing is ever passed to eval or Function, so an expression can only read the row it is given.
//
//   numbers 1.5, strings "text", variables age or `weight kg`, operators + - * / ^ %, comparisons == != < <= > >=,
//   logic and or not (also && || !), parentheses, and the functions in FUNCTIONS below. Missing values propagate:
//   any arithmetic with a missing value is missing, a comparison with a missing value is missing (so a filter drops the row).

import { DataError, type Cell } from "./types";

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "var"; name: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

type Tok = { t: "num" | "str" | "id" | "op" | "(" | ")" | ","; v: string; pos: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = src.slice(i).match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
      if (!m) throw new DataError(`Unexpected "${c}" at position ${i + 1}.`);
      out.push({ t: "num", v: m[0], pos: i }); i += m[0].length; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) { if (src[j] === "\\" && j + 1 < src.length) { s += src[j + 1]; j += 2; } else s += src[j++]; }
      if (j >= src.length) throw new DataError("A text value is missing its closing quote.");
      out.push({ t: "str", v: s, pos: i }); i = j + 1; continue;
    }
    if (c === "`") {
      const j = src.indexOf("`", i + 1);
      if (j < 0) throw new DataError("A `quoted` variable name is missing its closing backtick.");
      out.push({ t: "id", v: src.slice(i + 1, j), pos: i }); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_.]*/)!;
      out.push({ t: "id", v: m[0], pos: i }); i += m[0].length; continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two, pos: i }); i += 2; continue; }
    if ("+-*/^%<>!=".includes(c)) { out.push({ t: "op", v: c === "=" ? "==" : c, pos: i }); i++; continue; }
    if (c === "(" || c === ")" || c === ",") { out.push({ t: c, v: c, pos: i }); i++; continue; }
    throw new DataError(`Unexpected "${c}" at position ${i + 1}.`);
  }
  return out;
}

const BIN_PREC: Record<string, number> = { or: 1, "||": 1, and: 2, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6, "^": 8 };

export function parseExpr(src: string): Node {
  if (src.length > 2000) throw new DataError("The expression is too long.");
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const opOf = (t?: Tok) => (t && (t.t === "op" || (t.t === "id" && (t.v === "and" || t.v === "or"))) ? t.v : null);
  let depth = 0;
  function primary(): Node {
    if (++depth > 100) throw new DataError("The expression is nested too deeply.");
    const t = toks[p++];
    if (!t) throw new DataError("The expression ends unexpectedly.");
    try {
      if (t.t === "num") return { k: "num", v: Number(t.v) };
      if (t.t === "str") return { k: "str", v: t.v };
      if (t.t === "op" && (t.v === "-" || t.v === "+" || t.v === "!")) return { k: "un", op: t.v, a: unary(7) };
      if (t.t === "id" && t.v === "not") return { k: "un", op: "!", a: unary(2.5) };
      if (t.t === "(") { const e = expr(0); if (toks[p++]?.t !== ")") throw new DataError("A closing parenthesis is missing."); return e; }
      if (t.t === "id") {
        if (t.v === "TRUE" || t.v === "true") return { k: "num", v: 1 };
        if (t.v === "FALSE" || t.v === "false") return { k: "num", v: 0 };
        if (peek()?.t === "(") {
          p++;
          const args: Node[] = [];
          if (peek()?.t !== ")") { args.push(expr(0)); while (peek()?.t === ",") { p++; args.push(expr(0)); } }
          if (toks[p++]?.t !== ")") throw new DataError(`A closing parenthesis is missing after ${t.v}(…).`);
          const fn = t.v.toLowerCase();
          const spec = FUNCTIONS[fn];
          if (!spec) throw new DataError(`Unknown function "${t.v}". Available: ${Object.keys(FUNCTIONS).join(", ")}.`);
          if (args.length < spec.min || args.length > spec.max) throw new DataError(`${fn}() takes ${spec.min === spec.max ? spec.min : `${spec.min} to ${spec.max}`} argument(s).`);
          return { k: "call", fn, args };
        }
        return { k: "var", name: t.v };
      }
      throw new DataError(`Unexpected "${t.v}" at position ${t.pos + 1}.`);
    } finally { depth--; }
  }
  function unary(prec: number): Node { return expr(prec, primary()); }
  function expr(minPrec: number, left?: Node): Node {
    let lhs = left ?? primary();
    for (;;) {
      const op = opOf(peek());
      if (!op) break;
      const prec = BIN_PREC[op];
      if (prec === undefined || prec < minPrec) break;
      p++;
      const rhs = expr(op === "^" ? prec : prec + 1); // ^ is right-associative
      lhs = { k: "bin", op, a: lhs, b: rhs };
    }
    return lhs;
  }
  const tree = expr(0);
  if (p < toks.length) throw new DataError(`Unexpected "${toks[p].v}" at position ${toks[p].pos + 1}.`);
  return tree;
}

type V = number | string | null;
const num = (v: V): number | null => (v === null ? null : typeof v === "number" ? v : null);
const str = (v: V): string | null => (v === null ? null : String(v));
const dateParts = (v: V) => { const s = str(v); const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? { y: +m[1], m: +m[2], d: +m[3], t: Date.UTC(+m[1], +m[2] - 1, +m[3]) } : null; };
const fin = (x: number) => (Number.isFinite(x) ? x : null);

const FUNCTIONS: Record<string, { min: number; max: number; f: (a: V[]) => V }> = {
  log: { min: 1, max: 2, f: ([x, b]) => { const v = num(x); if (v === null || v <= 0) return null; const base = b === undefined ? Math.E : num(b); return base ? fin(Math.log(v) / Math.log(base)) : null; } },
  ln: { min: 1, max: 1, f: ([x]) => { const v = num(x); return v !== null && v > 0 ? Math.log(v) : null; } },
  log10: { min: 1, max: 1, f: ([x]) => { const v = num(x); return v !== null && v > 0 ? Math.log10(v) : null; } },
  exp: { min: 1, max: 1, f: ([x]) => { const v = num(x); return v === null ? null : fin(Math.exp(v)); } },
  sqrt: { min: 1, max: 1, f: ([x]) => { const v = num(x); return v !== null && v >= 0 ? Math.sqrt(v) : null; } },
  abs: { min: 1, max: 1, f: ([x]) => { const v = num(x); return v === null ? null : Math.abs(v); } },
  round: { min: 1, max: 2, f: ([x, d]) => { const v = num(x); if (v === null) return null; const k = 10 ** (num(d ?? 0) ?? 0); return Math.round(v * k) / k; } },
  floor: { min: 1, max: 1, f: ([x]) => { const v = num(x); return v === null ? null : Math.floor(v); } },
  ceil: { min: 1, max: 1, f: ([x]) => { const v = num(x); return v === null ? null : Math.ceil(v); } },
  min: { min: 1, max: 50, f: (a) => { const xs = a.map(num); return xs.some((x) => x === null) ? null : Math.min(...(xs as number[])); } },
  max: { min: 1, max: 50, f: (a) => { const xs = a.map(num); return xs.some((x) => x === null) ? null : Math.max(...(xs as number[])); } },
  sum: { min: 1, max: 100, f: (a) => { const xs = a.map(num); return xs.some((x) => x === null) ? null : (xs as number[]).reduce((s, v) => s + v, 0); } },
  mean: { min: 1, max: 100, f: (a) => { const xs = a.map(num); return xs.some((x) => x === null) ? null : (xs as number[]).reduce((s, v) => s + v, 0) / xs.length; } },
  rowmean: { min: 1, max: 100, f: (a) => { const xs = a.map(num).filter((x): x is number => x !== null); return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null; } },
  rowsum: { min: 1, max: 100, f: (a) => { const xs = a.map(num).filter((x): x is number => x !== null); return xs.length ? xs.reduce((s, v) => s + v, 0) : null; } },
  nmiss: { min: 1, max: 100, f: (a) => a.filter((x) => x === null).length },
  ifelse: { min: 3, max: 3, f: ([c, a, b]) => { const v = num(c); return v === null ? null : v !== 0 ? a : b; } },
  is_missing: { min: 1, max: 1, f: ([x]) => (x === null ? 1 : 0) },
  coalesce: { min: 1, max: 20, f: (a) => a.find((x) => x !== null) ?? null },
  upper: { min: 1, max: 1, f: ([x]) => str(x)?.toUpperCase() ?? null },
  lower: { min: 1, max: 1, f: ([x]) => str(x)?.toLowerCase() ?? null },
  trim: { min: 1, max: 1, f: ([x]) => str(x)?.trim().replace(/\s+/g, " ") ?? null },
  concat: { min: 1, max: 20, f: (a) => (a.some((x) => x === null) ? null : a.map(String).join("")) },
  substr: { min: 2, max: 3, f: ([x, s, l]) => { const t = str(x), a = num(s); if (t === null || a === null) return null; return l === undefined ? t.slice(a - 1) : t.slice(a - 1, a - 1 + (num(l) ?? 0)); } },
  length: { min: 1, max: 1, f: ([x]) => str(x)?.length ?? null },
  number: { min: 1, max: 1, f: ([x]) => { if (x === null) return null; if (typeof x === "number") return x; const v = Number(String(x).trim()); return String(x).trim() !== "" && Number.isFinite(v) ? v : null; } },
  text: { min: 1, max: 1, f: ([x]) => str(x) },
  year: { min: 1, max: 1, f: ([x]) => dateParts(x)?.y ?? null },
  month: { min: 1, max: 1, f: ([x]) => dateParts(x)?.m ?? null },
  day: { min: 1, max: 1, f: ([x]) => dateParts(x)?.d ?? null },
  days_between: { min: 2, max: 2, f: ([a, b]) => { const x = dateParts(a), y = dateParts(b); return x && y ? Math.round((y.t - x.t) / 86400000) : null; } },
  age_years: { min: 2, max: 2, f: ([birth, at]) => { const x = dateParts(birth), y = dateParts(at); if (!x || !y) return null; let age = y.y - x.y; if (y.m < x.m || (y.m === x.m && y.d < x.d)) age--; return age; } },
  cut: { min: 2, max: 50, f: ([x, ...breaks]) => { const v = num(x); if (v === null) return null; const b = breaks.map(num); if (b.some((t) => t === null)) return null; let k = 0; while (k < b.length && v >= (b[k] as number)) k++; return k; } },
};
export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

/** Variable names an expression reads. */
export function referencedVariables(tree: Node): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === "var") out.add(n.name);
    else if (n.k === "un") walk(n.a);
    else if (n.k === "bin") { walk(n.a); walk(n.b); }
    else if (n.k === "call") n.args.forEach(walk);
  };
  walk(tree);
  return [...out];
}

export function evaluate(n: Node, row: (name: string) => Cell): V {
  switch (n.k) {
    case "num": return n.v;
    case "str": return n.v;
    case "var": return row(n.name);
    case "un": {
      const a = evaluate(n.a, row);
      if (a === null) return null;
      if (n.op === "-") return typeof a === "number" ? -a : null;
      if (n.op === "+") return typeof a === "number" ? a : null;
      return typeof a === "number" ? (a === 0 ? 1 : 0) : null;
    }
    case "bin": {
      if (n.op === "and" || n.op === "&&" || n.op === "or" || n.op === "||") {
        const a = num(evaluate(n.a, row)), isAnd = n.op === "and" || n.op === "&&";
        if (a !== null && isAnd && a === 0) return 0;
        if (a !== null && !isAnd && a !== 0) return 1;
        const b = num(evaluate(n.b, row));
        if (b !== null && isAnd && b === 0) return 0;
        if (b !== null && !isAnd && b !== 0) return 1;
        return a === null || b === null ? null : isAnd ? 1 : 0;
      }
      const a = evaluate(n.a, row), b = evaluate(n.b, row);
      if (a === null || b === null) return null;
      if (["==", "!=", "<", "<=", ">", ">="].includes(n.op)) {
        const cmp = typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
        const r = n.op === "==" ? cmp === 0 : n.op === "!=" ? cmp !== 0 : n.op === "<" ? cmp < 0 : n.op === "<=" ? cmp <= 0 : n.op === ">" ? cmp > 0 : cmp >= 0;
        return r ? 1 : 0;
      }
      if (n.op === "+" && (typeof a === "string" || typeof b === "string")) return null; // use concat() for text
      if (typeof a !== "number" || typeof b !== "number") return null;
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b === 0 ? null : a / b;
        case "%": return b === 0 ? null : a % b;
        case "^": return fin(a ** b);
      }
      return null;
    }
    case "call": return FUNCTIONS[n.fn].f(n.args.map((x) => evaluate(x, row)));
  }
}

export type { Node as ExprNode };

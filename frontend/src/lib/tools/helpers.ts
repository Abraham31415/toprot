import type { Field, Calculator } from "./types";

export const fmt = (x: number, d = 3): string => {
  if (!Number.isFinite(x)) return "undefined";
  if (x !== 0 && (Math.abs(x) >= 1e7 || Math.abs(x) < 1e-4)) return x.toExponential(2);
  return String(Number(x.toFixed(d)));
};
export const fmtP = (p: number): string => (p < 0.0001 ? "<0.0001" : p.toFixed(4));
export const ci = (i: { lower: number; upper: number }, d = 3): string => `${fmt(i.lower, d)} to ${fmt(i.upper, d)}`;
export const pct = (x: number, d = 1): string => `${(x * 100).toFixed(d)}%`;
export const pctCi = (i: { lower: number; upper: number }): string => `${pct(i.lower)} to ${pct(i.upper)}`;

const isVisible = (f: Field, raw: Record<string, string>) => !f.showIf || raw[f.showIf.id] === f.showIf.equals;

/** Parse and range-check every visible number field. Returns an error message naming the field. */
export function parseNumbers(fields: Field[], raw: Record<string, string>): { n: Record<string, number> } | { error: string } {
  const n: Record<string, number> = {};
  for (const f of fields) {
    if (f.kind !== "number" || !isVisible(f, raw)) continue;
    const text = (raw[f.id] ?? "").trim();
    if (text === "") return { error: `${f.label} is required.` };
    const v = Number(text);
    if (!Number.isFinite(v)) return { error: `${f.label} must be a number.` };
    if (f.min !== undefined && v < f.min) return { error: `${f.label} must be at least ${f.min}.` };
    if (f.max !== undefined && v > f.max) return { error: `${f.label} must be at most ${f.max}.` };
    n[f.id] = v;
  }
  return { n };
}

/** Parse a list of numbers separated by spaces, commas, semicolons or new lines. */
export function parseList(text: string, label: string, min = 2): number[] | string {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  const out: number[] = [];
  for (const t of tokens) {
    const v = Number(t);
    if (!Number.isFinite(v)) return `${label}: "${t}" is not a number.`;
    out.push(v);
  }
  if (out.length < min) return `${label} needs at least ${min} values.`;
  return out;
}

export const CONF_FIELD: Field = {
  id: "conf", label: "Confidence level", kind: "number", default: "0.95", min: 0.5, max: 0.999, step: 0.01,
  help: "0.95 is the usual choice. It sets the two-sided significance level (alpha = 1 - confidence).",
};
export const POWER_FIELD: Field = {
  id: "power", label: "Power", kind: "number", default: "0.8", min: 0.5, max: 0.999, step: 0.01,
  help: "Probability of detecting the effect if it is real. 0.80 is the usual minimum; 0.90 is common for trials.",
};
export const RATIO_FIELD: Field = {
  id: "ratio", label: "Allocation ratio (group 2 : group 1)", kind: "number", default: "1", min: 0.1, max: 20, step: 0.1,
  help: "1 means equal group sizes. 2 means group 2 is twice as large as group 1.",
};
export const NONRESPONSE_FIELD: Field = {
  id: "nonresponse", label: "Expected nonresponse or dropout", kind: "number", default: "0", min: 0, max: 0.95, step: 0.01,
  help: "Proportion expected to be lost or refuse, e.g. 0.10 for 10%. The sample is inflated by 1 / (1 - rate).",
};

export const confText = (c: number) => `${fmt(c * 100, 1)}%`;
export const alphaText = (c: number) => fmt(1 - c, 4);

export const shortCite = (c: Calculator) => c.references[0];

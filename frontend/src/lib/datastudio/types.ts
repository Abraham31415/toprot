// Data Studio core types. A dataset is stored column-wise: one array of cells per variable, all the same length.
// Cells are numbers, strings or null (missing). Dates are ISO strings "YYYY-MM-DD" (or "YYYY-MM-DDTHH:MM:SS") in a "date" variable.

export const ENGINE_VERSION = "toprot-ds-1.0.0";

export type VarType = "numeric" | "string" | "date";
export type Measure = "nominal" | "ordinal" | "scale";
export type Role = "none" | "id" | "outcome" | "predictor" | "covariate" | "group" | "time" | "weight" | "cluster";

export type Cell = number | string | null;

export type Variable = {
  name: string;
  label?: string;
  type: VarType;
  measure: Measure;
  role?: Role;
  /** Code -> label, e.g. { "1": "Male", "2": "Female" }. Keys are the stored value as text. */
  valueLabels?: Record<string, string>;
  /** Stored values that mean "missing" (e.g. -99, "NA"). They are kept in the data and treated as missing by every analysis. */
  missingCodes?: (string | number)[];
  validMin?: number;
  validMax?: number;
  decimals?: number;
  /** For a derived variable, the expression it was computed from. */
  formula?: string;
  /** Free-text link to a protocol objective or outcome. */
  protocolLink?: string;
};

export type Dataset = { variables: Variable[]; columns: Cell[][] };

export type Warning = { level: "warning" | "note"; text: string };

export const VAR_TYPES: readonly VarType[] = ["numeric", "string", "date"];
export const MEASURES: readonly Measure[] = ["nominal", "ordinal", "scale"];
export const ROLES: readonly Role[] = ["none", "id", "outcome", "predictor", "covariate", "group", "time", "weight", "cluster"];

export function nRows(d: Dataset): number {
  return d.columns[0]?.length ?? 0;
}

export function colIndex(d: Dataset, name: string): number {
  const i = d.variables.findIndex((v) => v.name === name);
  if (i < 0) throw new DataError(`Variable "${name}" does not exist in this dataset.`);
  return i;
}

/** True if the cell is missing for this variable: null, empty, or one of the variable's declared missing codes. */
export function isMissing(v: Variable, c: Cell): boolean {
  if (c === null || c === "") return true;
  if (typeof c === "number" && !Number.isFinite(c)) return true;
  if (v.missingCodes?.length) {
    for (const m of v.missingCodes) if (m === c || String(m) === String(c)) return true;
  }
  return false;
}

/** A user-facing error: bad input or an impossible request. Message is safe to show. */
export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

export const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/;

/** Turns any header into a safe variable name: letters, digits, underscore and dot; starts with a letter or underscore; max 64 chars. */
export function sanitizeName(raw: string, fallback: string): string {
  let s = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().replace(/[^A-Za-z0-9_.]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) s = fallback;
  if (!/^[A-Za-z_]/.test(s)) s = `v_${s}`;
  return s.slice(0, 64);
}

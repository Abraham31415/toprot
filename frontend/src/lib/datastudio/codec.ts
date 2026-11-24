// Canonical serialisation of a dataset version, its checksum, and validation of anything read back.
// The checksum is SHA-256 of the canonical JSON, so the same data always gives the same checksum on any machine.

import { z } from "zod";
import { DataError, MEASURES, ROLES, VALID_NAME, VAR_TYPES, type Dataset } from "./types";

const VariableSchema = z.object({
  name: z.string().regex(VALID_NAME),
  label: z.string().max(256).optional(),
  type: z.enum(VAR_TYPES as [string, ...string[]]),
  measure: z.enum(MEASURES as [string, ...string[]]),
  role: z.enum(ROLES as [string, ...string[]]).optional(),
  valueLabels: z.record(z.string().max(64), z.string().max(256)).optional(),
  missingCodes: z.array(z.union([z.string().max(64), z.number()])).max(50).optional(),
  validMin: z.number().optional(),
  validMax: z.number().optional(),
  decimals: z.number().int().min(0).max(12).optional(),
  formula: z.string().max(2000).optional(),
  protocolLink: z.string().max(500).optional(),
}).strict();

export const VariablesSchema = z.array(VariableSchema).max(2000);

const CellSchema = z.union([z.number(), z.string().max(10000), z.null()]);
const DatasetSchema = z.object({ v: z.literal(1), variables: VariablesSchema, columns: z.array(z.array(CellSchema)) });

/** Throws a DataError unless the dataset is well-formed: unique valid names, equal column lengths, cells consistent with types. */
export function validateDataset(d: Dataset): void {
  if (d.variables.length !== d.columns.length) throw new DataError("Internal error: variables and columns do not match.");
  const names = new Set<string>();
  for (const v of d.variables) {
    if (!VALID_NAME.test(v.name)) throw new DataError(`"${v.name}" is not a valid variable name. Use letters, digits, underscore or dot, starting with a letter.`);
    const key = v.name.toLowerCase();
    if (names.has(key)) throw new DataError(`Two variables are called "${v.name}". Variable names must be unique.`);
    names.add(key);
  }
  const len = d.columns[0]?.length ?? 0;
  d.columns.forEach((c, j) => {
    if (c.length !== len) throw new DataError("Internal error: columns have different lengths.");
    const t = d.variables[j].type;
    for (const cell of c) {
      if (cell === null) continue;
      if (t === "numeric" && (typeof cell !== "number" || !Number.isFinite(cell))) throw new DataError(`"${d.variables[j].name}" is numeric but contains "${String(cell)}".`);
      if (t !== "numeric" && typeof cell !== "string") throw new DataError(`"${d.variables[j].name}" contains a number in a ${t} variable.`);
    }
  });
}

export function canonicalJson(d: Dataset): string {
  // Key order is fixed by construction: { v, variables, columns }, and variable objects are rebuilt in a fixed key order.
  const order = ["name", "label", "type", "measure", "role", "valueLabels", "missingCodes", "validMin", "validMax", "decimals", "formula", "protocolLink"] as const;
  const variables = d.variables.map((v) => {
    const o: Record<string, unknown> = {};
    for (const k of order) if (v[k] !== undefined) o[k] = k === "valueLabels" ? Object.fromEntries(Object.entries(v.valueLabels!).sort(([a], [b]) => a.localeCompare(b))) : v[k];
    return o;
  });
  return JSON.stringify({ v: 1, variables, columns: d.columns });
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(t);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeDataset(d: Dataset): Promise<{ gz: Uint8Array; checksum: string; json: string }> {
  validateDataset(d);
  const json = canonicalJson(d);
  const checksum = await sha256Hex(json);
  const gz = await pipe(new TextEncoder().encode(json), new CompressionStream("gzip"));
  return { gz, checksum, json };
}

/** Decodes a stored version and verifies its checksum, so silent corruption or tampering in storage is detected before any analysis. */
export async function decodeDataset(gz: Uint8Array, expectedChecksum?: string): Promise<Dataset> {
  const json = new TextDecoder().decode(await pipe(gz, new DecompressionStream("gzip")));
  if (expectedChecksum) {
    const got = await sha256Hex(json);
    if (got !== expectedChecksum) throw new DataError("The stored dataset does not match its checksum. It may be corrupted; restore an earlier version.");
  }
  const parsed = DatasetSchema.safeParse(JSON.parse(json));
  if (!parsed.success) throw new DataError("The stored dataset is not in a readable format.");
  const d = { variables: parsed.data.variables, columns: parsed.data.columns } as unknown as Dataset;
  validateDataset(d);
  return d;
}

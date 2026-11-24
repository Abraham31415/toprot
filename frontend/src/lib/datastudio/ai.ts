// Grounding for the AI Research Analyst. The model receives only the structured output of the deterministic engine (aggregated
// estimates, tables, diagnostics and variable names) and never the raw rows. After it answers, every number it wrote is checked
// against the numbers it was given; anything that cannot be traced is flagged to the reader.

import { fmt, fmtP, type AnalysisResult, type TableCell } from "./engine/common";

export type AnalystTask = "interpret" | "results" | "methods" | "assumptions" | "next_steps";
export const TASK_LABEL: Record<AnalystTask, string> = {
  interpret: "Explain these results in plain language",
  results: "Draft a results paragraph for a manuscript",
  methods: "Draft the statistical methods text",
  assumptions: "Explain the assumption checks and warnings",
  next_steps: "Suggest further analyses or visualisations",
};

export const ANALYST_SYSTEM = `You are a careful biostatistician helping a researcher understand and report an analysis that has ALREADY been computed by validated statistical software. You never compute, re-estimate, round differently, or invent numbers.

Rules:
- Use only numbers that appear in the RESULT below, copied exactly as written there (you may express a proportion as a percentage only if the RESULT shows it that way). If a number you would like is not in the RESULT, say it is not available.
- Distinguish association from causation. Never claim a cause unless the user states the design was a randomised trial, and even then be measured.
- Distinguish statistical significance from practical or clinical importance; comment on the size and precision of effects (confidence intervals), not only p-values.
- A confidence interval is about the procedure: do not say "there is a 95% probability the true value lies in this interval".
- A non-significant result is not evidence of no effect; mention the interval width.
- Treat the analysis as exploratory unless the user says it was prespecified.
- Mention any warnings or violated assumptions in the RESULT that affect interpretation.
- Model fit (R-squared, AUC on the same data) is not predictive validity on new data.
- Be concise and specific. Use plain prose with short paragraphs; no headings unless asked; no markdown tables.`;

const cell = (c: TableCell, kind?: string): string => (c === null ? "-" : typeof c === "number" ? (kind === "p" ? fmtP(c) : kind === "int" ? String(c) : fmt(c, Math.abs(c) >= 100 ? 1 : 3)) : c);

/** Compact, human-readable rendering of a result for the prompt (and for the user to inspect exactly what was sent). */
export function resultForPrompt(r: AnalysisResult, ctx: { datasetName: string; versionNo: number; variables: { name: string; label?: string }[] }): string {
  const lines: string[] = [];
  lines.push(`ANALYSIS: ${r.title}`);
  lines.push(`Dataset: "${ctx.datasetName}", version ${ctx.versionNo}. Observations used: ${r.n.used} of ${r.n.total} (${r.n.excluded} excluded for missing data).`);
  lines.push(`Method as performed: ${r.methodsText}`);
  const labelled = ctx.variables.filter((v) => v.label);
  if (labelled.length) lines.push(`Variable labels: ${labelled.slice(0, 40).map((v) => `${v.name} = "${v.label}"`).join("; ")}`);
  for (const t of r.tables.slice(0, 8)) {
    lines.push("", `TABLE: ${t.title}`, t.columns.join(" | "));
    for (const row of t.rows.slice(0, 40)) lines.push(row.map((c, k) => cell(c, t.kinds?.[k])).join(" | "));
    if (t.rows.length > 40) lines.push(`(${t.rows.length - 40} more rows not shown)`);
    for (const n of t.notes ?? []) lines.push(`Note: ${n}`);
  }
  if (r.assumptions.length) { lines.push("", "ASSUMPTION CHECKS:"); for (const a of r.assumptions) lines.push(`- ${a.name} [${a.status}]: ${a.detail}`); }
  if (r.warnings.length) { lines.push("", "WARNINGS:"); for (const w of r.warnings) lines.push(`- (${w.level}) ${w.text}`); }
  return lines.join("\n");
}

/** Numbers as they appear in text, normalised: "0.034", "<0.001", "12.5%", "1,234" -> 1234. */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![A-Za-z_])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![A-Za-z_\d.])-?\d*\.?\d+(?:[eE][+-]?\d+)?/g)) {
    const raw = m[0].replace(/,/g, "");
    if (raw === "." || raw === "-") continue;
    out.push(raw);
  }
  return out;
}

const norm = (s: string) => { const n = Number(s); return Number.isFinite(n) ? String(n) : s; };

/**
 * Returns numbers in the AI text that do not appear in the source. Small integers (0 to 10), years, and the conventional constants
 * (95, 0.05, 1.96 and the like) are allowed because they are used in ordinary prose. Percentages may also match a proportion.
 */
export function untracedNumbers(aiText: string, source: string): string[] {
  const src = new Set(numbersIn(source).map(norm));
  const allowed = new Set(["0.05", "0.01", "0.001", "95", "90", "99", "1.96", "100", "50"]);
  const bad: string[] = [];
  for (const raw of numbersIn(aiText)) {
    const n = Number(raw), k = norm(raw);
    if (src.has(k) || allowed.has(k)) continue;
    if (Number.isInteger(n) && n >= 0 && n <= 10) continue;
    if (Number.isInteger(n) && n >= 1900 && n <= 2100) continue;
    // "34.5%" written for a proportion 0.345 shown in the source
    if (src.has(norm(String(+(n / 100).toPrecision(12)))) || src.has(norm(String(+(n * 100).toPrecision(12))))) continue;
    // Rounding to fewer decimals than the source shows: accept if some source number rounds to it.
    const decimals = (raw.split(".")[1] ?? "").length;
    let rounded = false;
    for (const s of src) { const v = Number(s); if (Number.isFinite(v) && Number(v.toFixed(decimals)) === n && decimals < ((s.split(".")[1] ?? "").length)) { rounded = true; break; } }
    if (rounded) continue;
    if (!bad.includes(raw)) bad.push(raw);
  }
  return bad;
}

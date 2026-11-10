import { uniqueSlug } from "../protocol/slug";

export type VarRow = {
  name: string;
  role: string;
  measure: string; // what kind of measurement
  definition: string;
  source: string;
  unit: string;
  timepoint: string;
};

export type VarType = "continuous" | "categorical" | "binary" | "ordinal" | "date" | "text";
export type VarRole = "exposure" | "outcome" | "covariate" | "identifier" | "other";

export const MEASURE_OPTIONS = [
  { value: "number", label: "A measured number (weight, age in years, haemoglobin)" },
  { value: "category", label: "A category with no order (sex, religion, district)" },
  { value: "yesno", label: "Yes or no (present or absent)" },
  { value: "ordered", label: "An ordered category (mild, moderate, severe; stage I to IV)" },
  { value: "date", label: "A date or time" },
  { value: "text", label: "Free text" },
];

export const ROLE_OPTIONS = [
  { value: "exposure", label: "Exposure or intervention" },
  { value: "outcome", label: "Outcome" },
  { value: "covariate", label: "Covariate (confounder, effect modifier)" },
  { value: "identifier", label: "Identifier" },
  { value: "other", label: "Other" },
];

const TYPE_FOR: Record<string, VarType> = { number: "continuous", category: "categorical", yesno: "binary", ordered: "ordinal", date: "date", text: "text" };

const SCALE: Record<VarType, { scale: string; summary: string; compare: string }> = {
  continuous: { scale: "Interval or ratio", summary: "Mean and SD if roughly symmetric, otherwise median and IQR", compare: "t-test, ANOVA, correlation, linear regression" },
  categorical: { scale: "Nominal", summary: "Counts and percentages", compare: "Chi-square or Fisher exact test, logistic regression" },
  binary: { scale: "Nominal (two levels)", summary: "Counts and percentages", compare: "Chi-square or Fisher exact test, odds ratio or relative risk, logistic regression" },
  ordinal: { scale: "Ordinal", summary: "Counts and percentages by level, or median and IQR", compare: "Rank-based tests, ordinal regression" },
  date: { scale: "Date", summary: "Range, median date; derive durations", compare: "Survival or time-to-event methods when used for follow-up" },
  text: { scale: "Not analysed directly", summary: "Not summarised directly; code into categories first", compare: "Not applicable" },
};

export type VarClassified = { name: string; role: VarRole; type: VarType; scale: string; summary: string; compare: string; unit: string; timepoint: string; definition: string; source: string };

export function classifyVariables(rows: VarRow[]): { ok: true; items: VarClassified[]; warnings: string[]; slugs: string[] } | { ok: false; error: string } {
  const used = rows.map((r) => ({ ...r, name: r.name.trim() })).filter((r) => r.name);
  if (!used.length) return { ok: false, error: "Add at least one variable with a name." };
  const items: VarClassified[] = used.map((r) => {
    const type = TYPE_FOR[r.measure] ?? "text";
    const role = (["exposure", "outcome", "covariate", "identifier", "other"].includes(r.role) ? r.role : "other") as VarRole;
    return { name: r.name, role, type, ...SCALE[type], unit: r.unit.trim(), timepoint: r.timepoint.trim(), definition: r.definition.trim(), source: r.source.trim() };
  });
  const warnings: string[] = [];
  const names = new Map<string, number>();
  for (const i of items) names.set(i.name.toLowerCase(), (names.get(i.name.toLowerCase()) ?? 0) + 1);
  for (const [n, c] of names) if (c > 1) warnings.push(`"${n}" appears ${c} times. Each variable needs a unique name.`);
  if (!items.some((i) => i.role === "outcome")) warnings.push("No outcome variable. Every analytic study needs at least one primary outcome.");
  if (!items.some((i) => i.role === "exposure")) warnings.push("No exposure or intervention variable. Descriptive studies may not need one.");
  for (const i of items) {
    if (i.type === "continuous" && !i.unit) warnings.push(`"${i.name}" is a measured number without a unit.`);
    if (!i.definition && (i.role === "outcome" || i.role === "exposure")) warnings.push(`"${i.name}" is an ${i.role} but has no operational definition. Say exactly how it will be measured and what counts as a case or as exposed.`);
    if (i.role === "identifier" && i.type !== "text" && i.type !== "categorical") warnings.push(`"${i.name}" is an identifier. Identifiers are not analysed and need a confidentiality plan.`);
  }
  const taken = new Set<string>();
  const slugs = items.map((i) => { const s = uniqueSlug(i.name, taken); taken.add(s); return s; });
  return { ok: true, items, warnings, slugs };
}

export function definitionsText(items: VarClassified[]): string {
  const lines = items.map((i) => {
    const parts = [`${i.name} (${i.role}, ${i.scale.toLowerCase()})`];
    if (i.definition) parts.push(i.definition);
    if (i.source) parts.push(`Measured using ${i.source}`);
    if (i.unit) parts.push(`Unit or cut-off: ${i.unit}`);
    if (i.timepoint) parts.push(`Timing: ${i.timepoint}`);
    return `- ${parts.join(". ").replace(/\.\./g, ".")}.`;
  });
  return `Operational definitions\n${lines.join("\n")}`;
}

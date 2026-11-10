export type CriteriaRow = { type: string; category: string; text: string };

export const CRITERIA_CATEGORIES = [
  { value: "age", label: "Age" },
  { value: "condition", label: "Condition or diagnosis" },
  { value: "setting", label: "Setting, residence or time period" },
  { value: "consent", label: "Consent and ability to participate" },
  { value: "clinical", label: "Clinical status (pregnancy, severity, comorbidity)" },
  { value: "treatment", label: "Prior or current treatment" },
  { value: "other", label: "Other" },
];

/** Reminders shown as prompts. They are never inserted automatically. */
export const CATEGORY_PROMPTS: Record<string, string> = {
  age: "State the lower and upper age limits and how age is confirmed.",
  condition: "Say how the condition is confirmed (test, criteria, record) and when.",
  setting: "Name the facility, area and the dates of recruitment.",
  consent: "Say who consents, and assent or guardian consent for children.",
  clinical: "Think about pregnancy, severity, and conditions that would confound the outcome.",
  treatment: "Say which earlier or ongoing treatments exclude someone.",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const sentence = (s: string) => { const t = s.trim().replace(/[.;,]+$/, ""); return t ? t[0].toUpperCase() + t.slice(1) : t; };
const ORDER = CRITERIA_CATEGORIES.map((c) => c.value);

export function buildCriteria(rows: CriteriaRow[]): { ok: true; inclusion: string[]; exclusion: string[]; warnings: string[] } | { ok: false; error: string } {
  const used = rows.filter((r) => r.text.trim());
  if (!used.length) return { ok: false, error: "Add at least one criterion." };
  const byType = (t: string) => used.filter((r) => r.type === t).sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
  const dedupe = (rs: CriteriaRow[]) => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const r of rs) { const k = norm(r.text); if (!seen.has(k)) { seen.add(k); out.push(sentence(r.text)); } }
    return out;
  };
  const inclusion = dedupe(byType("inclusion")), exclusion = dedupe(byType("exclusion"));
  const warnings: string[] = [];
  const incSet = new Set(byType("inclusion").map((r) => norm(r.text)));
  for (const r of byType("exclusion")) if (incSet.has(norm(r.text))) warnings.push(`"${sentence(r.text)}" is listed as both an inclusion and an exclusion criterion.`);
  const dup = (t: string) => byType(t).length - dedupe(byType(t)).length;
  if (dup("inclusion") > 0) warnings.push(`${dup("inclusion")} duplicate inclusion criteri${dup("inclusion") > 1 ? "a were" : "on was"} removed.`);
  if (dup("exclusion") > 0) warnings.push(`${dup("exclusion")} duplicate exclusion criteri${dup("exclusion") > 1 ? "a were" : "on was"} removed.`);
  if (!inclusion.length) warnings.push("No inclusion criteria. Say who is eligible.");
  const has = (type: string, cat: string) => used.some((r) => r.type === type && r.category === cat);
  for (const cat of ["age", "condition", "setting", "consent"]) {
    if (!has("inclusion", cat) && !has("exclusion", cat)) warnings.push(`Nothing about ${CRITERIA_CATEGORIES.find((c) => c.value === cat)!.label.toLowerCase()}. ${CATEGORY_PROMPTS[cat]}`);
  }
  for (const r of used) if (/\b(etc|and so on|others?)\b/i.test(r.text)) warnings.push(`"${sentence(r.text)}" is open-ended. Eligibility criteria must be specific enough to apply the same way each time.`);
  return { ok: true, inclusion, exclusion, warnings };
}

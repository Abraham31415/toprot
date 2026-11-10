import { uniqueSlug } from "../protocol/slug";

export type QType = "single" | "multi" | "yesno" | "number" | "text" | "date" | "scale";
export type QRow = { section: string; text: string; type: string; options: string; required: string; unit: string };

export const QTYPES: { value: QType; label: string; varType: "categorical" | "binary" | "continuous" | "text" | "date" | "ordinal" }[] = [
  { value: "single", label: "Choose one", varType: "categorical" },
  { value: "multi", label: "Choose all that apply", varType: "categorical" },
  { value: "yesno", label: "Yes or no", varType: "binary" },
  { value: "number", label: "A number", varType: "continuous" },
  { value: "scale", label: "Agreement scale (1 to 5)", varType: "ordinal" },
  { value: "date", label: "A date", varType: "date" },
  { value: "text", label: "Free text", varType: "text" },
];

export const LIKERT = ["Strongly disagree", "Disagree", "Neither agree nor disagree", "Agree", "Strongly agree"];

export type Question = { n: number; section: string; text: string; type: QType; options: string[]; required: boolean; unit: string; variable: string; varType: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function buildQuestionnaire(rows: QRow[]): { ok: true; questions: Question[]; warnings: string[] } | { ok: false; error: string } {
  const used = rows.filter((r) => r.text.trim());
  if (!used.length) return { ok: false, error: "Add at least one question." };
  const taken = new Set<string>();
  const warnings: string[] = [];
  const questions: Question[] = used.map((r, i) => {
    const type = (QTYPES.some((t) => t.value === r.type) ? r.type : "text") as QType;
    const options = type === "scale" ? LIKERT : type === "yesno" ? ["Yes", "No"] : r.options.split(/[;\n]/).map((o) => o.trim()).filter(Boolean);
    const slug = uniqueSlug(r.text.split(/\s+/).slice(0, 6).join(" "), taken);
    taken.add(slug);
    return { n: i + 1, section: r.section.trim(), text: cap(r.text.trim().replace(/\?*$/, "")) + (/[a-z)]$/i.test(r.text.trim().replace(/\?*$/, "")) ? "?" : ""), type, options, required: r.required !== "no", unit: r.unit.trim(), variable: `q${i + 1}_${slug}`.slice(0, 40), varType: QTYPES.find((t) => t.value === type)!.varType };
  });
  const seen = new Map<string, number>();
  for (const q of questions) {
    const k = norm(q.text);
    if (seen.has(k)) warnings.push(`Questions ${seen.get(k)} and ${q.n} are the same.`);
    else seen.set(k, q.n);
    if ((q.type === "single" || q.type === "multi") && q.options.length < 2) warnings.push(`Question ${q.n} needs at least two answer options.`);
    if ((q.type === "single" || q.type === "multi") && new Set(q.options.map(norm)).size !== q.options.length) warnings.push(`Question ${q.n} has repeated answer options.`);
    if (/\b(and|or)\b/i.test(q.text) && q.text.split(" ").length > 6 && q.type !== "multi") warnings.push(`Question ${q.n} may ask two things at once (double-barrelled): "${q.text}". Split it into two questions.`);
    if (/\b(don't you|do not you|wouldn't you|isn't it|surely|obviously|everyone knows)\b/i.test(q.text)) warnings.push(`Question ${q.n} may be a leading question. Ask neutrally.`);
    if (/\b(always|never|all the time)\b/i.test(q.text)) warnings.push(`Question ${q.n} uses an absolute word (always or never). People struggle to answer these accurately.`);
    if (q.type === "number" && !q.unit) warnings.push(`Question ${q.n} asks for a number without a unit.`);
    if (q.text.split(" ").length > 30) warnings.push(`Question ${q.n} is very long. Shorter questions are easier to answer reliably.`);
  }
  if (questions.length > 40) warnings.push(`${questions.length} questions is long. Long questionnaires lower response quality. Keep only what the objectives need.`);
  warnings.push("Use a validated scale where one exists for what you are measuring, and pilot-test any new questions on a few people before use.");
  return { ok: true, questions, warnings };
}

export function questionnaireText(qs: Question[]): string {
  const out: string[] = [];
  let section = "";
  for (const q of qs) {
    if (q.section && q.section !== section) { section = q.section; out.push(`\n${section.toUpperCase()}`); }
    out.push(`${q.n}. ${q.text}${q.required ? "" : " (optional)"}`);
    if (q.type === "multi") out.push("   (select all that apply)");
    if (q.options.length) out.push(...q.options.map((o) => `   [ ] ${o}`));
    else if (q.type === "number") out.push(`   ______ ${q.unit}`.trimEnd());
    else if (q.type === "date") out.push("   __ / __ / ____");
    else out.push("   ____________________________");
  }
  return out.join("\n").trim();
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsv = (head: string[], rows: string[][]) => [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");

export function codebookCsv(qs: Question[]): string {
  return toCsv(["variable", "question", "type", "values", "unit", "required", "section"], qs.map((q) => [q.variable, q.text, q.varType, q.options.map((o, i) => (q.type === "yesno" ? `${i === 0 ? 1 : 0}=${o}` : `${i + 1}=${o}`)).join("; "), q.unit, q.required ? "yes" : "no", q.section]));
}

// ---- Data dictionary ----

export type DictRow = { name: string; label: string; type: string; values: string; unit: string; range: string; required: string; source: string };
export const DICT_TYPES = [
  { value: "continuous", label: "Number (continuous)" }, { value: "categorical", label: "Category" }, { value: "binary", label: "Yes or no" },
  { value: "ordinal", label: "Ordered category" }, { value: "date", label: "Date" }, { value: "text", label: "Free text" },
];

export type DictEntry = { name: string; slug: string; label: string; type: string; values: string; unit: string; range: string; required: boolean; source: string };

export function buildDictionary(rows: DictRow[]): { ok: true; entries: DictEntry[]; warnings: string[]; csv: string } | { ok: false; error: string } {
  const used = rows.filter((r) => r.name.trim());
  if (!used.length) return { ok: false, error: "Add at least one variable." };
  const taken = new Set<string>();
  const warnings: string[] = [];
  const entries: DictEntry[] = used.map((r) => {
    const slug = uniqueSlug(r.name, taken);
    taken.add(slug);
    return { name: r.name.trim(), slug, label: r.label.trim() || r.name.trim(), type: DICT_TYPES.some((t) => t.value === r.type) ? r.type : "text", values: r.values.trim(), unit: r.unit.trim(), range: r.range.trim(), required: r.required !== "no", source: r.source.trim() };
  });
  const names = new Map<string, number>();
  for (const e of entries) names.set(e.name.toLowerCase(), (names.get(e.name.toLowerCase()) ?? 0) + 1);
  for (const [n, c] of names) if (c > 1) warnings.push(`"${n}" is listed ${c} times. The repeats were given numbered names.`);
  for (const e of entries) {
    if ((e.type === "categorical" || e.type === "ordinal" || e.type === "binary") && !e.values) warnings.push(`"${e.name}" needs its allowed values with codes, for example 1=Yes; 0=No.`);
    if (e.type === "continuous" && !e.unit) warnings.push(`"${e.name}" is a number without a unit.`);
    if (e.type === "continuous" && !e.range) warnings.push(`"${e.name}" has no plausible range. A range lets you catch entry errors, for example 0 to 120.`);
    if (e.type === "continuous" && e.range && !/^\s*-?\d+(\.\d+)?\s*(to|-|–)\s*-?\d+(\.\d+)?\s*$/i.test(e.range)) warnings.push(`The range for "${e.name}" should look like "0 to 120".`);
    if (/[^\x20-\x7e]/.test(e.name) || e.name.length > 40) warnings.push(`"${e.name}" is not a good variable name. Stay with short plain names.`);
  }
  const csv = toCsv(["variable", "name", "label", "type", "values", "unit", "plausible_range", "required", "source"], entries.map((e) => [e.slug, e.name, e.label, e.type, e.values, e.unit, e.range, e.required ? "yes" : "no", e.source]));
  return { ok: true, entries, warnings, csv };
}

// ---- Timeline ----

export type PhaseRow = { name: string; weeks: string; start: string; milestone: string };

export const MILESTONE_CHOICES = [
  { value: "", label: "No milestone" },
  { value: "protocol_written", label: "Protocol written" }, { value: "ethics_submitted", label: "Ethics submitted" }, { value: "ethics_approved", label: "Ethics approved" },
  { value: "enrollment_started", label: "Enrollment started" }, { value: "enrollment_completed", label: "Enrollment completed" }, { value: "data_collection_complete", label: "Data collection complete" },
  { value: "analysis_complete", label: "Analysis complete" }, { value: "manuscript_drafted", label: "Manuscript drafted" }, { value: "submitted_for_publication", label: "Submitted for publication" },
];

const DAY = 86400000;
const parseDate = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return null; const t = Date.UTC(+m[1], +m[2] - 1, +m[3]); return Number.isNaN(t) ? null : t; };
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export type Scheduled = { name: string; start: string; end: string; weeks: number; milestone: string };

export function buildTimeline(startDate: string, rows: PhaseRow[]): { ok: true; phases: Scheduled[]; endDate: string; totalWeeks: number; warnings: string[]; milestones: { milestone_type: string; target_date: string }[] } | { ok: false; error: string } {
  const start = parseDate(startDate);
  if (start === null) return { ok: false, error: "Choose a valid start date." };
  const used = rows.filter((r) => r.name.trim());
  if (!used.length) return { ok: false, error: "Add at least one phase." };
  const warnings: string[] = [];
  const phases: Scheduled[] = [];
  let cursor = start, prevStart = start, last = start;
  for (const r of used) {
    const weeks = Number(r.weeks);
    if (!Number.isFinite(weeks) || weeks <= 0) return { ok: false, error: `"${r.name.trim()}" needs a duration in weeks greater than 0.` };
    if (weeks > 260) return { ok: false, error: `"${r.name.trim()}" is longer than 5 years. Check the weeks.` };
    const s = r.start === "with" && phases.length ? prevStart : cursor;
    const e = s + Math.round(weeks * 7) * DAY - DAY;
    phases.push({ name: r.name.trim(), start: iso(s), end: iso(e), weeks, milestone: r.milestone });
    prevStart = s;
    cursor = Math.max(cursor, e + DAY);
    last = Math.max(last, e);
  }
  const totalWeeks = Math.round((last - start) / DAY / 7 + 1 / 7);
  const idx = (m: string) => phases.findIndex((p) => p.milestone === m);
  const seen = new Set<string>();
  for (const p of phases) { if (p.milestone) { if (seen.has(p.milestone)) warnings.push(`Milestone "${p.milestone.replace(/_/g, " ")}" is attached to more than one phase. Only the first is used.`); seen.add(p.milestone); } }
  const order = ["protocol_written", "ethics_submitted", "ethics_approved", "enrollment_started", "enrollment_completed", "data_collection_complete", "analysis_complete", "manuscript_drafted", "submitted_for_publication"];
  const dated = order.filter((m) => idx(m) >= 0).map((m) => ({ m, date: m === "enrollment_started" ? phases[idx(m)].start : phases[idx(m)].end }));
  for (let i = 1; i < dated.length; i++) if (dated[i].date < dated[i - 1].date) warnings.push(`"${dated[i].m.replace(/_/g, " ")}" is scheduled before "${dated[i - 1].m.replace(/_/g, " ")}".`);
  if (idx("ethics_approved") < 0 && idx("enrollment_started") >= 0) warnings.push("Enrolment is planned but no phase is marked as ethics approval. Do not recruit before approval.");
  if (idx("ethics_approved") >= 0 && idx("enrollment_started") >= 0 && phases[idx("enrollment_started")].start <= phases[idx("ethics_approved")].end) warnings.push("Enrolment starts before ethics approval is complete. Move recruitment after approval.");
  if (idx("analysis_complete") >= 0 && idx("data_collection_complete") >= 0 && phases[idx("analysis_complete")].start < phases[idx("data_collection_complete")].end) warnings.push("Analysis starts before data collection ends. That is fine for interim checks, but final analysis needs the complete data.");
  if (totalWeeks > 104) warnings.push(`The plan runs ${totalWeeks} weeks (over two years). Student projects usually need to finish sooner.`);
  warnings.push("Ethics review and data collection usually take longer than planned. Add buffer time.");
  const milestones = dated.map((d) => ({ milestone_type: d.m, target_date: d.date }));
  return { ok: true, phases, endDate: iso(last), totalWeeks, warnings, milestones };
}

// ---- Consent and ethics templates ----

export type ConsentInput = {
  kind: "adult" | "child";
  title: string; researcher: string; institution: string; contact: string; committeeContact: string;
  purpose: string; procedures: string; duration: string; risks: string; benefits: string; compensation: string; confidentiality: string; ageRange: string; language: string;
};

const NEED = (label: string) => `[ADD: ${label}]`;

export function buildConsent(i: ConsentInput): { ok: true; sections: { title: string; text: string }[]; missing: string[]; warnings: string[]; document: string; paragraphs: { consent: string; risks: string; confidentiality: string } } | { ok: false; error: string } {
  if (!i.title.trim()) return { ok: false, error: "Enter the study title." };
  const missing: string[] = [];
  const f = (v: string, label: string) => { if (v.trim()) return v.trim().replace(/\s+/g, " "); missing.push(label); return NEED(label); };
  const title = i.title.trim(), who = f(i.researcher, "researcher name"), inst = f(i.institution, "institution");
  const purpose = f(i.purpose, "purpose of the study in plain language"), procedures = f(i.procedures, "what participants will be asked to do"), duration = f(i.duration, "how long participation takes");
  const risks = f(i.risks, "possible risks or discomforts"), benefits = f(i.benefits, "possible benefits"), contact = f(i.contact, "researcher contact details");
  const conf = f(i.confidentiality, "how information will be kept private");
  const comp = i.compensation.trim() || "You will not be paid for taking part.";
  const child = i.kind === "child";
  const you = child ? "your child" : "you";
  const sections: { title: string; text: string }[] = [
    { title: "Study title", text: title },
    { title: "Who is doing the study", text: `${who} of ${inst}.` },
    { title: "Why this study is being done", text: purpose },
    { title: "What taking part involves", text: `${procedures} Taking part will take ${duration}.` },
    { title: "Possible risks or discomforts", text: risks },
    { title: "Possible benefits", text: benefits },
    { title: "Payment or costs", text: comp },
    { title: "Privacy and confidentiality", text: `${conf} Your name will not appear in any report. Only the study team will see information that could identify ${you}.` },
    { title: "Taking part is voluntary", text: `Taking part is your choice. ${child ? "You may say no, and you may stop at any time, and " : "You may say no, or stop at any time, and "}nothing will change about the care or services ${you} receive. If ${you} stop, you can ask for ${child ? "your child's" : "your"} information to be removed up to the point it has been analysed.` },
    { title: "Questions and contacts", text: `For questions about the study, contact ${contact}.${i.committeeContact.trim() ? ` For questions about your rights as a participant, contact the ethics committee: ${i.committeeContact.trim()}.` : ` ${NEED("ethics committee name and contact for questions about participant rights")}`}` },
  ];
  if (!i.committeeContact.trim()) missing.push("ethics committee contact");
  if (child) {
    sections.splice(1, 0, { title: "Children covered", text: `Children aged ${i.ageRange.trim() || NEED("age range")}.` });
    if (!i.ageRange.trim()) missing.push("age range");
    sections.push({ title: "Child's assent (to be read in simple language)", text: "We are asking if you would like to take part in a study. It will help us learn something. You can say no and nothing bad will happen. You can stop whenever you like. If you want to take part, please say yes or sign below." });
  }
  const sign = child
    ? "Parent or guardian: I have read or had read to me this information. I have had the chance to ask questions. I agree for my child to take part.\nName: ______  Signature or thumbprint: ______  Date: ______\n\nChild assent: I agree to take part.  Name: ______  Mark: ______  Date: ______\n\nResearcher: I have explained the study and answered questions.\nName: ______  Signature: ______  Date: ______"
    : "Participant: I have read or had read to me this information. I have had the chance to ask questions. I agree to take part voluntarily.\nName: ______  Signature or thumbprint: ______  Date: ______\n\nResearcher: I have explained the study and answered questions.\nName: ______  Signature: ______  Date: ______";
  sections.push({ title: "Consent", text: sign });
  const document = `${child ? "PARENT OR GUARDIAN INFORMATION AND CONSENT, AND CHILD ASSENT" : "PARTICIPANT INFORMATION AND CONSENT FORM"}\n\n${sections.map((s) => `${s.title}\n${s.text}`).join("\n\n")}`;
  const warnings: string[] = [];
  if (missing.length) warnings.push(`Still to add: ${[...new Set(missing)].join("; ")}. They appear as [ADD: ...] in the text.`);
  if (/\b(no risk|risk[- ]free|completely safe)\b/i.test(i.risks)) warnings.push('Saying there is "no risk" is rarely accurate. Describe even small risks such as time, inconvenience, embarrassment or breach of privacy.');
  if (i.compensation.trim() && /(ugx|usd|shillings?|dollars?|\$)/i.test(i.compensation) && !/(not|no)\b/i.test(i.compensation)) warnings.push("Payment must not be large enough to pressure people into taking part. Many ethics committees expect reimbursement of costs only. Check yours.");
  warnings.push("Use plain language at about a primary school reading level, and translate into the local language. Your ethics committee's own template and requirements take precedence over this one.");
  const paragraphs = {
    consent: `${child ? "Written permission will be obtained from a parent or guardian, and assent from the child in simple language where age-appropriate (" + (i.ageRange.trim() || "age range to be stated") + "). " : "Written informed consent will be obtained from each participant (signature or thumbprint if they cannot write) after the study has been explained. "}Participation is voluntary, and participants may withdraw at any time without consequence. A copy of the information sheet is given to each participant.`,
    risks: `Risks: ${risks}. Benefits: ${benefits}. ${comp}`,
    confidentiality: `${conf} Records will be identified by a study code, and the key linking codes to names will be stored separately from the data. Only the study team will have access.`,
  };
  return { ok: true, sections, missing: [...new Set(missing)], warnings, document, paragraphs };
}

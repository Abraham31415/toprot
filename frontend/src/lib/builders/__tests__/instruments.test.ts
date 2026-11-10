import { describe, expect, it } from "vitest";
import { buildConsent, buildDictionary, buildQuestionnaire, buildTimeline, codebookCsv, questionnaireText, toCsv, type ConsentInput, type PhaseRow, type QRow } from "../instruments";

const Q = (o: Partial<QRow> = {}): QRow => ({ section: "", text: "What is your age", type: "number", options: "", required: "yes", unit: "years", ...o });

describe("questionnaire builder", () => {
  it("numbers questions, builds unique variable names and fixes answer lists for yes/no and scales", () => {
    const r = buildQuestionnaire([Q(), Q({ text: "What is your age" }), Q({ text: "Have you had diarrhoea", type: "yesno", unit: "" }), Q({ text: "Staff were clear", type: "scale", unit: "" })]);
    if (!r.ok) throw new Error(r.error);
    expect(r.questions.map((q) => q.n)).toEqual([1, 2, 3, 4]);
    expect(new Set(r.questions.map((q) => q.variable)).size).toBe(4);
    expect(r.questions[0].variable).toBe("q1_what_is_your_age");
    expect(r.questions[2].options).toEqual(["Yes", "No"]);
    expect(r.questions[3].options).toHaveLength(5);
    expect(r.questions[0].text).toBe("What is your age?");
    expect(r.questions[0].varType).toBe("continuous");
    expect(r.warnings.join(" ")).toMatch(/Questions 1 and 2 are the same/);
  });
  it("flags double-barrelled, leading, absolute, unit-less and option problems", () => {
    const r = buildQuestionnaire([
      Q({ text: "Do you eat vegetables and take exercise regularly", type: "yesno", unit: "" }),
      Q({ text: "Surely the clinic is clean", type: "yesno", unit: "" }),
      Q({ text: "Do you always wash your hands", type: "yesno", unit: "" }),
      Q({ text: "How much do you weigh", type: "number", unit: "" }),
      Q({ text: "Which district", type: "single", options: "Kampala", unit: "" }),
      Q({ text: "Which tribe", type: "single", options: "A; a", unit: "" }),
    ]);
    if (!r.ok) throw new Error(r.error);
    const w = r.warnings.join(" | ");
    expect(w).toMatch(/Question 1 may ask two things/);
    expect(w).toMatch(/Question 2 may be a leading question/);
    expect(w).toMatch(/Question 3 uses an absolute word/);
    expect(w).toMatch(/Question 4 asks for a number without a unit/);
    expect(w).toMatch(/Question 5 needs at least two answer options/);
    expect(w).toMatch(/Question 6 has repeated answer options/);
    expect(w).toMatch(/pilot-test/);
  });
  it("renders a printable form with sections, options and optional markers", () => {
    const r = buildQuestionnaire([Q({ section: "Health", text: "Which symptoms", type: "multi", options: "Cough; Fever", unit: "", required: "no" })]);
    if (!r.ok) throw new Error(r.error);
    const t = questionnaireText(r.questions);
    expect(t).toContain("HEALTH");
    expect(t).toContain("1. Which symptoms? (optional)");
    expect(t).toContain("(select all that apply)");
    expect(t).toContain("[ ] Cough");
  });
  it("exports a codebook CSV with correctly quoted cells and yes/no coding", () => {
    const r = buildQuestionnaire([Q({ text: "Do you smoke, drink or chew tobacco", type: "yesno", unit: "" })]);
    if (!r.ok) throw new Error(r.error);
    const csv = codebookCsv(r.questions);
    expect(csv.split("\n")[0]).toBe("variable,question,type,values,unit,required,section");
    expect(csv).toContain('"Do you smoke, drink or chew tobacco?"');
    expect(csv).toContain("1=Yes; 0=No");
    expect(toCsv(["a"], [['say "hi"']])).toBe('a\n"say ""hi"""');
  });
  it("requires at least one question and warns on very long questionnaires", () => {
    expect(buildQuestionnaire([]).ok).toBe(false);
    const many = buildQuestionnaire(Array.from({ length: 41 }, (_, i) => Q({ text: `Question number ${i}` })));
    if (!many.ok) throw new Error(many.error);
    expect(many.warnings.join(" ")).toMatch(/41 questions is long/);
  });
});

describe("data dictionary builder", () => {
  const row = (o: Record<string, string> = {}) => ({ name: "Age", label: "Age in years", type: "continuous", values: "", unit: "years", range: "0 to 120", required: "yes", source: "Form", ...o });
  it("makes unique slugs and exports CSV", () => {
    const r = buildDictionary([row(), row({ name: "age" }), row({ name: "Sex", type: "categorical", values: "1=F; 2=M", unit: "", range: "" })]);
    if (!r.ok) throw new Error(r.error);
    expect(r.entries.map((e) => e.slug)).toEqual(["age", "age_2", "sex"]);
    expect(r.csv.split("\n")[0]).toBe("variable,name,label,type,values,unit,plausible_range,required,source");
    expect(r.warnings.join(" ")).toMatch(/listed 2 times/);
  });
  it("warns about missing codes, units and ranges, and malformed ranges", () => {
    const r = buildDictionary([row({ name: "Smoker", type: "binary", values: "", unit: "", range: "" }), row({ name: "Weight", unit: "", range: "" }), row({ name: "Height", range: "tall" })]);
    if (!r.ok) throw new Error(r.error);
    const w = r.warnings.join(" | ");
    expect(w).toMatch(/"Smoker" needs its allowed values/);
    expect(w).toMatch(/"Weight" is a number without a unit/);
    expect(w).toMatch(/"Weight" has no plausible range/);
    expect(w).toMatch(/range for "Height" should look like/);
  });
  it("accepts well-formed ranges and rejects an empty dictionary", () => {
    const r = buildDictionary([row({ range: "-5 to 40" })]);
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings).toEqual([]);
    expect(buildDictionary([]).ok).toBe(false);
  });
});

const ph = (name: string, weeks: string, milestone = "", start = "after"): PhaseRow => ({ name, weeks, start, milestone });

describe("research timeline builder", () => {
  it("schedules phases sequentially with calendar-correct dates", () => {
    const r = buildTimeline("2027-02-01", [ph("Protocol", "8", "protocol_written"), ph("Ethics", "10", "ethics_approved")]);
    if (!r.ok) throw new Error(r.error);
    expect(r.phases[0]).toMatchObject({ start: "2027-02-01", end: "2027-03-28" });
    expect(r.phases[1].start).toBe("2027-03-29");
    expect(r.phases[1].end).toBe("2027-06-06");
    expect(r.endDate).toBe("2027-06-06");
    expect(r.totalWeeks).toBe(18);
    expect(r.milestones).toEqual([{ milestone_type: "protocol_written", target_date: "2027-03-28" }, { milestone_type: "ethics_approved", target_date: "2027-06-06" }]);
  });
  it("lets a phase run with the previous one and ends at the latest end", () => {
    const r = buildTimeline("2027-01-04", [ph("Collect data", "12"), ph("Clean data as it comes in", "20", "", "with"), ph("Analyse", "4")]);
    if (!r.ok) throw new Error(r.error);
    expect(r.phases[1].start).toBe(r.phases[0].start);
    expect(r.phases[2].start).toBe("2027-05-24");
    // The 20-week phase runs alongside the 12-week one, then 4 weeks of analysis: 20 + 4 weeks.
    expect(r.totalWeeks).toBe(24);
    expect(r.endDate).toBe("2027-06-20");
  });
  it("uses the start date for 'enrollment started' and the end date for the rest", () => {
    const r = buildTimeline("2027-01-04", [ph("Recruit", "4", "enrollment_started")]);
    if (!r.ok) throw new Error(r.error);
    expect(r.milestones[0]).toEqual({ milestone_type: "enrollment_started", target_date: "2027-01-04" });
  });
  it("warns about enrolment before ethics approval, wrong milestone order, and long plans", () => {
    const a = buildTimeline("2027-01-04", [ph("Recruit", "4", "enrollment_started"), ph("Ethics", "6", "ethics_approved")]);
    if (!a.ok) throw new Error(a.error);
    expect(a.warnings.join(" ")).toMatch(/before "enrollment started"|scheduled before/);
    const b = buildTimeline("2027-01-04", [ph("Recruit", "4", "enrollment_started")]);
    if (!b.ok) throw new Error(b.error);
    expect(b.warnings.join(" ")).toMatch(/no phase is marked as ethics approval/);
    const c = buildTimeline("2027-01-04", [ph("Ethics", "6", "ethics_approved"), ph("Recruit", "110", "enrollment_started", "with")]);
    if (!c.ok) throw new Error(c.error);
    expect(c.warnings.join(" ")).toMatch(/starts before ethics approval is complete/);
    expect(c.warnings.join(" ")).toMatch(/over two years/);
  });
  it("rejects bad dates, empty plans and invalid durations", () => {
    expect(buildTimeline("not a date", [ph("A", "4")]).ok).toBe(false);
    expect(buildTimeline("", [ph("A", "4")]).ok).toBe(false);
    expect(buildTimeline("2027-01-04", []).ok).toBe(false);
    expect(buildTimeline("2027-01-04", [ph("A", "0")]).ok).toBe(false);
    expect(buildTimeline("2027-01-04", [ph("A", "abc")]).ok).toBe(false);
    expect(buildTimeline("2027-01-04", [ph("A", "999")]).ok).toBe(false);
  });
});

const C = (o: Partial<ConsentInput> = {}): ConsentInput => ({
  kind: "adult", title: "A study", researcher: "A. Researcher", institution: "Makerere University", contact: "0700 000 000", committeeContact: "REC, 0700 111 111",
  purpose: "To learn X.", procedures: "Answer questions.", duration: "20 minutes", risks: "Possible embarrassment.", benefits: "None directly.", compensation: "", confidentiality: "Codes only.", ageRange: "", language: "", ...o,
});

describe("consent and ethics template builder", () => {
  it("builds all standard sections for an adult form with no missing items", () => {
    const r = buildConsent(C());
    if (!r.ok) throw new Error(r.error);
    expect(r.sections.map((s) => s.title)).toEqual(["Study title", "Who is doing the study", "Why this study is being done", "What taking part involves", "Possible risks or discomforts", "Possible benefits", "Payment or costs", "Privacy and confidentiality", "Taking part is voluntary", "Questions and contacts", "Consent"]);
    expect(r.missing).toEqual([]);
    expect(r.document).toContain("PARTICIPANT INFORMATION AND CONSENT FORM");
    expect(r.sections.find((s) => s.title === "Payment or costs")!.text).toBe("You will not be paid for taking part.");
  });
  it("marks missing information instead of inventing it", () => {
    const r = buildConsent(C({ risks: "", benefits: "", contact: "", committeeContact: "" }));
    if (!r.ok) throw new Error(r.error);
    expect(r.document).toContain("[ADD: possible risks or discomforts]");
    expect(r.document).toContain("[ADD: ethics committee name and contact");
    expect(r.missing).toEqual(expect.arrayContaining(["possible risks or discomforts", "possible benefits", "researcher contact details", "ethics committee contact"]));
    expect(r.warnings[0]).toMatch(/Still to add/);
  });
  it("child form adds the age range, parent permission and a child assent section", () => {
    const r = buildConsent(C({ kind: "child", ageRange: "6 to 59 months" }));
    if (!r.ok) throw new Error(r.error);
    expect(r.document).toContain("PARENT OR GUARDIAN INFORMATION AND CONSENT, AND CHILD ASSENT");
    expect(r.sections.some((s) => s.title.startsWith("Child's assent"))).toBe(true);
    expect(r.sections.find((s) => s.title === "Children covered")!.text).toContain("6 to 59 months");
    expect(buildConsent(C({ kind: "child", ageRange: "" })).ok && (buildConsent(C({ kind: "child", ageRange: "" })) as { missing: string[] }).missing).toContain("age range");
  });
  it("warns about 'no risk' claims and large payments", () => {
    const a = buildConsent(C({ risks: "There is no risk." }));
    if (!a.ok) throw new Error(a.error);
    expect(a.warnings.join(" ")).toMatch(/no risk/);
    const b = buildConsent(C({ compensation: "UGX 50,000 for your time" }));
    if (!b.ok) throw new Error(b.error);
    expect(b.warnings.join(" ")).toMatch(/pressure/);
    const c = buildConsent(C({ compensation: "No payment. UGX 5,000 transport refund" }));
    if (!c.ok) throw new Error(c.error);
    expect(c.warnings.join(" ")).not.toMatch(/pressure/);
  });
  it("produces short protocol paragraphs and requires a title", () => {
    const r = buildConsent(C());
    if (!r.ok) throw new Error(r.error);
    expect(r.paragraphs.consent).toMatch(/Written informed consent/);
    expect(r.paragraphs.risks).toMatch(/^Risks: Possible embarrassment\./);
    expect(r.paragraphs.confidentiality).toMatch(/study code/);
    expect(buildConsent(C({ title: " " })).ok).toBe(false);
  });
});

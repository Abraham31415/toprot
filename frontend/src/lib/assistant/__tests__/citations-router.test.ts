import { describe, expect, it } from "vitest";
import { redactUnverifiedCitations, REDACTED_CITATION, REDACTED_DOI, type KnownRef } from "../citations";
import { routeRequest, type RouteInput } from "../router";
import { DEFAULT_LIMITS, limitsFromSettings, loadAssistantLimits } from "../limits";
import { TASKS, getTask } from "../tasks";

const KNOWN: KnownRef[] = [
  { id: "r1", doi: "10.1016/S0140-6736(20)30183-5", pmid: "32007143", year: 2020, families: ["Smith", "Müller"] },
  { id: "r2", doi: null, pmid: null, year: 2018, families: ["Nakato"] },
];
const red = (t: string, k = KNOWN) => redactUnverifiedCitations(t, k);

describe("redactUnverifiedCitations", () => {
  it("keeps citations of references the user saved, in the usual shapes", () => {
    for (const t of ["as shown by Smith et al. (2020)", "(Smith, 2020)", "(Smith and Müller, 2020)", "Smith et al., 2020 found", "Muller (2020) reported", "(Nakato, 2018)", "(Nakato 2018)"]) {
      expect(red(t).text, t).toBe(t);
      expect(red(t).removed, t).toEqual([]);
    }
  });
  it("removes author-year citations of papers that are not in the library", () => {
    const r = red("Prior work (Johnson et al., 2019) and Okafor (2021) disagree, but (Smith, 2020; Brown, 2017) agree.");
    expect(r.text).not.toMatch(/Johnson|Okafor|Brown/);
    expect(r.text).toContain("(Smith, 2020");
    expect(r.text.split(REDACTED_CITATION).length - 1).toBe(3);
    expect(r.removed.length).toBe(3);
  });
  it("removes a real author with the wrong year, because that is a different (or invented) paper", () => {
    expect(red("see (Smith, 2019)").text).toBe(`see (${REDACTED_CITATION})`);
  });
  it("removes DOIs and PMIDs that are not saved, keeps those that are", () => {
    const r = red("See doi 10.1056/NEJMoa2034577 and 10.1016/S0140-6736(20)30183-5, PMID 12345678 and PMID 32007143.");
    expect(r.text).toContain(REDACTED_DOI);
    expect(r.text).toContain("10.1016/S0140-6736(20)30183-5");
    expect(r.text).toContain("PMID 32007143");
    expect(r.text).not.toContain("NEJMoa2034577");
    expect(r.text).not.toContain("12345678");
  });
  it("matches DOIs written as links and with trailing punctuation", () => {
    expect(red("https://doi.org/10.1016/S0140-6736(20)30183-5.").text).toContain("10.1016/S0140-6736(20)30183-5");
    expect(red("https://doi.org/10.9999/fake.123).").text).toContain(REDACTED_DOI);
  });
  it("does not touch ordinary text with years, months, places or phases", () => {
    for (const t of ["In March 2020 the clinic opened.", "Uganda 2019 census data", "Phase 2020 of the study", "The survey ran from Kenya 2021", "Enrolment ended in 2022, and analysis began", "Figure 2019 shows", "Version 2021"]) {
      expect(red(t).text, t).toBe(t);
    }
  });
  it("does not treat a bare Name Year without citation shape as a citation", () => {
    expect(red("Okafor 2021 was the year").text).toBe("Okafor 2021 was the year");
  });
  it("with no saved references, every citation-shaped string is removed", () => {
    const r = red("Smith et al. (2020) and 10.1234/abcd.1234", []);
    expect(r.text).toBe(`${REDACTED_CITATION} and ${REDACTED_DOI}`);
  });
  it("handles accents and case in names", () => {
    expect(red("(MULLER, 2020)").text).toBe("(MULLER, 2020)");
    expect(red("(Müller, 2020)").text).toBe("(Müller, 2020)");
  });
  it("returns each removed item once", () => {
    const r = red("(Johnson, 2019) and again (Johnson, 2019)");
    expect(r.removed).toEqual(["Johnson, 2019"]);
  });
  it("is safe on empty and very long input", () => {
    expect(red("").text).toBe("");
    const long = "word ".repeat(50000);
    expect(red(long).text).toBe(long);
  });
});

const base: RouteInput = { task: "protocol_review", messageChars: 400, contextChars: 5000, documentCount: 0, thorough: false, deepAllowed: true };
const route = (o: Partial<RouteInput> = {}, ctx = { study: true, docs: true, ms: true }) => routeRequest({ ...base, ...o }, ctx.study, ctx.docs, ctx.ms);

describe("routeRequest", () => {
  it("starts each task at its tier and maps tiers to features", () => {
    expect(route({ task: "brainstorm" }).tier).toBe("light");
    expect(route({ task: "brainstorm" }).featureKey).toBe("assistant_light");
    expect(route().tier).toBe("standard");
    expect(route().featureKey).toBe("assistant_standard");
  });
  it("uses a lighter model for short questions that use little material", () => {
    const r = route({ task: "explain_with_citations", messageChars: 80, contextChars: 1500 });
    expect(r.tier).toBe("light");
    expect(r.reasons.join(" ")).toMatch(/lighter/);
  });
  it("uses a stronger tier for large context or several documents", () => {
    expect(route({ contextChars: 25000 }).tier).toBe("deep");
    expect(route({ documentCount: 5 }).tier).toBe("deep");
    expect(route({ task: "brainstorm", contextChars: 25000 }).tier).toBe("standard");
  });
  it("raises the tier when the user asks for a thorough pass, never above deep", () => {
    expect(route({ thorough: true }).tier).toBe("deep");
    expect(route({ thorough: true, contextChars: 30000 }).tier).toBe("deep");
    expect(route({ task: "brainstorm", thorough: true }).tier).toBe("standard");
  });
  it("falls back to standard when the deep tier is not permitted, and says so", () => {
    const r = route({ thorough: true, deepAllowed: false });
    expect(r.tier).toBe("standard");
    expect(r.downgraded).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/not available/);
  });
  it("only grants tools that fit what the project has", () => {
    const none = route({ task: "literature_summary" }, { study: false, docs: false, ms: false });
    expect(none.tools).toEqual([]);
    const full = route({ task: "document_review" }, { study: true, docs: true, ms: true });
    expect(full.tools.sort()).toEqual(["get_manuscript", "get_protocol", "list_pdfs", "search_pdfs"]);
    const noPdf = route({ task: "document_review" }, { study: true, docs: false, ms: true });
    expect(noPdf.tools.sort()).toEqual(["get_manuscript", "get_protocol"]);
  });
  it("every task has a definition and no task grants a write capability", () => {
    expect(TASKS).toHaveLength(11);
    for (const t of TASKS) {
      expect(getTask(t.id)).toBe(t);
      for (const tool of t.tools) expect(["get_protocol", "list_references", "get_reference", "search_pdfs", "list_pdfs", "get_manuscript"]).toContain(tool);
    }
    expect(() => routeRequest({ ...base, task: "nope" as never }, true, true, true)).toThrow();
  });
});

describe("assistant limits", () => {
  it("uses defaults when settings are missing", () => {
    expect(limitsFromSettings([])).toEqual(DEFAULT_LIMITS);
  });
  it("applies settings but clamps every value to a ceiling and floor", () => {
    const l = limitsFromSettings([
      { key: "assistant_max_message_chars", value_num: 999999999 }, { key: "assistant_daily_requests_per_user", value_num: 0 },
      { key: "assistant_max_tool_output_chars", value_num: 3000 }, { key: "assistant_deep_requires_pro", value_num: 1 },
    ]);
    expect(l.maxMessageChars).toBe(8000);
    expect(l.dailyRequestsPerUser).toBe(1);
    expect(l.maxToolOutputChars).toBe(3000);
    expect(l.deepRequiresPro).toBe(true);
  });
  it("ignores junk values", () => {
    expect(limitsFromSettings([{ key: "assistant_max_documents", value_num: "abc" as never }]).maxDocuments).toBe(DEFAULT_LIMITS.maxDocuments);
  });
  it("falls back to safe defaults, never to no limit, when settings cannot be read", async () => {
    const failing = { from: () => ({ select: () => Promise.resolve({ data: null, error: { message: "x" } }) }) };
    expect(await loadAssistantLimits(failing)).toEqual(DEFAULT_LIMITS);
    const throwing = { from: () => { throw new Error("down"); } };
    expect(await loadAssistantLimits(throwing as never)).toEqual(DEFAULT_LIMITS);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state: {
  profile: { id: string; role: string | null } | null;
  version: Row | null;
  tables: Record<string, Row[]>;
  updates: { table: string; patch: Row; filters: [string, string, unknown][] }[];
  rpcs: { fn: string; args: Row }[];
  rpcError: string | null;
} = { profile: null, version: null, tables: {}, updates: [], rpcs: [], rpcError: null };

vi.mock("@/lib/supabase/profile", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Row) => { state.rpcs.push({ fn, args }); return { error: state.rpcError ? { message: state.rpcError } : null }; },
    from: (table: string) => ({
      select: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["eq", "order", "limit"]) chain[m] = () => chain;
        chain.single = async () => ({ data: state.version });
        chain.then = (res: (v: unknown) => unknown) => res({ data: state.tables[table] ?? [] });
        return chain;
      },
      update: (patch: Row) => {
        const filters: [string, string, unknown][] = [];
        const chain: Record<string, unknown> = {};
        chain.eq = (c: string, v: unknown) => { filters.push(["eq", c, v]); return chain; };
        chain.neq = (c: string, v: unknown) => { filters.push(["neq", c, v]); return chain; };
        const finish = () => { state.updates.push({ table, patch, filters }); return { data: [{ id: "m" }], error: null }; };
        chain.select = async () => finish();
        chain.then = (res: (v: unknown) => unknown) => res(finish());
        return chain;
      },
    }),
  }),
}));

import { applyToolAction } from "../actions";
import { getCalculator } from "@/lib/tools/registry";

const defaultsFor = (slug: string): Record<string, string> => Object.fromEntries(getCalculator(slug)!.fields.map((f) => [f.id, f.default]));

const questionInputs = {
  framework: "pico", population: "Children aged 6 to 59 months", exposure: "Vitamin A supplementation", comparator: "No supplementation",
  outcome: "Incidence of severe diarrhoea", outcomeType: "binary", setting: "Mulago Hospital", covariates: "Age\nSex",
};
// Action indexes in research-question-builder: 0 question, 1 population, 2 objectives, 3 variables.

beforeEach(() => {
  state.profile = { id: "u1", role: "student" };
  state.version = { id: "v1", status: "draft", research_question: null, target_population: null, inclusion_criteria: [], exclusion_criteria: [], data_collection_methods: null };
  state.tables = { protocol_objectives: [], protocol_variables: [] };
  state.updates = []; state.rpcs = []; state.rpcError = null;
});

describe("applyToolAction", () => {
  it("sets the research question when empty", async () => {
    const r = await applyToolAction("s1", "research-question-builder", questionInputs, 0);
    expect(r.error).toBeUndefined();
    expect(state.updates[0].patch.research_question).toMatch(/^Among children aged 6 to 59 months/);
  });
  it("never overwrites an existing research question", async () => {
    state.version = { ...state.version!, research_question: "My own question?" };
    const r = await applyToolAction("s1", "research-question-builder", questionInputs, 0);
    expect(r.error).toMatch(/already has a research question/);
    expect(state.updates).toHaveLength(0);
  });
  it("appends population text and is idempotent", async () => {
    state.version = { ...state.version!, target_population: "Existing text." };
    await applyToolAction("s1", "research-question-builder", questionInputs, 1);
    const text = String(state.updates[0].patch.target_population);
    expect(text.startsWith("Existing text.\n\nChildren aged 6 to 59 months")).toBe(true);
    state.version = { ...state.version!, target_population: text };
    state.updates = [];
    expect((await applyToolAction("s1", "research-question-builder", questionInputs, 1)).message).toMatch(/already/);
    expect(state.updates).toHaveLength(0);
  });
  it("adds objectives through the atomic RPC, keeping existing ones and demoting a second primary", async () => {
    state.tables.protocol_objectives = [{ objective_type: "primary", description: "Existing primary", display_order: 0 }];
    const r = await applyToolAction("s1", "research-question-builder", questionInputs, 2);
    expect(r.message).toMatch(/added as secondary/);
    const call = state.rpcs[0];
    expect(call.fn).toBe("replace_protocol_objectives");
    const rows = call.args.rows as { objective_type: string; description: string }[];
    expect(rows[0]).toEqual({ objective_type: "primary", description: "Existing primary" });
    expect(rows.filter((x) => x.objective_type === "primary")).toHaveLength(1);
    expect(rows.length).toBe(1 + 4);
  });
  it("adds variables with unique slugs, skipping names that already exist", async () => {
    state.tables.protocol_variables = [{ variable_name: "Age", variable_slug: "age", variable_type: "continuous", role: "covariate", unit: "years", value_labels: null, measurement_timepoint: null, description: null }];
    const r = await applyToolAction("s1", "research-question-builder", questionInputs, 3);
    expect(r.error).toBeUndefined();
    const rows = state.rpcs[0].args.rows as { variable_name: string; variable_slug: string }[];
    expect(state.rpcs[0].fn).toBe("replace_protocol_variables");
    expect(rows.map((x) => x.variable_name)).toEqual(["Age", "Vitamin A supplementation", "Incidence of severe diarrhoea", "Sex"]);
    expect(new Set(rows.map((x) => x.variable_slug)).size).toBe(rows.length);
  });
  it("adds criteria without duplicating those already present", async () => {
    state.version = { ...state.version!, inclusion_criteria: ["Aged 6 to 59 months"] };
    // eligibility-criteria-builder: 0 inclusion, 1 exclusion
    const r = await applyToolAction("s1", "eligibility-criteria-builder", defaultsFor("eligibility-criteria-builder"), 0);
    expect(r.error).toBeUndefined();
    const added = state.updates[0].patch.inclusion_criteria as string[];
    expect(added[0]).toBe("Aged 6 to 59 months");
    expect(added.filter((x) => x === "Aged 6 to 59 months")).toHaveLength(1);
    expect(added.length).toBe(3);
  });
  it("adds operational definitions to data collection methods", async () => {
    const r = await applyToolAction("s1", "variables-and-definitions-builder", defaultsFor("variables-and-definitions-builder"), 1);
    expect(r.error).toBeUndefined();
    expect(String(state.updates[0].patch.data_collection_methods)).toMatch(/^Operational definitions/);
  });
  it("requires a draft protocol, a student, and a valid action index", async () => {
    state.version = null;
    expect((await applyToolAction("s1", "research-question-builder", questionInputs, 0)).error).toMatch(/no draft protocol/);
    state.version = { id: "v1" };
    expect((await applyToolAction("s1", "research-question-builder", questionInputs, 99)).error).toMatch(/not available/);
    expect((await applyToolAction("s1", "research-question-builder", questionInputs, -1)).error).toMatch(/not available/);
    state.profile = { id: "u2", role: "supervisor" };
    expect((await applyToolAction("s1", "research-question-builder", questionInputs, 0)).error).toMatch(/Only students/);
    state.profile = null;
    expect((await applyToolAction("s1", "research-question-builder", questionInputs, 0)).error).toMatch(/Sign in/);
  });
  it("rejects tampered inputs because the result is recomputed on the server", async () => {
    expect((await applyToolAction("s1", "research-question-builder", { ...questionInputs, evil: "x" }, 0)).error).toBe("Unexpected input.");
    expect(state.updates).toHaveLength(0);
    expect(state.rpcs).toHaveLength(0);
  });
  it("surfaces database errors from the atomic functions", async () => {
    state.rpcError = "Only a draft protocol version can be edited";
    expect((await applyToolAction("s1", "research-question-builder", questionInputs, 3)).error).toMatch(/draft/);
  });
});

describe("applyToolAction for the instrument builders", () => {
  it("sets the study design only when empty", async () => {
    const raw = defaultsFor("study-design-assistant");
    const r = await applyToolAction("s1", "study-design-assistant", raw, 0);
    expect(r.error).toBeUndefined();
    expect(String(state.updates[0].patch.study_design)).toMatch(/study|trial|review/i);
    state.version = { ...state.version!, study_design: "Cohort" };
    state.updates = [];
    expect((await applyToolAction("s1", "study-design-assistant", raw, 0)).error).toMatch(/already has a study design/);
    expect(state.updates).toHaveLength(0);
  });
  it("sets blank study dates and milestone target dates from the timeline, skipping completed milestones through the filter", async () => {
    const r = await applyToolAction("s1", "research-timeline-builder", defaultsFor("research-timeline-builder"), 0);
    expect(r.error).toBeUndefined();
    const versionPatch = state.updates.find((u) => u.table === "protocol_versions")!;
    expect(versionPatch.patch).toEqual({ anticipated_start_date: "2027-02-01", anticipated_end_date: "2028-01-30" });
    const ms = state.updates.filter((u) => u.table === "milestones");
    expect(ms.length).toBe(5);
    for (const m of ms) {
      expect(m.filters).toContainEqual(["neq", "status", "complete"]);
      expect(m.filters).toContainEqual(["eq", "study_id", "s1"]);
    }
  });
  it("does not overwrite study dates that are already set", async () => {
    state.version = { ...state.version!, anticipated_start_date: "2027-01-01", anticipated_end_date: "2027-12-31" };
    await applyToolAction("s1", "research-timeline-builder", defaultsFor("research-timeline-builder"), 0);
    expect(state.updates.find((u) => u.table === "protocol_versions")).toBeUndefined();
  });
  it("adds questionnaire questions as variables through the atomic RPC", async () => {
    const r = await applyToolAction("s1", "questionnaire-builder", defaultsFor("questionnaire-builder"), 0);
    expect(r.error).toBeUndefined();
    expect(state.rpcs[0].fn).toBe("replace_protocol_variables");
    expect((state.rpcs[0].args.rows as { variable_name: string }[])[0].variable_name).toMatch(/^q1_/);
  });
  it("adds the consent, risks and confidentiality paragraphs to their own fields", async () => {
    const raw = defaultsFor("consent-ethics-template-builder");
    for (const [i, field] of [[0, "consent_process"], [1, "risks_and_benefits"], [2, "confidentiality_plan"]] as const) {
      state.updates = [];
      const r = await applyToolAction("s1", "consent-ethics-template-builder", raw, i);
      expect(r.error).toBeUndefined();
      expect(state.updates[0].patch).toHaveProperty(field);
    }
  });
  it("adds data dictionary variables and the SAP to statistics", async () => {
    expect((await applyToolAction("s1", "data-dictionary-builder", defaultsFor("data-dictionary-builder"), 0)).error).toBeUndefined();
    expect(state.rpcs.at(-1)!.fn).toBe("replace_protocol_variables");
    state.updates = [];
    expect((await applyToolAction("s1", "statistical-analysis-plan-generator", defaultsFor("statistical-analysis-plan-generator"), 0)).error).toBeUndefined();
    expect(String(state.updates[0].patch.statistical_methods)).toMatch(/Primary analysis/);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal chainable Supabase double that records inserts and updates.
const state: {
  profile: { id: string; role: string | null } | null;
  version: Record<string, unknown> | null;
  inserted: unknown[];
  updated: { patch: Record<string, unknown>; id: string }[];
  insertError: string | null;
} = { profile: null, version: null, inserted: [], updated: [], insertError: null };

vi.mock("@/lib/supabase/profile", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      insert: async (row: unknown) => {
        state.inserted.push({ table, row });
        return { error: state.insertError ? { message: state.insertError } : null };
      },
      select: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["eq", "order", "limit"]) chain[m] = () => chain;
        chain.single = async () => ({ data: state.version });
        return chain;
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          state.updated.push({ patch, id });
          return { error: null };
        },
      }),
    }),
  }),
}));

import { insertMethodsIntoProtocol, saveCalculationToStudy } from "../actions";

const goodInputs = { p: "0.5", d: "0.05", conf: "0.95", deff: "1", pop: "0", nonresponse: "0" };

beforeEach(() => {
  state.profile = { id: "u1", role: "student" };
  state.version = { id: "v1", status: "draft", statistical_methods: null };
  state.inserted = [];
  state.updated = [];
  state.insertError = null;
});

describe("saveCalculationToStudy", () => {
  it("stores inputs and a server-recomputed result", async () => {
    const r = await saveCalculationToStudy("s1", "sample-size-proportion", goodInputs);
    expect(r.error).toBeUndefined();
    const saved = state.inserted[0] as { table: string; row: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(saved.table).toBe("saved_calculations");
    expect(saved.row.study_id).toBe("s1");
    expect(saved.row.result.headline.value).toBe("385");
    expect(saved.row.created_by).toBe("u1");
  });
  it("requires sign-in and a student account", async () => {
    state.profile = null;
    expect((await saveCalculationToStudy("s1", "sample-size-proportion", goodInputs)).error).toMatch(/Sign in/);
    state.profile = { id: "u2", role: "supervisor" };
    expect((await saveCalculationToStudy("s1", "sample-size-proportion", goodInputs)).error).toMatch(/Only students/);
    expect(state.inserted).toHaveLength(0);
  });
  it("rejects unknown calculators, unknown fields, invalid values and oversize input", async () => {
    expect((await saveCalculationToStudy("s1", "nope", goodInputs)).error).toBe("Unknown calculator.");
    expect((await saveCalculationToStudy("s1", "sample-size-proportion", { ...goodInputs, evil: "x" })).error).toBe("Unexpected input.");
    expect((await saveCalculationToStudy("s1", "sample-size-proportion", { ...goodInputs, p: "5" })).error).toMatch(/at most/);
    expect((await saveCalculationToStudy("s1", "descriptive-statistics", { x: "1 ".repeat(15000), conf: "0.95" })).error).toMatch(/too large/);
    expect(state.inserted).toHaveLength(0);
  });
  it("surfaces database errors", async () => {
    state.insertError = "row-level security";
    expect((await saveCalculationToStudy("s1", "sample-size-proportion", goodInputs)).error).toBe("row-level security");
  });
});

describe("insertMethodsIntoProtocol", () => {
  it("writes the server-generated methods text to an empty statistics section", async () => {
    const r = await insertMethodsIntoProtocol("s1", "sample-size-proportion", goodInputs);
    expect(r.error).toBeUndefined();
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0].id).toBe("v1");
    expect(String(state.updated[0].patch.statistical_methods)).toContain("Cochran, 1977");
  });
  it("appends after existing text and never overwrites it", async () => {
    state.version = { id: "v1", status: "draft", statistical_methods: "My own analysis plan." };
    await insertMethodsIntoProtocol("s1", "sample-size-proportion", goodInputs);
    const text = String(state.updated[0].patch.statistical_methods);
    expect(text.startsWith("My own analysis plan.\n\n")).toBe(true);
  });
  it("is idempotent when the same text is already there", async () => {
    await insertMethodsIntoProtocol("s1", "sample-size-proportion", goodInputs);
    state.version = { id: "v1", status: "draft", statistical_methods: state.updated[0].patch.statistical_methods };
    state.updated = [];
    const r = await insertMethodsIntoProtocol("s1", "sample-size-proportion", goodInputs);
    expect(r.message).toMatch(/already/);
    expect(state.updated).toHaveLength(0);
  });
  it("refuses when there is no draft protocol, and for signed-out users", async () => {
    state.version = null;
    expect((await insertMethodsIntoProtocol("s1", "sample-size-proportion", goodInputs)).error).toMatch(/no draft protocol/);
    state.profile = null;
    expect((await insertMethodsIntoProtocol("s1", "sample-size-proportion", goodInputs)).error).toMatch(/Sign in/);
    expect(state.updated).toHaveLength(0);
  });
});

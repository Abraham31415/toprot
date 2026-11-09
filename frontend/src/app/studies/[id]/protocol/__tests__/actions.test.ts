import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/protocol/sample-size-engine", () => ({ runSampleSizeCalculation: vi.fn() }));

import { saveObjectives, saveVariables } from "../actions";

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
});

describe("saveObjectives", () => {
  it("calls the atomic rpc with trimmed, non-empty rows and revalidates", async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await saveObjectives("v1", "s1", [
      { objective_type: "primary", description: "  Estimate X  " },
      { objective_type: "secondary", description: "   " },
      { objective_type: "secondary", description: "Y" },
    ]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("replace_protocol_objectives", {
      version_id: "v1",
      rows: [
        { objective_type: "primary", description: "Estimate X" },
        { objective_type: "secondary", description: "Y" },
      ],
    });
    expect(r).toEqual({ savedAt: expect.any(Number) });
    expect(revalidatePath).toHaveBeenCalledWith("/studies/s1/protocol");
  });

  it("returns { error } and does not revalidate when the rpc fails", async () => {
    rpc.mockResolvedValue({ error: { message: "boom" } });
    const r = await saveObjectives("v1", "s1", [{ objective_type: "primary", description: "x" }]);
    expect(r).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sends an empty array (clear) when every row is blank", async () => {
    rpc.mockResolvedValue({ error: null });
    await saveObjectives("v1", "s1", [{ objective_type: "primary", description: " " }]);
    expect(rpc).toHaveBeenCalledWith("replace_protocol_objectives", { version_id: "v1", rows: [] });
  });
});

describe("saveVariables", () => {
  const v = (name: string, slug: string) => ({
    variable_name: name,
    variable_slug: slug,
    variable_type: "continuous" as const,
    role: "outcome" as const,
    unit: null,
    value_labels: null,
    measurement_timepoint: null,
    description: null,
  });

  it("calls the atomic rpc with trimmed names, skipping unnamed rows", async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await saveVariables("v1", "s1", [v(" Age ", "age"), v("  ", "blank"), v("BMI", "bmi")]);
    expect(rpc).toHaveBeenCalledWith("replace_protocol_variables", {
      version_id: "v1",
      rows: [v("Age", "age"), v("BMI", "bmi")],
    });
    expect(r).toEqual({ savedAt: expect.any(Number) });
    expect(revalidatePath).toHaveBeenCalledWith("/studies/s1/protocol");
  });

  it("surfaces a database error (e.g. duplicate slug) without revalidating", async () => {
    rpc.mockResolvedValue({ error: { message: "duplicate key value violates unique constraint" } });
    const r = await saveVariables("v1", "s1", [v("A", "a"), v("B", "a")]);
    expect(r).toEqual({ error: "duplicate key value violates unique constraint" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("never issues a separate delete or insert (no .from calls available)", async () => {
    rpc.mockResolvedValue({ error: null });
    await expect(saveVariables("v1", "s1", [v("A", "a")])).resolves.toBeDefined();
  });
});

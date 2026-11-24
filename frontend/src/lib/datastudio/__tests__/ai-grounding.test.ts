import { describe, expect, it } from "vitest";
import { numbersIn, resultForPrompt, untracedNumbers } from "../ai";
import { runAnalysis } from "../engine/run";
import type { Dataset } from "../types";

const d: Dataset = {
  variables: [{ name: "y", type: "numeric", measure: "scale", label: "Weight (kg)" }, { name: "g", type: "string", measure: "nominal" }],
  columns: [[60, 62, 65, 70, 71, 75, 80, 82, 66, 68, 73, 77], ["a", "a", "a", "a", "a", "a", "b", "b", "b", "b", "b", "b"]],
};

describe("AI analyst grounding", () => {
  const r = runAnalysis("ttest_ind", { outcome: "y", group: "g" }, d).result;
  const sent = resultForPrompt(r, { datasetName: "Trial", versionNo: 3, variables: d.variables });

  it("sends aggregated results and labels, never the data rows", () => {
    expect(sent).toContain("Welch");
    expect(sent).toContain("Weight (kg)");
    expect(sent).toContain("version 3");
    // The individual observations are not in the prompt (82 and 60 are raw values that are not summary statistics here).
    expect(sent).not.toMatch(/\b60, 62, 65\b/);
    expect(sent).not.toContain('"columns"');
  });

  it("extracts numbers including thousands separators and percentages", () => {
    expect(numbersIn("p = 0.034, n = 1,234 and 12.5% (95% CI -0.2 to 3)")).toEqual(["0.034", "1234", "12.5", "95", "-0.2", "3"]);
  });

  it("accepts numbers copied or rounded from the result and flags invented ones", () => {
    const diff = r.tables[1].rows[0][1] as number;
    expect(untracedNumbers(`The mean difference was ${diff.toFixed(3)} (about ${diff.toFixed(1)}); this is a 95% interval.`, sent)).toEqual([]);
    // Truncating instead of rounding gives a number that is not in the result.
    expect(untracedNumbers(`${(Math.trunc(diff * 1000) / 1000).toFixed(3)}`, sent).length).toBe(Number((Math.trunc(diff * 1000) / 1000).toFixed(3)) === Number(diff.toFixed(3)) ? 0 : 1);
    expect(untracedNumbers("The odds ratio was 7.31 (p = 0.0042).", sent)).toEqual(["7.31", "0.0042"]);
  });
});

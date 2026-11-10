import { describe, expect, it } from "vitest";
import ref from "./reference.json";
import { contrastVariance, matchedCaseControl, matchedCaseControlM, repeatedMeasures, repeatedMeasuresGeneral } from "../samplesize";

const R = ref as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error("expected ok: " + JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("matched case-control 1:M (conditional score test)", () => {
  it("matches an independent Python implementation exactly", () => {
    for (const c of R.matchedM) expect(ok(matchedCaseControlM(c.p0, c.or, 0.95, 0.8, c.m)).values.sets, JSON.stringify(c)).toBe(c.sets);
  });
  it("delivers the target power in a Monte Carlo simulation of the actual test (20,000 trials)", () => {
    // The simulated power at the computed size must sit at the 80% target within sampling error (SE about 0.003).
    for (const c of R.matchedM) {
      expect(c.power, JSON.stringify(c)).toBeGreaterThan(0.78);
      expect(c.power, JSON.stringify(c)).toBeLessThan(0.82);
    }
  });
  it("for one control per case agrees with Schlesselman's discordant-pair formula", () => {
    const g = ok(matchedCaseControlM(0.3, 2, 0.95, 0.8, 1)).values.sets;
    const s = ok(matchedCaseControl(0.3, 2, 0.95, 0.8)).values.pairs;
    // Schlesselman rounds the discordant pairs up before dividing, so it can be one or two sets larger.
    expect(s - g).toBeGreaterThanOrEqual(0);
    expect(s - g).toBeLessThanOrEqual(2);
  });
  it("needs fewer cases as controls per case increase, with diminishing returns", () => {
    const sets = [1, 2, 3, 4, 5, 8].map((m) => ok(matchedCaseControlM(0.3, 2, 0.95, 0.8, m)).values.sets);
    for (let i = 1; i < sets.length; i++) expect(sets[i]).toBeLessThan(sets[i - 1]);
    expect(sets[0] - sets[1]).toBeGreaterThan(sets[3] - sets[4]);
  });
  it("accepts protective odds ratios below 1", () => {
    expect(matchedCaseControlM(0.3, 0.5, 0.95, 0.8, 2).ok).toBe(true);
  });
  it("rejects invalid input", () => {
    expect(matchedCaseControlM(0.3, 2, 0.95, 0.8, 0).ok).toBe(false);
    expect(matchedCaseControlM(0.3, 2, 0.95, 0.8, 1.5).ok).toBe(false);
    expect(matchedCaseControlM(0.3, 2, 0.95, 0.8, 11).ok).toBe(false);
    expect(matchedCaseControlM(0.3, 1, 0.95, 0.8, 2).ok).toBe(false);
    expect(matchedCaseControlM(1, 2, 0.95, 0.8, 2).ok).toBe(false);
  });
});

describe("repeated measures: general summaries and correlation structures", () => {
  it("variance factors and sizes match an independent NumPy computation", () => {
    for (const c of R.repeated) {
      const r = ok(repeatedMeasuresGeneral(c.summary, c.structure, 5, 20, c.rho, c.m, 0.95, 0.8));
      close(r.values.factor, c.factor, 1e-12);
      expect(r.values.perGroup, JSON.stringify(c)).toBe(c.perGroup);
    }
  });
  it("closed forms: mean under compound symmetry, slope under compound symmetry, change with one follow-up", () => {
    const m = 5, rho = 0.4;
    close(ok(repeatedMeasuresGeneral("mean", "cs", 5, 20, rho, m, 0.95, 0.8)).values.factor, (1 + (m - 1) * rho) / m, 1e-12);
    const stt = Array.from({ length: m }, (_, i) => (i - (m - 1) / 2) ** 2).reduce((a, b) => a + b, 0);
    close(ok(repeatedMeasuresGeneral("slope", "cs", 5, 20, rho, m, 0.95, 0.8)).values.factor, (1 - rho) / stt, 1e-12);
    close(ok(repeatedMeasuresGeneral("change", "cs", 5, 20, rho, 2, 0.95, 0.8)).values.factor, 2 * (1 - rho), 1e-12);
  });
  it("closed form for the mean over visits under AR(1)", () => {
    const m = 4, rho = 0.6;
    let s = m;
    for (let k = 1; k < m; k++) s += 2 * (m - k) * rho ** k;
    close(contrastVariance(Array(m).fill(1 / m), "ar1", rho), s / (m * m), 1e-12);
  });
  it("reduces to the earlier mean-over-visits formula under compound symmetry", () => {
    const a = ok(repeatedMeasures(5, 20, 0.5, 4, 0.95, 0.8)).values.perGroup;
    const b = ok(repeatedMeasuresGeneral("mean", "cs", 5, 20, 0.5, 4, 0.95, 0.8)).values.perGroup;
    expect(b).toBe(a);
  });
  it("AR(1) gives a smaller variance factor than compound symmetry for the mean over visits (distant visits are less correlated)", () => {
    const meanCs = ok(repeatedMeasuresGeneral("mean", "cs", 5, 20, 0.5, 5, 0.95, 0.8)).values.factor;
    const meanAr = ok(repeatedMeasuresGeneral("mean", "ar1", 5, 20, 0.5, 5, 0.95, 0.8)).values.factor;
    expect(meanAr).toBeLessThan(meanCs);
  });
  it("inflates for dropout by dividing, not multiplying", () => {
    const base = ok(repeatedMeasuresGeneral("mean", "cs", 5, 20, 0.5, 4, 0.95, 0.8)).values.perGroup;
    const r = ok(repeatedMeasuresGeneral("mean", "cs", 5, 20, 0.5, 4, 0.95, 0.8, 0.2));
    expect(r.values.perGroup).toBe(Math.ceil(base / 0.8 - 1e-9));
    expect(r.values.completers).toBe(base);
  });
  it("rejects invalid input", () => {
    expect(repeatedMeasuresGeneral("slope", "cs", 5, 20, 0.5, 1, 0.95, 0.8).ok).toBe(false);
    expect(repeatedMeasuresGeneral("change", "cs", 5, 20, 0.5, 1, 0.95, 0.8).ok).toBe(false);
    expect(repeatedMeasuresGeneral("mean", "cs", 0, 20, 0.5, 4, 0.95, 0.8).ok).toBe(false);
    expect(repeatedMeasuresGeneral("mean", "cs", 5, 20, 1, 4, 0.95, 0.8).ok).toBe(false);
    expect(repeatedMeasuresGeneral("mean", "cs", 5, 20, 0.5, 4.5, 0.95, 0.8).ok).toBe(false);
    expect(repeatedMeasuresGeneral("mean", "cs", 5, 20, 0.5, 4, 0.95, 0.8, 1).ok).toBe(false);
  });
});

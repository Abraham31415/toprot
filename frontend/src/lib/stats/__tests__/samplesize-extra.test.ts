import { describe, expect, it } from "vitest";
import { matchedCaseControl, prePost, twoMeans } from "../samplesize";

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error("expected ok");
  return r as Extract<T, { ok: true }>;
};

describe("matched case-control (Schlesselman)", () => {
  it("matches an independent hand calculation for OR 2, control exposure 0.3", () => {
    const za = 1.959964, zb = 0.841621;
    const P = 2 / 3;
    const m = Math.ceil((za / 2 + zb * Math.sqrt(P * (1 - P))) ** 2 / (P - 0.5) ** 2 - 1e-9);
    const p1 = (2 * 0.3) / (1 - 0.3 + 2 * 0.3);
    const psi = 0.3 * (1 - p1) + p1 * (1 - 0.3);
    const r = ok(matchedCaseControl(0.3, 2, 0.95, 0.8));
    expect(r.values.discordantPairs).toBe(m);
    expect(r.values.pairs).toBe(Math.ceil(m / psi - 1e-9));
    expect(r.values.total).toBe(r.values.pairs * 2);
    expect(m).toBe(69);
  });
  it("is symmetric for protective and harmful odds ratios", () => {
    expect(ok(matchedCaseControl(0.3, 0.5, 0.95, 0.8)).values.discordantPairs).toBe(ok(matchedCaseControl(0.3, 2, 0.95, 0.8)).values.discordantPairs);
  });
  it("needs more pairs when the exposure is rare", () => {
    expect(ok(matchedCaseControl(0.05, 2, 0.95, 0.8)).values.pairs).toBeGreaterThan(ok(matchedCaseControl(0.3, 2, 0.95, 0.8)).values.pairs);
  });
  it("rejects invalid inputs", () => {
    expect(matchedCaseControl(0, 2, 0.95, 0.8).ok).toBe(false);
    expect(matchedCaseControl(0.3, 1, 0.95, 0.8).ok).toBe(false);
    expect(matchedCaseControl(0.3, 2, 1.2, 0.8).ok).toBe(false);
  });
});

describe("baseline-adjusted comparison (Vickers, Borm)", () => {
  it("follow-up only equals the two-means size", () => {
    expect(ok(prePost(5, 20, 0.5, "post", 0.95, 0.8)).values.perGroup).toBe(ok(twoMeans(5, 20, 0.95, 0.8, 1)).values.n1);
  });
  it("ANCOVA factor is 1 - rho^2 and change score is 2(1 - rho)", () => {
    expect(ok(prePost(5, 20, 0.5, "ancova", 0.95, 0.8)).values.factor).toBeCloseTo(0.75, 12);
    expect(ok(prePost(5, 20, 0.5, "change", 0.95, 0.8)).values.factor).toBeCloseTo(1, 12);
    expect(ok(prePost(5, 20, 0.3, "change", 0.95, 0.8)).values.factor).toBeCloseTo(1.4, 12);
  });
  it("ANCOVA never needs more participants than the alternatives", () => {
    for (const rho of [0, 0.2, 0.5, 0.8]) {
      const a = ok(prePost(5, 20, rho, "ancova", 0.95, 0.8)).values.perGroup;
      expect(a).toBeLessThanOrEqual(ok(prePost(5, 20, rho, "post", 0.95, 0.8)).values.perGroup);
      expect(a).toBeLessThanOrEqual(ok(prePost(5, 20, rho, "change", 0.95, 0.8)).values.perGroup);
    }
  });
  it("rejects invalid inputs", () => {
    expect(prePost(0, 20, 0.5, "ancova", 0.95, 0.8).ok).toBe(false);
    expect(prePost(5, 20, 1, "ancova", 0.95, 0.8).ok).toBe(false);
    expect(prePost(5, -1, 0.5, "ancova", 0.95, 0.8).ok).toBe(false);
  });
});

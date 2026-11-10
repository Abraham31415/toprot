import { describe, expect, it } from "vitest";
import ref from "./reference.json";
import { tukeyCdf, tukeyPpf } from "../dist";
import { tukeyHsd } from "../tests";

const R = ref as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("Tukey HSD matches SciPy", () => {
  it("studentized range distribution", () => {
    const [c1, p1, c2] = R.tukey.dist;
    close(tukeyCdf(3.5, 3, 12), c1, 1e-8);
    close(tukeyPpf(0.95, 3, 12), p1, 1e-5);
    close(tukeyCdf(4.2, 4, 30), c2, 1e-8);
  });
  it("adjusted p-values and simultaneous intervals for unequal group sizes", () => {
    const r = tukeyHsd(R.tukey.groups, 0.95);
    expect(r.pairs).toHaveLength(3);
    for (const p of r.pairs) {
      // SciPy reports statistic[i][j] = mean_i - mean_j, with its own sign convention.
      close(p.p, R.tukey.pvalue[p.i][p.j], 1e-6);
      close(Math.abs(p.diff), Math.abs(R.tukey.stat[p.i][p.j]), 1e-9);
      const lo = Math.min(Math.abs(R.tukey.lo[p.i][p.j]), Math.abs(R.tukey.hi[p.i][p.j]));
      expect(lo).toBeGreaterThanOrEqual(0);
      const width = p.ci.upper - p.ci.lower;
      close(width, R.tukey.hi[p.i][p.j] - R.tukey.lo[p.i][p.j], 1e-5);
    }
  });
  it("interval is centred on the mean difference and widens with confidence", () => {
    const a = tukeyHsd(R.tukey.groups, 0.9), b = tukeyHsd(R.tukey.groups, 0.99);
    for (let k = 0; k < a.pairs.length; k++) {
      close((a.pairs[k].ci.lower + a.pairs[k].ci.upper) / 2, a.pairs[k].diff, 1e-9);
      expect(b.pairs[k].ci.upper - b.pairs[k].ci.lower).toBeGreaterThan(a.pairs[k].ci.upper - a.pairs[k].ci.lower);
    }
  });
});

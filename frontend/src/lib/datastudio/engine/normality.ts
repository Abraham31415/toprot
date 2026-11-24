// Shapiro-Wilk W test (Royston 1995, Algorithm AS R94; the algorithm used by R's shapiro.test and SciPy's shapiro), valid for 3 <= n <= 5000.
// Also the Brown-Forsythe (median-centred Levene) test for equal variances, and normal Q-Q plot coordinates.

import { fCdf, normCdf, normPpf } from "@/lib/stats/dist";
import { AnalysisError } from "./common";

const poly = (c: number[], x: number) => { let r = c[c.length - 1]; for (let i = c.length - 2; i >= 0; i--) r = r * x + c[i]; return r; };

export function shapiroWilk(data: number[]): { w: number; p: number; n: number } {
  const x = [...data].sort((a, b) => a - b);
  const n = x.length;
  if (n < 3) throw new AnalysisError("The Shapiro-Wilk test needs at least 3 observations.");
  if (n > 5000) throw new AnalysisError("The Shapiro-Wilk test is defined for at most 5000 observations; use a Q-Q plot for larger samples.");
  const range = x[n - 1] - x[0];
  if (range === 0) throw new AnalysisError("All values are identical, so normality cannot be tested.");
  const nn2 = Math.floor(n / 2);
  const a = new Array<number>(nn2 + 1).fill(0); // 1-based
  if (n === 3) a[1] = Math.SQRT1_2;
  else {
    const m = new Array<number>(nn2 + 1).fill(0);
    let summ2 = 0;
    for (let i = 1; i <= nn2; i++) { m[i] = normPpf((i - 0.375) / (n + 0.25)); summ2 += m[i] * m[i]; }
    summ2 *= 2;
    const ssumm2 = Math.sqrt(summ2), rsn = 1 / Math.sqrt(n);
    const c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
    const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
    const a1 = poly(c1, rsn) - m[1] / ssumm2;
    let i1: number, fac: number;
    if (n > 5) {
      i1 = 3;
      const a2 = -m[2] / ssumm2 + poly(c2, rsn);
      fac = Math.sqrt((summ2 - 2 * m[1] ** 2 - 2 * m[2] ** 2) / (1 - 2 * a1 ** 2 - 2 * a2 ** 2));
      a[2] = a2;
    } else {
      i1 = 2;
      fac = Math.sqrt((summ2 - 2 * m[1] ** 2) / (1 - 2 * a1 ** 2));
    }
    a[1] = a1;
    for (let i = i1; i <= nn2; i++) a[i] = -m[i] / fac;
  }
  // W = (sum a_i (x_(n+1-i) - x_(i)))^2 / SS, computed on range-scaled data for stability.
  const xs = x.map((v) => v / range);
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const ss = xs.reduce((s, v) => s + (v - mean) ** 2, 0);
  let num = 0;
  for (let i = 1; i <= nn2; i++) num += a[i] * (xs[n - i] - xs[i - 1]);
  let w = (num * num) / ss;
  if (w > 1) w = 1;
  let p: number;
  if (n === 3) {
    p = Math.max(0, (6 / Math.PI) * (Math.asin(Math.sqrt(w)) - Math.PI / 3));
  } else {
    const w1 = 1 - w;
    let y = Math.log(w1);
    let mu: number, s: number;
    if (n <= 11) {
      const gamma = poly([-2.273, 0.459], n);
      if (y >= gamma) return { w, p: 1e-99, n };
      y = -Math.log(gamma - y);
      mu = poly([0.544, -0.39978, 0.025054, -6.714e-4], n);
      s = Math.exp(poly([1.3822, -0.77857, 0.062767, -0.0020322], n));
    } else {
      const xx = Math.log(n);
      mu = poly([-1.5861, -0.31082, -0.083751, 0.0038915], xx);
      s = Math.exp(poly([-0.4803, -0.082676, 0.0030302], xx));
    }
    p = 1 - normCdf((y - mu) / s);
  }
  return { w, p: Math.min(1, Math.max(0, p)), n };
}

/** Brown-Forsythe test: Levene's test on absolute deviations from group medians (SciPy levene(center="median"), SPSS "based on median"). */
export function brownForsythe(groups: number[][]): { f: number; df1: number; df2: number; p: number } {
  const med = (x: number[]) => { const s = [...x].sort((a, b) => a - b); const h = (s.length - 1) / 2; return (s[Math.floor(h)] + s[Math.ceil(h)]) / 2; };
  const z = groups.map((g) => { const m = med(g); return g.map((v) => Math.abs(v - m)); });
  const k = z.length, N = z.reduce((s, g) => s + g.length, 0);
  const means = z.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
  const grand = z.flat().reduce((s, v) => s + v, 0) / N;
  const ssb = z.reduce((s, g, i) => s + g.length * (means[i] - grand) ** 2, 0);
  const ssw = z.reduce((s, g, i) => s + g.reduce((t, v) => t + (v - means[i]) ** 2, 0), 0);
  const df1 = k - 1, df2 = N - k;
  const f = ssw === 0 ? (ssb === 0 ? 0 : Infinity) : (ssb / df1) / (ssw / df2);
  return { f, df1, df2, p: Number.isFinite(f) ? 1 - fCdf(f, df1, df2) : 0 };
}

/** Normal Q-Q points: theoretical quantiles (Blom positions) against standardised sorted data. */
export function qqPoints(x: number[], max = 400): [number, number][] {
  const s = [...x].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((t, v) => t + v, 0) / n;
  const sd = Math.sqrt(s.reduce((t, v) => t + (v - mean) ** 2, 0) / (n - 1)) || 1;
  const step = Math.max(1, Math.floor(n / max));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i += step) out.push([normPpf((i + 1 - 0.375) / (n + 0.25)), (s[i] - mean) / sd]);
  return out;
}

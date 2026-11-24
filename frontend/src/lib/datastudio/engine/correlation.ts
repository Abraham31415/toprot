// Kendall's tau-b and partial correlation (Pearson and Spearman live in lib/stats/tests.ts and are reused).

import { normCdf, tCdf } from "@/lib/stats/dist";
import { pearson } from "@/lib/stats/tests";
import { AnalysisError } from "./common";
import { ols } from "./regression";

/** Kendall's tau-b with the tie-corrected asymptotic variance (SciPy kendalltau, method="asymptotic"). O(n^2): limited to 5000 pairs. */
export function kendallTauB(x: number[], y: number[]) {
  const n = x.length;
  if (n > 5000) throw new AnalysisError("Kendall's tau is limited to 5000 observations here; use Spearman's rho for larger samples.");
  if (n < 3) throw new AnalysisError("Kendall's tau needs at least 3 pairs.");
  let S = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const a = Math.sign(x[i] - x[j]) * Math.sign(y[i] - y[j]); S += a; }
  const tiesOf = (v: number[]) => { const m = new Map<number, number>(); for (const t of v) m.set(t, (m.get(t) ?? 0) + 1); return [...m.values()].filter((t) => t > 1); };
  const tx = tiesOf(x), ty = tiesOf(y);
  const n0 = (n * (n - 1)) / 2;
  const n1 = tx.reduce((s, t) => s + (t * (t - 1)) / 2, 0), n2 = ty.reduce((s, t) => s + (t * (t - 1)) / 2, 0);
  const denom = Math.sqrt((n0 - n1) * (n0 - n2));
  if (denom === 0) throw new AnalysisError("A variable is constant, so Kendall's tau is undefined.");
  const tau = S / denom;
  const v0 = n * (n - 1) * (2 * n + 5);
  const vt = tx.reduce((s, t) => s + t * (t - 1) * (2 * t + 5), 0), vu = ty.reduce((s, t) => s + t * (t - 1) * (2 * t + 5), 0);
  const v1 = tx.reduce((s, t) => s + t * (t - 1), 0) * ty.reduce((s, t) => s + t * (t - 1), 0);
  const v2 = tx.reduce((s, t) => s + t * (t - 1) * (t - 2), 0) * ty.reduce((s, t) => s + t * (t - 1) * (t - 2), 0);
  const variance = (v0 - vt - vu) / 18 + v1 / (2 * n * (n - 1)) + v2 / (9 * n * (n - 1) * (n - 2));
  const z = S / Math.sqrt(variance);
  return { tau, z, p: Math.min(1, 2 * (1 - normCdf(Math.abs(z)))), n };
}

/** Partial correlation of x and y controlling for the columns of Z (Pearson on OLS residuals), t-test with n - 2 - k df. */
export function partialCorrelation(x: number[], y: number[], Z: number[][]) {
  const n = x.length, k = Z[0]?.length ?? 0;
  if (n - 2 - k < 1) throw new AnalysisError("Too few observations for this many control variables.");
  const D = Z.map((r) => [1, ...r]);
  const rx = ols(D, x).resid, ry = ols(D, y).resid;
  const r = pearson(rx, ry).r;
  const df = n - 2 - k;
  const t = r * Math.sqrt(df / (1 - r * r));
  return { r, t, df, p: Math.abs(r) >= 1 ? 0 : Math.min(1, 2 * tCdf(-Math.abs(t), df)), n };
}

// Direct and indirect standardisation of rates across strata (usually age groups).
// Direct: the standardized rate is a weighted average of stratum rates using a standard population, with the Fay-Feuer gamma
// interval (Fay & Feuer 1997, as R epitools::ageadjust.direct). Indirect: the standardized mortality (morbidity) ratio SMR = O / E,
// with E from standard stratum rates, and the exact Poisson interval and test.

import { chi2Cdf, chi2Ppf, chi2Sf, normPpf } from "@/lib/stats/dist";
import { AnalysisError } from "./common";

export type Stratum = { events: number; pop: number };

/** Gamma quantile via the chi-square: qgamma(p, shape k, scale s) = s * qchisq(p, 2k) / 2. */
const qgamma = (p: number, shape: number, scale: number) => (scale * chi2Ppf(p, 2 * shape)) / 2;

export function directStandardize(strata: Stratum[], stdPop: number[], conf = 0.95) {
  if (strata.length !== stdPop.length || !strata.length) throw new AnalysisError("Each stratum needs a standard population size.");
  if (stdPop.some((w) => !(w >= 0)) || !stdPop.some((w) => w > 0)) throw new AnalysisError("Standard population sizes must be zero or more, and at least one must be positive.");
  strata.forEach((s, i) => { if (stdPop[i] > 0 && !(s.pop > 0)) throw new AnalysisError(`Stratum ${i + 1} has a standard population but no person-time in the study data, so its rate is undefined.`); });
  const W = stdPop.reduce((a, b) => a + b, 0);
  const wt = stdPop.map((w) => w / W);
  const rate = strata.map((s) => (s.pop > 0 ? s.events / s.pop : 0));
  const dsr = wt.reduce((a, w, i) => a + w * rate[i], 0);
  const v = wt.reduce((a, w, i) => a + (strata[i].pop > 0 ? (w * w * strata[i].events) / strata[i].pop ** 2 : 0), 0);
  const wm = Math.max(...wt.map((w, i) => (strata[i].pop > 0 ? w / strata[i].pop : 0)));
  const a = 1 - conf;
  const lo = dsr > 0 && v > 0 ? qgamma(a / 2, (dsr * dsr) / v, v / dsr) : 0;
  const hi = qgamma(1 - a / 2, (dsr + wm) ** 2 / (v + wm * wm), (v + wm * wm) / (dsr + wm));
  const E = strata.reduce((s, x) => s + x.events, 0), N = strata.reduce((s, x) => s + x.pop, 0);
  // Normal-approximation interval, reported for comparison with software that uses it.
  const z = normPpf(1 - a / 2);
  return { rate: dsr, variance: v, lo, hi, normalLo: dsr - z * Math.sqrt(v), normalHi: dsr + z * Math.sqrt(v), crude: E / N, events: E, pop: N, stratumRates: rate, weights: wt };
}

/** Indirect standardisation: observed events against those expected from standard stratum rates. */
export function indirectStandardize(strata: Stratum[], stdRate: number[], conf = 0.95) {
  if (strata.length !== stdRate.length || !strata.length) throw new AnalysisError("Each stratum needs a standard rate.");
  if (stdRate.some((r) => !(r >= 0))) throw new AnalysisError("Standard rates must be zero or more.");
  const O = strata.reduce((s, x) => s + x.events, 0);
  const E = strata.reduce((s, x, i) => s + x.pop * stdRate[i], 0);
  if (!(E > 0)) throw new AnalysisError("The expected number of events is zero, so the SMR is undefined.");
  const a = 1 - conf;
  const smr = O / E;
  const lo = O > 0 ? chi2Ppf(a / 2, 2 * O) / (2 * E) : 0;
  const hi = chi2Ppf(1 - a / 2, 2 * O + 2) / (2 * E);
  // Exact Poisson test of SMR = 1: P(X <= O) = P(chi2(2O + 2) > 2E), P(X >= O) = P(chi2(2O) <= 2E).
  const pLe = chi2Sf(2 * E, 2 * O + 2), pGe = O > 0 ? chi2Cdf(2 * E, 2 * O) : 1;
  return { observed: O, expected: E, smr, lo, hi, p: Math.min(1, 2 * Math.min(pLe, pGe)), integerEvents: Number.isInteger(O) };
}

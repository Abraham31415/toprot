import { normCdf, normPpf } from "./dist";

export type SizeResult =
  | { ok: true; steps: string[]; values: Record<string, number>; headline: { label: string; value: number } }
  | { ok: false; error: string };

const fmt = (x: number, d = 4) => (Number.isInteger(x) ? String(x) : x.toFixed(d).replace(/0+$/, "").replace(/\.$/, ""));
export const ceil = (x: number) => Math.ceil(x - 1e-9);
const zA = (conf: number) => normPpf(1 - (1 - conf) / 2);
const zB = (power: number) => normPpf(power);
const inUnit = (x: number) => x > 0 && x < 1;

export type Adjustments = { designEffect?: number; population?: number; nonresponse?: number };

/** Apply design effect, finite population correction and nonresponse in that order, with steps. */
export function applyAdjustments(n0: number, adj: Adjustments, steps: string[]): number {
  let n = n0;
  if (adj.designEffect && adj.designEffect !== 1) {
    n *= adj.designEffect;
    steps.push(`Design effect ${fmt(adj.designEffect)}: n = ${fmt(n0)} x ${fmt(adj.designEffect)} = ${fmt(n)}`);
  }
  if (adj.population) {
    const before = n;
    n = before / (1 + (before - 1) / adj.population);
    steps.push(`Finite population correction (N = ${adj.population}): n = ${fmt(before)} / (1 + (${fmt(before)} - 1) / ${adj.population}) = ${fmt(n)}`);
  }
  if (adj.nonresponse) {
    const before = n;
    n = before / (1 - adj.nonresponse);
    steps.push(`Nonresponse ${fmt(adj.nonresponse * 100)}%: n = ${fmt(before)} / (1 - ${fmt(adj.nonresponse)}) = ${fmt(n)}`);
  }
  return n;
}

const validAdj = (a: Adjustments): string | null => {
  if (a.designEffect !== undefined && !(a.designEffect >= 1)) return "Design effect must be 1 or more.";
  if (a.population !== undefined && !(a.population > 1)) return "Population size must be greater than 1.";
  if (a.nonresponse !== undefined && !(a.nonresponse >= 0 && a.nonresponse < 1)) return "Nonresponse must be at least 0 and below 1.";
  return null;
};

export function singleProportion(p: number, d: number, conf: number, adj: Adjustments = {}): SizeResult {
  if (!inUnit(p)) return { ok: false, error: "Expected proportion must be between 0 and 1 (exclusive)." };
  if (!(d > 0 && d < 1)) return { ok: false, error: "Margin of error must be between 0 and 1." };
  if (!(conf > 0 && conf < 1)) return { ok: false, error: "Confidence level must be between 0 and 1." };
  const e = validAdj(adj); if (e) return { ok: false, error: e };
  const z = zA(conf), steps: string[] = [];
  const n0 = (z * z * p * (1 - p)) / (d * d);
  steps.push(`z = ${fmt(z)} for ${fmt(conf * 100)}% confidence`);
  steps.push(`n0 = z^2 x p(1 - p) / d^2 = ${fmt(z * z)} x ${fmt(p)} x ${fmt(1 - p)} / ${fmt(d * d)} = ${fmt(n0)}`);
  const n = applyAdjustments(n0, adj, steps);
  steps.push(`Round up: ${ceil(n)}`);
  return { ok: true, steps, values: { n0, n: ceil(n) }, headline: { label: "Required sample size", value: ceil(n) } };
}

export function singleMean(sdv: number, d: number, conf: number, adj: Adjustments = {}): SizeResult {
  if (!(sdv > 0)) return { ok: false, error: "Standard deviation must be greater than 0." };
  if (!(d > 0)) return { ok: false, error: "Margin of error must be greater than 0." };
  if (!(conf > 0 && conf < 1)) return { ok: false, error: "Confidence level must be between 0 and 1." };
  const e = validAdj(adj); if (e) return { ok: false, error: e };
  const z = zA(conf), steps: string[] = [];
  const n0 = ((z * sdv) / d) ** 2;
  steps.push(`z = ${fmt(z)}`, `n0 = (z x SD / d)^2 = (${fmt(z)} x ${fmt(sdv)} / ${fmt(d)})^2 = ${fmt(n0)}`);
  const n = applyAdjustments(n0, adj, steps);
  steps.push(`Round up: ${ceil(n)}`);
  return { ok: true, steps, values: { n0, n: ceil(n) }, headline: { label: "Required sample size", value: ceil(n) } };
}

/** Fleiss (1981) two-proportion formula without continuity correction; ratio k = n2/n1. */
export function twoProportionsN(p1: number, p2: number, conf: number, power: number, k = 1) {
  const za = zA(conf), zb = zB(power);
  const pbar = (p1 + k * p2) / (1 + k);
  const n1 = (za * Math.sqrt((1 + 1 / k) * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + (p2 * (1 - p2)) / k)) ** 2 / (p1 - p2) ** 2;
  return { n1, n2: n1 * k, pbar, za, zb };
}

export function twoProportions(p1: number, p2: number, conf: number, power: number, ratio: number, label = "two proportions"): SizeResult {
  if (!inUnit(p1) || !inUnit(p2)) return { ok: false, error: "Both proportions must be between 0 and 1 (exclusive)." };
  if (p1 === p2) return { ok: false, error: "The two proportions must differ." };
  if (!(conf > 0 && conf < 1) || !(power > 0 && power < 1)) return { ok: false, error: "Confidence and power must be between 0 and 1." };
  if (!(ratio > 0)) return { ok: false, error: "Allocation ratio must be greater than 0." };
  const r = twoProportionsN(p1, p2, conf, power, ratio);
  const n1 = ceil(r.n1), n2 = ceil(r.n1 * ratio);
  const steps = [
    `Comparing ${label}: p1 = ${fmt(p1)}, p2 = ${fmt(p2)}, allocation ratio n2/n1 = ${fmt(ratio)}`,
    `z(alpha/2) = ${fmt(r.za)}, z(beta) = ${fmt(r.zb)}, pooled proportion = ${fmt(r.pbar)}`,
    `n1 = [z(a/2) sqrt((1 + 1/k) pbar(1 - pbar)) + z(b) sqrt(p1 q1 + p2 q2 / k)]^2 / (p1 - p2)^2 = ${fmt(r.n1)}`,
    `n2 = k x n1, rounded up: group 1 = ${n1}, group 2 = ${n2}`,
  ];
  return { ok: true, steps, values: { n1, n2, total: n1 + n2 }, headline: { label: "Total sample size", value: n1 + n2 } };
}

export function twoMeans(delta: number, sdv: number, conf: number, power: number, ratio: number): SizeResult {
  if (!(delta !== 0 && Number.isFinite(delta))) return { ok: false, error: "The difference to detect must be non-zero." };
  if (!(sdv > 0)) return { ok: false, error: "Standard deviation must be greater than 0." };
  if (!(conf > 0 && conf < 1) || !(power > 0 && power < 1)) return { ok: false, error: "Confidence and power must be between 0 and 1." };
  if (!(ratio > 0)) return { ok: false, error: "Allocation ratio must be greater than 0." };
  const za = zA(conf), zb = zB(power);
  const n1f = ((1 + 1 / ratio) * (za + zb) ** 2 * sdv ** 2) / delta ** 2;
  const n1 = ceil(n1f), n2 = ceil(n1f * ratio);
  const steps = [
    `z(alpha/2) = ${fmt(za)}, z(beta) = ${fmt(zb)}`,
    `n1 = (1 + 1/k)(z(a/2) + z(b))^2 SD^2 / delta^2 = ${fmt(n1f)}`,
    `Rounded up: group 1 = ${n1}, group 2 = ${n2}`,
  ];
  return { ok: true, steps, values: { n1, n2, total: n1 + n2 }, headline: { label: "Total sample size", value: n1 + n2 } };
}

export function pairedMeans(delta: number, sdDiff: number, conf: number, power: number): SizeResult {
  if (!(delta !== 0)) return { ok: false, error: "The mean difference to detect must be non-zero." };
  if (!(sdDiff > 0)) return { ok: false, error: "SD of the paired differences must be greater than 0." };
  const za = zA(conf), zb = zB(power);
  const nf = (((za + zb) * sdDiff) / delta) ** 2;
  return {
    ok: true,
    steps: [`n = ((z(a/2) + z(b)) x SD_diff / delta)^2 = ((${fmt(za)} + ${fmt(zb)}) x ${fmt(sdDiff)} / ${fmt(delta)})^2 = ${fmt(nf)}`, `Round up: ${ceil(nf)} pairs`],
    values: { n: ceil(nf) },
    headline: { label: "Pairs required", value: ceil(nf) },
  };
}

/** Unmatched case-control (Fleiss) from exposure prevalence among controls and the odds ratio to detect. */
export function caseControl(p0: number, oddsRatio: number, conf: number, power: number, controlsPerCase: number): SizeResult {
  if (!inUnit(p0)) return { ok: false, error: "Exposure prevalence among controls must be between 0 and 1 (exclusive)." };
  if (!(oddsRatio > 0) || oddsRatio === 1) return { ok: false, error: "Odds ratio must be positive and not equal to 1." };
  if (!(controlsPerCase > 0)) return { ok: false, error: "Controls per case must be greater than 0." };
  const p1 = (oddsRatio * p0) / (1 - p0 + oddsRatio * p0);
  const r = twoProportionsN(p1, p0, conf, power, controlsPerCase);
  const cases = ceil(r.n1), controls = ceil(r.n1 * controlsPerCase);
  const steps = [
    `Exposure among cases implied by the odds ratio: p1 = OR x p0 / (1 - p0 + OR x p0) = ${fmt(p1)}`,
    `z(alpha/2) = ${fmt(r.za)}, z(beta) = ${fmt(r.zb)}, pooled exposure = ${fmt(r.pbar)}`,
    `Cases n1 = [z(a/2) sqrt((1 + 1/k) pbar qbar) + z(b) sqrt(p1 q1 + p0 q0 / k)]^2 / (p1 - p0)^2 = ${fmt(r.n1)}`,
    `Cases = ${cases}, controls = ${controls} (${fmt(controlsPerCase)} per case)`,
  ];
  return { ok: true, steps, values: { cases, controls, total: cases + controls, p1 }, headline: { label: "Total (cases + controls)", value: cases + controls } };
}

export function cohort(p0: number, rr: number, conf: number, power: number, unexposedPerExposed: number): SizeResult {
  if (!inUnit(p0)) return { ok: false, error: "Risk in the unexposed must be between 0 and 1 (exclusive)." };
  if (!(rr > 0) || rr === 1) return { ok: false, error: "Relative risk must be positive and not equal to 1." };
  const p1 = rr * p0;
  if (!(p1 < 1)) return { ok: false, error: `Risk in the exposed would be ${fmt(p1)}. It must be below 1; lower the relative risk or the baseline risk.` };
  const res = twoProportions(p1, p0, conf, power, unexposedPerExposed, "exposed and unexposed cohorts");
  if (!res.ok) return res;
  res.steps.unshift(`Risk in the exposed: p1 = RR x p0 = ${fmt(rr)} x ${fmt(p0)} = ${fmt(p1)}`);
  return { ...res, values: { exposed: res.values.n1, unexposed: res.values.n2, total: res.values.total }, headline: { label: "Total (exposed + unexposed)", value: res.values.total } };
}

/** Buderer (1996): sample size to estimate sensitivity and specificity with a given absolute precision. */
export function diagnosticAccuracy(sens: number, spec: number, d: number, prevalence: number, conf: number, nonresponse = 0): SizeResult {
  if (!inUnit(sens) || !inUnit(spec)) return { ok: false, error: "Sensitivity and specificity must be between 0 and 1 (exclusive)." };
  if (!inUnit(prevalence)) return { ok: false, error: "Disease prevalence must be between 0 and 1 (exclusive)." };
  if (!(d > 0 && d < 1)) return { ok: false, error: "Precision must be between 0 and 1." };
  const e = validAdj({ nonresponse }); if (e) return { ok: false, error: e };
  const z = zA(conf), steps: string[] = [];
  const nSensCases = (z * z * sens * (1 - sens)) / (d * d);
  const nSpecNon = (z * z * spec * (1 - spec)) / (d * d);
  const nSens = nSensCases / prevalence, nSpec = nSpecNon / (1 - prevalence);
  steps.push(`Cases needed for sensitivity: z^2 Se(1 - Se) / d^2 = ${fmt(nSensCases)}`);
  steps.push(`Non-cases needed for specificity: z^2 Sp(1 - Sp) / d^2 = ${fmt(nSpecNon)}`);
  steps.push(`Total for sensitivity = ${fmt(nSensCases)} / prevalence ${fmt(prevalence)} = ${fmt(nSens)}`);
  steps.push(`Total for specificity = ${fmt(nSpecNon)} / (1 - prevalence) = ${fmt(nSpec)}`);
  const total = applyAdjustments(Math.max(nSens, nSpec), { nonresponse: nonresponse || undefined }, steps);
  steps.push(`The larger requirement governs. Round up: ${ceil(total)}`);
  return { ok: true, steps, values: { forSensitivity: ceil(nSens), forSpecificity: ceil(nSpec), n: ceil(total) }, headline: { label: "Total participants", value: ceil(total) } };
}

export const designEffectCluster = (m: number, icc: number) => 1 + (m - 1) * icc;

/** Cluster randomised trial: individually randomised size inflated by the design effect. */
export function clusterTrial(outcome: "mean" | "proportion", a: number, b: number, conf: number, power: number, m: number, icc: number): SizeResult {
  if (!(m >= 1)) return { ok: false, error: "Cluster size must be at least 1." };
  if (!(icc >= 0 && icc <= 1)) return { ok: false, error: "ICC must be between 0 and 1." };
  const base = outcome === "mean" ? twoMeans(a, b, conf, power, 1) : twoProportions(a, b, conf, power, 1);
  if (!base.ok) return base;
  const deff = designEffectCluster(m, icc), steps = [...base.steps];
  steps.push(`Design effect = 1 + (m - 1) x ICC = 1 + (${fmt(m)} - 1) x ${fmt(icc)} = ${fmt(deff)}`);
  const perArm = ceil(base.values.n1 * deff);
  const clustersPerArm = ceil(perArm / m);
  steps.push(`Participants per arm = ${base.values.n1} x ${fmt(deff)} = ${fmt(base.values.n1 * deff)}, rounded up to ${perArm}`);
  steps.push(`Clusters per arm = ${perArm} / ${fmt(m)} rounded up = ${clustersPerArm}`);
  return {
    ok: true,
    steps,
    values: { designEffect: deff, perArm, clustersPerArm, totalClusters: clustersPerArm * 2, totalParticipants: clustersPerArm * 2 * m },
    headline: { label: "Clusters per arm", value: clustersPerArm },
  };
}

/** Compare the average of m repeated measures between two groups, compound symmetry (Diggle et al.; Frison and Pocock). */
export function repeatedMeasures(delta: number, sdv: number, rho: number, m: number, conf: number, power: number): SizeResult {
  if (!(delta !== 0)) return { ok: false, error: "The difference to detect must be non-zero." };
  if (!(sdv > 0)) return { ok: false, error: "Standard deviation must be greater than 0." };
  if (!(rho >= 0 && rho < 1)) return { ok: false, error: "Within-person correlation must be at least 0 and below 1." };
  if (!(m >= 1 && Number.isInteger(m))) return { ok: false, error: "Number of measurements must be a whole number of at least 1." };
  const za = zA(conf), zb = zB(power);
  const factor = (1 + (m - 1) * rho) / m;
  const n1f = (2 * (za + zb) ** 2 * sdv ** 2 * factor) / delta ** 2;
  const n1 = ceil(n1f);
  return {
    ok: true,
    steps: [
      `Variance factor for the mean of ${m} repeated measures = (1 + (m - 1) rho) / m = ${fmt(factor)}`,
      `n per group = 2 (z(a/2) + z(b))^2 SD^2 x factor / delta^2 = ${fmt(n1f)}`,
      `Round up: ${n1} per group, ${2 * n1} in total`,
    ],
    values: { perGroup: n1, total: 2 * n1 },
    headline: { label: "Participants per group", value: n1 },
  };
}

/** Schoenfeld (1983) number of events for a log-rank comparison. */
export function survivalEvents(hr: number, conf: number, power: number, ratio: number, overallEventProb?: number): SizeResult {
  if (!(hr > 0) || hr === 1) return { ok: false, error: "Hazard ratio must be positive and not equal to 1." };
  if (!(ratio > 0)) return { ok: false, error: "Allocation ratio must be greater than 0." };
  if (overallEventProb !== undefined && !(overallEventProb > 0 && overallEventProb <= 1)) return { ok: false, error: "Probability of an event must be between 0 and 1." };
  const za = zA(conf), zb = zB(power);
  const events = ((1 + ratio) ** 2 * (za + zb) ** 2) / (ratio * Math.log(hr) ** 2);
  const steps = [`z(alpha/2) = ${fmt(za)}, z(beta) = ${fmt(zb)}`, `Events d = (1 + k)^2 (z(a/2) + z(b))^2 / (k x [ln HR]^2) = ${fmt(events)}`, `Round up: ${ceil(events)} events`];
  const values: Record<string, number> = { events: ceil(events) };
  if (overallEventProb) {
    const total = ceil(ceil(events) / overallEventProb);
    steps.push(`Total participants = events / P(event) = ${ceil(events)} / ${fmt(overallEventProb)} = ${fmt(ceil(events) / overallEventProb)}, round up: ${total}`);
    values.total = total;
  }
  return { ok: true, steps, values, headline: { label: "Events required", value: ceil(events) } };
}

export function powerTwoMeans(n1: number, delta: number, sdv: number, conf: number, ratio: number): SizeResult {
  if (!(n1 >= 2)) return { ok: false, error: "Group size must be at least 2." };
  if (!(sdv > 0)) return { ok: false, error: "Standard deviation must be greater than 0." };
  const za = zA(conf);
  const z = Math.abs(delta) / (sdv * Math.sqrt(1 / n1 + 1 / (n1 * ratio))) - za;
  const power = normCdf(z);
  return {
    ok: true,
    steps: [`z(alpha/2) = ${fmt(za)}`, `z(power) = |delta| / (SD sqrt(1/n1 + 1/n2)) - z(a/2) = ${fmt(z)}`, `Power = Phi(${fmt(z)}) = ${fmt(power)}`],
    values: { power },
    headline: { label: "Statistical power", value: power },
  };
}

export function powerTwoProportions(n1: number, p1: number, p2: number, conf: number, ratio: number): SizeResult {
  if (!(n1 >= 2)) return { ok: false, error: "Group size must be at least 2." };
  if (!inUnit(p1) || !inUnit(p2) || p1 === p2) return { ok: false, error: "Proportions must be different values between 0 and 1 (exclusive)." };
  const za = zA(conf), pbar = (p1 + ratio * p2) / (1 + ratio);
  const z = (Math.abs(p1 - p2) * Math.sqrt(n1) - za * Math.sqrt((1 + 1 / ratio) * pbar * (1 - pbar))) / Math.sqrt(p1 * (1 - p1) + (p2 * (1 - p2)) / ratio);
  const power = normCdf(z);
  return {
    ok: true,
    steps: [
      `z(alpha/2) = ${fmt(za)}, pooled proportion = ${fmt(pbar)}`,
      `z(power) = (|p1 - p2| sqrt(n1) - z(a/2) sqrt((1 + 1/k) pbar qbar)) / sqrt(p1 q1 + p2 q2 / k) = ${fmt(z)}`,
      `Power = Phi(${fmt(z)}) = ${fmt(power)}`,
    ],
    values: { power },
    headline: { label: "Statistical power", value: power },
  };
}

/** Kish (1965) design effect due to unequal weights: 1 + CV^2 = n sum(w^2) / (sum w)^2. */
export function kishDesignEffect(weights: number[]) {
  const n = weights.length, s = weights.reduce((a, b) => a + b, 0), s2 = weights.reduce((a, b) => a + b * b, 0);
  const deff = (n * s2) / (s * s);
  return { n, deff, effectiveN: n / deff };
}

export const finitePopulation = (n0: number, N: number) => n0 / (1 + (n0 - 1) / N);
export const nonresponseAdjust = (n: number, r: number) => n / (1 - r);

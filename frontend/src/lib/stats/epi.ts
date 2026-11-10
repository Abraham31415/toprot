import { chi2Ppf, zCrit } from "./dist";

export type Interval = { lower: number; upper: number };
export type Table2x2 = { a: number; b: number; c: number; d: number };

const isCount = (x: number) => Number.isFinite(x) && x >= 0 && Number.isInteger(x);

export function validateTable({ a, b, c, d }: Table2x2): string | null {
  if (![a, b, c, d].every(isCount)) return "All four cells must be whole numbers of zero or more.";
  if (a + b === 0 || c + d === 0) return "Each row needs at least one observation.";
  return null;
}

/** Wilson score interval for a proportion x/n. */
export function wilson(x: number, n: number, conf = 0.95): Interval {
  const z = zCrit(conf);
  const p = x / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

const logCi = (est: number, se: number, z: number): Interval => ({
  lower: Math.exp(Math.log(est) - z * se),
  upper: Math.exp(Math.log(est) + z * se),
});

export type Exposure2x2Result = {
  corrected: boolean;
  riskExposed: number;
  riskUnexposed: number;
  rr: number;
  rrCi: Interval;
  or: number;
  orCi: Interval;
  rd: number;
  rdCi: Interval;
  /** (p1 - p0) / p1, the attributable fraction among the exposed. */
  afe: number;
  /** Levin's population attributable fraction using the exposure prevalence in the whole sample. */
  paf: number;
  nnt: number | null;
  nntNote: string;
};

/**
 * Exposure-outcome table. Rows: exposed (a = outcome, b = no outcome), unexposed (c, d).
 * A Haldane-Anscombe 0.5 correction is applied to every cell when any cell is zero.
 */
export function analyzeExposure(t: Table2x2, conf = 0.95): Exposure2x2Result {
  const z = zCrit(conf);
  const corrected = t.a === 0 || t.b === 0 || t.c === 0 || t.d === 0;
  const k = corrected ? 0.5 : 0;
  const a = t.a + k, b = t.b + k, c = t.c + k, d = t.d + k;
  const n1 = a + b, n0 = c + d;
  const p1 = a / n1, p0 = c / n0;
  const rr = p1 / p0;
  const rrCi = logCi(rr, Math.sqrt(1 / a - 1 / n1 + 1 / c - 1 / n0), z);
  const or = (a * d) / (b * c);
  const orCi = logCi(or, Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d), z);
  const rd = p1 - p0;
  const rdSe = Math.sqrt((p1 * (1 - p1)) / n1 + (p0 * (1 - p0)) / n0);
  const rdCi = { lower: rd - z * rdSe, upper: rd + z * rdSe };
  const pe = n1 / (n1 + n0);
  const paf = (pe * (rr - 1)) / (1 + pe * (rr - 1));
  let nnt: number | null = null;
  let nntNote = "";
  if (rd === 0) nntNote = "Risk difference is zero, so NNT/NNH is not defined.";
  else {
    nnt = 1 / Math.abs(rd);
    nntNote = rd < 0 ? "Number needed to treat (exposure lowers risk)." : "Number needed to harm (exposure raises risk).";
    if (rdCi.lower < 0 && rdCi.upper > 0) nntNote += " The risk difference interval includes 0, so the NNT/NNH interval is not finite.";
  }
  return { corrected, riskExposed: p1, riskUnexposed: p0, rr, rrCi, or, orCi, rd, rdCi, afe: (p1 - p0) / p1, paf, nnt, nntNote };
}

export type DiagnosticResult = {
  corrected: boolean;
  sensitivity: number; sensitivityCi: Interval;
  specificity: number; specificityCi: Interval;
  ppv: number; ppvCi: Interval;
  npv: number; npvCi: Interval;
  accuracy: number; accuracyCi: Interval;
  lrPositive: number; lrPositiveCi: Interval;
  lrNegative: number; lrNegativeCi: Interval;
  dor: number; dorCi: Interval;
  prevalence: number; prevalenceCi: Interval;
};

/** Test table: a = TP, b = FP, c = FN, d = TN. */
export function analyzeDiagnostic(t: Table2x2, conf = 0.95): DiagnosticResult {
  const z = zCrit(conf);
  const { a: tp, b: fp, c: fn, d: tn } = t;
  const corrected = [tp, fp, fn, tn].some((x) => x === 0);
  const k = corrected ? 0.5 : 0;
  const sens = tp / (tp + fn), spec = tn / (tn + fp);
  const lrp = (tp + k) / (tp + fn + 2 * k) / (1 - (tn + k) / (tn + fp + 2 * k));
  const lrn = (1 - (tp + k) / (tp + fn + 2 * k)) / ((tn + k) / (tn + fp + 2 * k));
  const A = tp + k, B = fp + k, C = fn + k, D = tn + k;
  const lrpSe = Math.sqrt(1 / A - 1 / (A + C) + 1 / B - 1 / (B + D));
  const lrnSe = Math.sqrt(1 / C - 1 / (A + C) + 1 / D - 1 / (B + D));
  const dor = (A * D) / (B * C);
  const dorSe = Math.sqrt(1 / A + 1 / B + 1 / C + 1 / D);
  const n = tp + fp + fn + tn;
  return {
    corrected,
    sensitivity: sens, sensitivityCi: wilson(tp, tp + fn, conf),
    specificity: spec, specificityCi: wilson(tn, tn + fp, conf),
    ppv: tp / (tp + fp), ppvCi: wilson(tp, tp + fp, conf),
    npv: tn / (tn + fn), npvCi: wilson(tn, tn + fn, conf),
    accuracy: (tp + tn) / n, accuracyCi: wilson(tp + tn, n, conf),
    lrPositive: lrp, lrPositiveCi: logCi(lrp, lrpSe, z),
    lrNegative: lrn, lrNegativeCi: logCi(lrn, lrnSe, z),
    dor, dorCi: logCi(dor, dorSe, z),
    prevalence: (tp + fn) / n, prevalenceCi: wilson(tp + fn, n, conf),
  };
}

/** Exact (Garwood) Poisson interval for a rate of `events` per `personTime`. */
export function incidenceRate(events: number, personTime: number, conf = 0.95) {
  const alpha = 1 - conf;
  const lower = events === 0 ? 0 : chi2Ppf(alpha / 2, 2 * events) / 2;
  const upper = chi2Ppf(1 - alpha / 2, 2 * events + 2) / 2;
  return { rate: events / personTime, ci: { lower: lower / personTime, upper: upper / personTime } };
}

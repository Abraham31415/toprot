import { describe, expect, it } from "vitest";
import ref from "./reference.json";
import { betaPpf, chi2Ppf, chi2Sf, fCdf, normPpf, tCdf, tPpf } from "../dist";
import { analyzeDiagnostic, analyzeExposure, incidenceRate, wilson } from "../epi";
import {
  chiSquare, clopperPearson, describe as describeData, fisherExact, linearRegression, logisticRegression,
  oneSampleT, oneWayAnova, pairedT, pearson, quantile, sd, spearman, twoSampleT,
} from "../tests";
import {
  caseControl, clusterTrial, cohort, diagnosticAccuracy, finitePopulation, kishDesignEffect, powerTwoMeans,
  repeatedMeasures, singleMean, singleProportion, survivalEvents, twoMeans, twoProportions,
} from "../samplesize";

// Reference values in reference.json were produced with SciPy 1.13 and statsmodels 0.14
// (see scripts/gen_stats_reference.py). They are the trusted oracle for these tests.
const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);
const R = ref as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("distributions match SciPy", () => {
  it("normal, t, chi-square, F and beta", () => {
    close(normPpf(0.975), R.dist.normPpf975, 1e-6);
    close(normPpf(0.8), R.dist.normPpf80, 1e-6);
    for (const [x, df, v] of R.dist.tCdf) close(tCdf(x, df), v, 1e-7);
    for (const [p, df, v] of R.dist.tPpf) close(tPpf(p, df), v, 1e-5);
    for (const [x, df, v] of R.dist.chi2Sf) close(chi2Sf(x, df), v, 1e-7);
    for (const [p, df, v] of R.dist.chi2Ppf) close(chi2Ppf(p, df), v, 1e-5);
    for (const [x, d1, d2, v] of R.dist.fCdf) close(fCdf(x, d1, d2), v, 1e-7);
    for (const [p, a, b, v] of R.dist.betaPpf) close(betaPpf(p, a, b), v, 1e-5);
  });
});

describe("t-tests match SciPy", () => {
  const { x, y, z } = R.data;
  const check = (got: ReturnType<typeof oneSampleT>, want: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    close(got.t, want.t, 1e-9); close(got.df, want.df, 1e-9); close(got.p, want.p, 1e-7);
    close(got.ci.lower, want.lo, 1e-6); close(got.ci.upper, want.hi, 1e-6);
  };
  it("student, welch, paired, one-sample", () => {
    check(twoSampleT(x, y, true), R.ttest.eq);
    check(twoSampleT(x, z, false), R.ttest.welch);
    check(pairedT(x, y), R.ttest.paired);
    // SciPy reports the interval for the mean; ours is for the difference from the hypothesised value.
    const one = oneSampleT(x, 5.0);
    check({ ...one, ci: { lower: one.ci.lower + 5, upper: one.ci.upper + 5 } }, R.ttest.one);
  });
});

describe("categorical tests match SciPy", () => {
  it("chi-square with and without Yates, and r x c", () => {
    const a = chiSquare(R.chi2.table, false), b = chiSquare(R.chi2.table, true), c = chiSquare(R.chi2.table3);
    close(a.chi2, R.chi2.nocorr[0], 1e-9); close(a.p, R.chi2.nocorr[1], 1e-7);
    close(b.chi2, R.chi2.yates[0], 1e-9); close(b.p, R.chi2.yates[1], 1e-7);
    close(c.chi2, R.chi2.r3[0], 1e-9); close(c.p, R.chi2.r3[1], 1e-7); expect(c.df).toBe(R.chi2.r3[2]);
  });
  it("Fisher exact two-sided p", () => {
    for (const { t, p } of R.fisher) close(fisherExact(t[0][0], t[0][1], t[1][0], t[1][1]).pTwoSided, p, 1e-9);
  });
  it("one-way ANOVA", () => {
    const r = oneWayAnova([R.data.x, R.data.y, R.data.z]);
    close(r.f, R.anova.f, 1e-9); close(r.p, R.anova.p, 1e-7);
  });
});

describe("correlation and regression match SciPy / statsmodels", () => {
  it("Pearson with Fisher z interval", () => {
    const r = pearson(R.pearson.x, R.pearson.y);
    close(r.r, R.pearson.r, 1e-9); close(r.p, R.pearson.p, 1e-9);
    close(r.ci!.lower, R.pearson.lo, 1e-6); close(r.ci!.upper, R.pearson.hi, 1e-6);
  });
  it("Spearman with ties", () => {
    const r = spearman(R.spearman.x, R.spearman.y);
    close(r.rho, R.spearman.rho, 1e-9); close(r.p, R.spearman.p, 1e-6);
  });
  it("simple linear regression", () => {
    const r = linearRegression(R.pearson.x, R.pearson.y);
    close(r.slope, R.linreg.slope, 1e-9); close(r.intercept, R.linreg.intercept, 1e-9);
    close(r.seSlope, R.linreg.se, 1e-9); close(r.seIntercept, R.linreg.ise, 1e-9);
    close(r.pSlope, R.linreg.p, 1e-9); close(r.rSquared, R.linreg.r2, 1e-9);
  });
  it("simple logistic regression", () => {
    const m = logisticRegression(R.logit.x, R.logit.y);
    close(m.intercept, R.logit.b0, 1e-6); close(m.slope, R.logit.b1, 1e-6);
    close(m.seIntercept, R.logit.se0, 1e-6); close(m.seSlope, R.logit.se1, 1e-6);
    close(m.pSlope, R.logit.p1, 1e-6); close(m.logLikelihood, R.logit.ll, 1e-6);
    close(m.lrP, R.logit.lrp, 1e-6);
    close(m.oddsRatioCi.lower, R.logit.orlo, 1e-6); close(m.oddsRatioCi.upper, R.logit.orhi, 1e-6);
  });
  it("logistic regression refuses separated or degenerate data", () => {
    expect(() => logisticRegression([1, 2, 3, 4, 5, 6], [0, 0, 0, 1, 1, 1])).toThrow();
    expect(() => logisticRegression([1, 2, 3], [1, 1, 1])).toThrow();
    expect(() => logisticRegression([1, 2, 3], [0, 2, 1])).toThrow();
  });
  it("descriptive statistics", () => {
    const d = describeData(R.quant.x);
    close(d.q1, R.quant.q1, 1e-12); close(d.median, R.quant.q2, 1e-12); close(d.q3, R.quant.q3, 1e-12); close(d.sd, R.quant.sd, 1e-12);
    close(quantile([1, 2, 3, 4], 0.5), 2.5, 1e-12); expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
  });
});

describe("epidemiology matches statsmodels", () => {
  it("odds ratio and relative risk with log-scale intervals", () => {
    const [a, b, c, d] = R.epi.table;
    const r = analyzeExposure({ a, b, c, d });
    close(r.or, R.epi.or, 1e-9); close(r.orCi.lower, R.epi.orci[0], 1e-6); close(r.orCi.upper, R.epi.orci[1], 1e-6);
    close(r.rr, R.epi.rr, 1e-9); close(r.rrCi.lower, R.epi.rrci[0], 1e-6); close(r.rrCi.upper, R.epi.rrci[1], 1e-6);
    close(r.rd, 0.4 - 0.2, 1e-12);
  });
  it("Wilson and Clopper-Pearson intervals, including 0 and n successes", () => {
    for (const [x, n, lo, hi] of R.wilson) { const w = wilson(x, n); close(w.lower, lo, 1e-9); close(w.upper, hi, 1e-9); }
    for (const [x, n, lo, hi] of R.cp) { const w = clopperPearson(x, n); close(w.lower, lo, 1e-5); close(w.upper, hi, 1e-5); }
  });
  it("exact Poisson incidence-rate interval", () => {
    for (const [e, pt, lo, hi] of R.poisson) { const r = incidenceRate(e, pt); close(r.ci.lower, lo, 1e-9); close(r.ci.upper, hi, 1e-9); }
  });
  it("applies a 0.5 correction only when a cell is zero", () => {
    expect(analyzeExposure({ a: 10, b: 20, c: 5, d: 40 }).corrected).toBe(false);
    const z = analyzeExposure({ a: 0, b: 20, c: 5, d: 40 });
    expect(z.corrected).toBe(true); expect(Number.isFinite(z.or)).toBe(true);
  });
  it("diagnostic accuracy on a textbook table", () => {
    // TP 90, FP 30, FN 10, TN 170: sens 0.9, spec 0.85, PPV 0.75, NPV 0.9444, LR+ 6, LR- 0.1176, DOR 51
    const r = analyzeDiagnostic({ a: 90, b: 30, c: 10, d: 170 });
    close(r.sensitivity, 0.9, 1e-12); close(r.specificity, 0.85, 1e-12); close(r.ppv, 0.75, 1e-12);
    close(r.npv, 170 / 180, 1e-12); close(r.lrPositive, 6, 1e-9); close(r.lrNegative, 0.1 / 0.85, 1e-9); close(r.dor, 51, 1e-9);
    expect(r.lrPositiveCi.lower).toBeLessThan(6); expect(r.lrPositiveCi.upper).toBeGreaterThan(6);
  });
});

describe("sample size matches published values and independent formulas", () => {
  it("single proportion: 385 for p = 0.5, d = 0.05, 95%", () => {
    const r = singleProportion(0.5, 0.05, 0.95);
    expect(r.ok && r.values.n).toBe(385);
    const adj = singleProportion(0.5, 0.05, 0.95, { designEffect: 1.5, nonresponse: 0.1 });
    expect(adj.ok && adj.values.n).toBe(Math.ceil((384.1459 * 1.5) / 0.9 - 1e-9));
  });
  it("finite population correction", () => {
    close(finitePopulation(384.1459, 1000), 384.1459 / (1 + 383.1459 / 1000), 1e-9);
    const r = singleProportion(0.5, 0.05, 0.95, { population: 1000 });
    expect(r.ok && r.values.n).toBe(278);
  });
  it("single mean", () => {
    const r = singleMean(10, 2, 0.95);
    expect(r.ok && r.values.n).toBe(97); // (1.96 x 10 / 2)^2 = 96.04
  });
  it("two means agrees with statsmodels NormalIndPower (n = 62.79 -> 63 per group)", () => {
    const r = twoMeans(0.5, 1, 0.95, 0.8, 1);
    expect(r.ok && r.values.n1).toBe(Math.ceil(R.power.n_d05));
    expect(r.ok && r.values.n1).toBe(63);
  });
  it("power agrees with statsmodels", () => {
    const a = powerTwoMeans(64, 0.5, 1, 0.95, 1), b = powerTwoMeans(30, 0.8, 1, 0.95, 1);
    expect(a.ok && Math.abs(a.values.power - R.power.pow_64)).toBeLessThan(1e-4);
    expect(b.ok && Math.abs(b.values.power - R.power.pow_30_d08)).toBeLessThan(1e-4);
  });
  it("two proportions (Fleiss) reproduces the closed form", () => {
    // p1 = 0.4, p2 = 0.25, alpha 0.05, power 0.8, 1:1
    const za = 1.959964, zb = 0.841621, pb = 0.325;
    const n1 = (za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(0.4 * 0.6 + 0.25 * 0.75)) ** 2 / 0.15 ** 2;
    const r = twoProportions(0.4, 0.25, 0.95, 0.8, 1);
    expect(r.ok && r.values.n1).toBe(Math.ceil(n1));
  });
  it("survival (Schoenfeld): HR 0.5 needs 66 events at 80% power", () => {
    const r = survivalEvents(0.5, 0.95, 0.8, 1, 0.5);
    expect(r.ok && r.values.events).toBe(66);
    expect(r.ok && r.values.total).toBe(132);
  });
  it("diagnostic accuracy (Buderer): Se 0.9, d 0.05, prevalence 0.2", () => {
    const r = diagnosticAccuracy(0.9, 0.85, 0.05, 0.2, 0.95);
    expect(r.ok && r.values.forSensitivity).toBe(Math.ceil((1.959964 ** 2 * 0.9 * 0.1) / 0.0025 / 0.2 - 1e-9));
    expect(r.ok && r.values.n).toBe(Math.max(r.ok ? r.values.forSensitivity : 0, r.ok ? r.values.forSpecificity : 0));
  });
  it("case-control and cohort give consistent exposure/risk implications", () => {
    const cc = caseControl(0.3, 2, 0.95, 0.8, 1);
    expect(cc.ok && Math.abs(cc.values.p1 - 0.46154) < 1e-4).toBe(true);
    const co = cohort(0.1, 2, 0.95, 0.8, 1);
    expect(co.ok).toBe(true);
    expect(cohort(0.6, 2, 0.95, 0.8, 1).ok).toBe(false);
  });
  it("cluster trial inflates by the design effect and rounds clusters up", () => {
    const r = clusterTrial("mean", 5, 20, 0.95, 0.8, 10, 0.05);
    expect(r.ok && r.values.designEffect).toBeCloseTo(1.45, 10);
    const base = twoMeans(5, 20, 0.95, 0.8, 1);
    if (!r.ok || !base.ok) throw new Error("unexpected");
    expect(r.values.perArm).toBe(Math.ceil(base.values.n1 * 1.45));
  });
  it("repeated measures with rho = 0 and m = 1 equals the two-sample size", () => {
    const r = repeatedMeasures(5, 20, 0, 1, 0.95, 0.8);
    const t = twoMeans(5, 20, 0.95, 0.8, 1);
    if (!r.ok || !t.ok) throw new Error("unexpected");
    expect(r.values.perGroup).toBe(t.values.n1);
  });
  it("Kish design effect", () => {
    close(kishDesignEffect([1, 1, 1, 1]).deff, 1, 1e-12);
    const k = kishDesignEffect([1, 2, 3, 4]);
    close(k.deff, (4 * 30) / 100, 1e-12); close(k.effectiveN, 4 / 1.2, 1e-12);
  });
  it("rejects invalid input instead of returning numbers", () => {
    expect(singleProportion(0, 0.05, 0.95).ok).toBe(false);
    expect(singleProportion(0.5, 0, 0.95).ok).toBe(false);
    expect(twoProportions(0.3, 0.3, 0.95, 0.8, 1).ok).toBe(false);
    expect(twoMeans(0, 1, 0.95, 0.8, 1).ok).toBe(false);
    expect(survivalEvents(1, 0.95, 0.8, 1).ok).toBe(false);
    expect(singleProportion(0.5, 0.05, 0.95, { nonresponse: 1 }).ok).toBe(false);
  });
});

// Probability distributions, backed by the established jStat library. Every function used by a
// calculator is wrapped here so it can be checked against SciPy in the test suite.
import * as jstatModule from "jstat";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = jstatModule as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const J: any = mod.jStat ?? mod.default?.jStat ?? mod.default ?? mod;

export const normCdf = (x: number): number => J.normal.cdf(x, 0, 1);
export const normPpf = (p: number): number => J.normal.inv(p, 0, 1);
export const tCdf = (x: number, df: number): number => J.studentt.cdf(x, df);
export const tPpf = (p: number, df: number): number => J.studentt.inv(p, df);
export const chi2Cdf = (x: number, df: number): number => J.chisquare.cdf(x, df);
export const chi2Sf = (x: number, df: number): number => 1 - J.chisquare.cdf(x, df);
export const chi2Ppf = (p: number, df: number): number => J.chisquare.inv(p, df);
export const fCdf = (x: number, d1: number, d2: number): number => J.centralF.cdf(x, d1, d2);
export const betaPpf = (p: number, a: number, b: number): number => J.beta.inv(p, a, b);
export const lnGamma = (x: number): number => J.gammaln(x);

/** Two-sided critical z for a confidence level, e.g. 0.95 -> 1.959964. */
export const zCrit = (conf: number): number => normPpf(1 - (1 - conf) / 2);

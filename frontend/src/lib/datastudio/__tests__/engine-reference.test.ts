/* eslint-disable @typescript-eslint/no-explicit-any -- reference.json is untyped */
import { describe, expect, it } from "vitest";
import ref from "./reference.json";
import { summarize } from "../engine/describe";
import { brownForsythe, shapiroWilk } from "../engine/normality";
import { friedman, kruskalWallis, mannWhitney, welchAnova, wilcoxonSignedRank } from "../engine/compare";
import { kendallTauB, partialCorrelation } from "../engine/correlation";
import { adjustP } from "../engine/common";
import { breuschPagan, cooksDistance, durbinWatson, logistic, ols, rocAuc, vif } from "../engine/regression";
import { cohenKappa, fleissKappa, gTest, mantelHaenszel } from "../engine/categorical";
import { coxPH, kaplanMeier, logRank } from "../engine/survival";
import { cronbachAlpha, icc } from "../engine/reliability";
import { gamesHowell } from "../engine/compare";
import { hosmerLemeshow } from "../engine/regression";
import { factorialAnova } from "../engine/anova2";
import { fitGlm } from "../engine/glm";
import { multinomialLogit, ordinalLogit } from "../engine/multicat";
import { bootstrapCi, pca, permutationTest } from "../engine/resample";
import { directStandardize, indirectStandardize } from "../engine/standardize";
import type { Dataset } from "../types";

// reference.json was produced by scripts/gen_datastudio_reference.py with SciPy 1.13 and statsmodels 0.14 (versions are recorded in the
// file). Tolerances: 1e-8 for closed-form statistics, 1e-6 for iterative fits and distribution tails.
const R = ref as Record<string, any>;
const close = (got: number, want: number, tol = 1e-8) => {
  const scale = Math.max(1, Math.abs(want));
  expect(Math.abs(got - want) / scale, `got ${got}, want ${want}`).toBeLessThan(tol);
};

describe("descriptive statistics match NumPy/SciPy", () => {
  it("mean, SD, quartiles, CI, skewness and excess kurtosis (bias-corrected)", () => {
    const d = R.describe;
    const s = summarize(d.x);
    close(s.mean, d.mean); close(s.sd, d.sd); close(s.q1, d.q1); close(s.median, d.median); close(s.q3, d.q3);
    close(s.skewness, d.skew); close(s.kurtosis, d.kurt); close(s.ciLower, d.ci[0]); close(s.ciUpper, d.ci[1]);
    const k = summarize(d.skewed);
    close(k.skewness, d.skewed_skew); close(k.kurtosis, d.skewed_kurt);
  });
});

describe("assumption tests", () => {
  it("Shapiro-Wilk W and p match SciPy for n = 3 to 200", () => {
    for (const c of R.shapiro) {
      const r = shapiroWilk(c.x);
      close(r.w, c.w, 1e-6);
      close(r.p, c.p, 1e-5);
    }
  });
  it("Brown-Forsythe (Levene, median) and Welch ANOVA", () => {
    const g = R.groups;
    const l = brownForsythe([g.g1, g.g2, g.g3]);
    close(l.f, g.levene[0]); close(l.p, g.levene[1], 1e-7);
    const w = welchAnova([g.g1, g.g2, g.g3]);
    close(w.f, g.welch[0]); close(w.p, g.welch[1], 1e-7); close(w.df2, g.welch[3]);
  });
});

describe("nonparametric tests match SciPy", () => {
  const np = R.nonparam;
  it("Mann-Whitney exact and asymptotic", () => {
    const e = mannWhitney(np.mw_exact.a, np.mw_exact.b);
    expect(e.method).toBe("exact");
    close(e.u1, np.mw_exact.u); close(e.p, np.mw_exact.p, 1e-10);
    const a = mannWhitney(np.mw_asym.a, np.mw_asym.b);
    close(a.u1, np.mw_asym.u); close(a.p, np.mw_asym.p, 1e-8);
  });
  it("Wilcoxon signed-rank exact and approximate", () => {
    const e = wilcoxonSignedRank(np.w_exact.d);
    expect(e.method).toBe("exact");
    close(e.T, np.w_exact.stat); close(e.p, np.w_exact.p, 1e-10);
    const a = wilcoxonSignedRank(np.w_asym.d);
    close(a.T, np.w_asym.stat); close(a.p, np.w_asym.p, 1e-8);
  });
  it("Kruskal-Wallis and Friedman with tie correction", () => {
    const k = kruskalWallis(np.kruskal.groups);
    close(k.h, np.kruskal.h); close(k.p, np.kruskal.p, 1e-8);
    const f = friedman(np.friedman.rows);
    close(f.q, np.friedman.q); close(f.p, np.friedman.p, 1e-8);
  });
});

describe("correlation and multiplicity", () => {
  it("Kendall tau-b (asymptotic) and partial correlation", () => {
    const c = R.corr;
    const k = kendallTauB(c.x, c.y);
    close(k.tau, c.kendall[0]); close(k.p, c.kendall[1], 1e-8);
    close(partialCorrelation(c.x, c.y, c.z.map((v: number) => [v])).r, c.partial_r);
  });
  it("Bonferroni, Holm and Benjamini-Hochberg match statsmodels", () => {
    for (const m of ["bonferroni", "holm", "fdr_bh"] as const) adjustP(R.adjust.p, m).forEach((v, i) => close(v, R.adjust[m][i]));
  });
});

describe("linear regression matches statsmodels OLS", () => {
  const o = R.ols;
  const X = o.age.map((a: number, i: number) => [1, a, o.sex[i], o.grp[i] === "b" ? 1 : 0, o.grp[i] === "c" ? 1 : 0]);
  it("coefficients, SEs, p, CIs, fit statistics", () => {
    const m = ols(X, o.y);
    m.coefs.forEach((c, j) => { close(c.b, o.params[j]); close(c.se, o.bse[j]); close(c.p, o.pvalues[j], 1e-7); close(c.lo, o.ci[j][0], 1e-7); close(c.hi, o.ci[j][1], 1e-7); }); // CI bounds inherit jStat's t quantile precision (~1e-8)
    close(m.r2, o.r2); close(m.adjR2, o.adjr2); close(m.f, o.f); close(m.fP, o.fp, 1e-7); close(m.aic, o.aic); close(m.bic, o.bic); close(m.logLik, o.llf);
  });
  it("HC3 robust SEs, Breusch-Pagan, VIF, Cook's distance, Durbin-Watson", () => {
    const r = ols(X, o.y, { robust: "HC3" });
    r.coefs.forEach((c, j) => close(c.se, o.hc3_bse[j]));
    const m = ols(X, o.y);
    const bp = breuschPagan(X, m.resid);
    close(bp.lm, o.bp[0]); close(bp.p, o.bp[1], 1e-7);
    vif(X).forEach((v, j) => close(v, o.vif[j], 1e-7));
    close(Math.max(...cooksDistance(m.resid, m.leverage, m.s2, m.p)), o.cooks_max);
    close(durbinWatson(m.resid), o.dw);
  });
  it("interaction model", () => {
    const Xi = o.age.map((a: number, i: number) => [1, a, o.sex[i], a * o.sex[i]]);
    const m = ols(Xi, o.y);
    m.coefs.forEach((c, j) => { close(c.b, o.inter_params[j]); close(c.se, o.inter_bse[j]); });
  });
});

describe("logistic regression matches statsmodels Logit", () => {
  it("coefficients, SEs, likelihoods, LR test, pseudo-R2, AIC, AUC", () => {
    const o = R.ols, l = R.logit;
    const X = o.age.map((a: number, i: number) => [1, a, o.sex[i]]);
    const m = logistic(X, l.y);
    m.coefs.forEach((c, j) => { close(c.b, l.params[j], 1e-6); close(c.se, l.bse[j], 1e-6); close(c.p, l.pvalues[j], 1e-6); });
    close(m.logLik, l.llf, 1e-9); close(m.logLik0, l.llnull, 1e-9); close(m.lr, l.llr, 1e-7); close(m.lrP, l.llr_p, 1e-6);
    close(m.mcfadden, l.prsquared, 1e-8); close(m.aic, l.aic, 1e-8);
    close(rocAuc(m.fitted, l.y).auc, l.auc, 1e-9);
  });
});

describe("categorical analysis matches SciPy/statsmodels", () => {
  const c = R.cat;
  it("likelihood-ratio chi-square", () => { const g = gTest(c.g_table); close(g.g, c.g[0]); close(g.p, c.g[1], 1e-8); });
  it("Mantel-Haenszel OR, RGB CI, MH test and Breslow-Day", () => {
    const m = mantelHaenszel(c.strata.map((s: number[][]) => ({ a: s[0][0], b: s[0][1], c: s[1][0], d: s[1][1] })));
    close(m.or, c.mh_or); close(m.ci.lower, c.mh_ci[0], 1e-7); close(m.ci.upper, c.mh_ci[1], 1e-7);
    close(m.chi2, c.mh_chi2[0]); close(m.p, c.mh_chi2[1], 1e-8);
    close(m.breslowDay, c.bd[0], 1e-6); close(m.bdP, c.bd[1], 1e-6);
  });
  it("Cohen's kappa (unweighted, linear, quadratic) and Fleiss' kappa", () => {
    const k = cohenKappa(c.kappa_table);
    close(k.kappa, c.kappa[0]); close(k.se, c.kappa[1], 1e-7); close(k.lo, c.kappa[2], 1e-7); close(k.hi, c.kappa[3], 1e-7);
    close(cohenKappa(c.kappa_table, "linear").kappa, c.kappa_linear[0]); close(cohenKappa(c.kappa_table, "linear").se, c.kappa_linear[1], 1e-7);
    close(cohenKappa(c.kappa_table, "quadratic").kappa, c.kappa_quadratic[0]);
    close(fleissKappa(c.fleiss_counts).kappa, c.fleiss);
  });
});

describe("survival analysis matches statsmodels", () => {
  const s = R.surv;
  it("Kaplan-Meier estimates and Greenwood SEs", () => {
    const km = kaplanMeier(s.time, s.status);
    km.rows.forEach((r, i) => { close(r.time, s.km_time[i]); close(r.surv, s.km_prob[i], 1e-10); close(r.se, s.km_se[i], 1e-8); });
  });
  it("log-rank test", () => { const lr = logRank(s.time, s.status, s.group); close(lr.chi2, s.logrank[0], 1e-8); close(lr.p, s.logrank[1], 1e-8); });
  it("Cox proportional hazards (Breslow ties)", () => {
    const X = s.group.map((g: number, i: number) => [g, s.age[i]]);
    const m = coxPH(s.time, s.status, X);
    m.coefs.forEach((c, j) => { close(c.b, s.cox_params[j], 1e-6); close(c.se, s.cox_bse[j], 1e-6); });
    close(m.logLik, s.cox_llf, 1e-8);
  });
});

describe("reliability", () => {
  it("Cronbach's alpha and ICC forms match the ANOVA definitions", () => {
    const r = R.rel;
    close(cronbachAlpha(r.items).alpha, r.alpha);
    const f = icc(r.items).forms;
    close(f[0].single, r.icc1); close(f[1].single, r.icc2); close(f[2].single, r.icc3);
  });
});

// --- Second batch: factorial ANOVA/ANCOVA, GLMs, multinomial/ordinal logistic, PCA, resampling, standardisation -----------------------

function dataset(cols: Record<string, (number | string)[]>): Dataset {
  return { variables: Object.entries(cols).map(([name, c]) => ({ name, type: typeof c[0] === "number" ? "numeric" : "string", measure: typeof c[0] === "number" ? "scale" : "nominal", role: "none" })), columns: Object.values(cols) };
}

describe("factorial ANOVA and ANCOVA match statsmodels anova_lm", () => {
  const a = R.anova2;
  const d = dataset({ y: a.y, a: a.a, b: a.b, c: a.c, x: a.x });
  const sm = (label: string, factors: string[]) => label.split(" × ").map((v) => (factors.includes(v) ? `C(${v}, Sum)` : v)).join(":");
  const check = (res: ReturnType<typeof factorialAnova>, want: Record<string, (number | null)[]>, factors: string[]) => {
    for (const r of res.rows) {
      const w = want[sm(r.label, factors)];
      expect(w, r.label).toBeDefined();
      close(r.ss, w[0]!); expect(r.df).toBe(w[1]); close(r.f, w[2]!); close(r.p, w[3]!, 1e-7);
    }
    close(res.error.ss, want.Residual[0]!); expect(res.error.df).toBe(want.Residual[1]);
  };
  it("two-way ANCOVA, Type III (effect coding) and Type II", () => {
    check(factorialAnova(d, "y", ["a", "b"], ["x"], { interactions: true, ssType: 3 }), a.ancova3, ["a", "b"]);
    check(factorialAnova(d, "y", ["a", "b"], ["x"], { interactions: true, ssType: 2 }), a.ancova2, ["a", "b"]);
  });
  it("three-way factorial ANOVA, Type III and Type II", () => {
    check(factorialAnova(d, "y", ["a", "b", "c"], [], { interactions: true, ssType: 3 }), a.three3, ["a", "b", "c"]);
    check(factorialAnova(d, "y", ["a", "b", "c"], [], { interactions: true, ssType: 2 }), a.three2, ["a", "b", "c"]);
  });
  it("homogeneity-of-slopes tests", () => {
    const res = factorialAnova(d, "y", ["a", "b"], ["x"], { interactions: true, ssType: 3 });
    expect(res.slopes.length).toBe(2);
    for (const s of res.slopes) { const w = a.slopes3[sm(s.label, ["a", "b"])]; close(s.f, w[2]); close(s.p, w[3], 1e-7); expect(s.df1).toBe(w[1]); }
  });
});

describe("generalized linear models match statsmodels", () => {
  const g = R.glm;
  const X = g.age.map((v: number, i: number) => [1, v, g.sex[i]]);
  const off = g.t.map(Math.log);
  it("Poisson with offset: coefficients, SEs, log-likelihood, deviance, Pearson, AIC, HC0", () => {
    const m = fitGlm(X, g.y_pois, { family: "poisson", offset: off });
    m.coefs.forEach((c, j) => { close(c.b, g.pois.params[j]); close(c.se, g.pois.bse[j]); });
    close(m.logLik, g.pois.llf); close(m.deviance, g.pois.deviance); close(m.pearsonChi2, g.pois.pearson); close(m.aic, g.pois.aic);
    fitGlm(X, g.y_pois, { family: "poisson", offset: off, robust: true }).coefs.forEach((c, j) => close(c.se, g.pois.hc0[j]));
  });
  it("gamma with log link: coefficients, SEs, scale, log-likelihood, deviance, AIC, HC0", () => {
    const m = fitGlm(X, g.y_gam, { family: "gamma" });
    m.coefs.forEach((c, j) => { close(c.b, g.gamma.params[j]); close(c.se, g.gamma.bse[j]); });
    close(m.scale, g.gamma.scale); close(m.logLik, g.gamma.llf); close(m.deviance, g.gamma.deviance); close(m.pearsonChi2, g.gamma.pearson); close(m.aic, g.gamma.aic);
    fitGlm(X, g.y_gam, { family: "gamma", robust: true }).coefs.forEach((c, j) => close(c.se, g.gamma.hc0[j], 1e-7));
  });
  it("negative binomial NB2: coefficients, alpha, SEs, log-likelihood, AIC, deviance, HC0", () => {
    const m = fitGlm(X, g.y_nb, { family: "negbin", offset: off });
    m.coefs.forEach((c, j) => { close(c.b, g.nb.params[j], 1e-7); close(c.se, g.nb.bse[j], 1e-6); });
    close(m.alpha!, g.nb.params[3], 1e-7); close(m.alphaSe!, g.nb.bse[3], 1e-6);
    close(m.logLik, g.nb.llf, 1e-9); close(m.aic, g.nb.aic, 1e-9); close(m.deviance, g.nb.deviance, 1e-7);
    const r = fitGlm(X, g.y_nb, { family: "negbin", offset: off, robust: true });
    r.coefs.forEach((c, j) => close(c.se, g.nb.hc0[j], 1e-6)); close(r.alphaSe!, g.nb.hc0[3], 1e-6);
  });
});

describe("multinomial and ordinal logistic regression match statsmodels", () => {
  const m = R.multicat;
  it("MNLogit: coefficients, SEs, log-likelihoods, LR test, AIC", () => {
    const X = m.x1.map((v: number, i: number) => [1, v, m.x2[i]]);
    const r = multinomialLogit(X, m.y_mn, 3);
    r.coefs.forEach((cat, k) => cat.forEach((c, j) => { close(c.b, m.mn.params[k][j], 1e-7); close(c.se, m.mn.bse[k][j], 1e-7); }));
    close(r.logLik, m.mn.llf, 1e-9); close(r.logLik0, m.mn.llnull, 1e-9); close(r.lr, m.mn.llr, 1e-8); // statsmodels fits the null model iteratively; ours is closed form close(r.aic, m.mn.aic, 1e-9);
  });
  it("OrderedModel (logit): slopes, SEs, thresholds, log-likelihood, AIC", () => {
    const X = m.x1.map((v: number, i: number) => [v, m.x2[i]]);
    const r = ordinalLogit(X, m.y_ord, 4);
    // statsmodels' SEs come from a numerical Hessian, so they agree to about 1e-6.
    r.coefs.forEach((c, j) => { close(c.b, m.ord.params[j], 1e-7); close(c.se, m.ord.bse[j], 1e-5); });
    r.theta.forEach((t, j) => close(t, m.ord.thresholds[j], 1e-7));
    close(r.logLik, m.ord.llf, 1e-10); close(r.aic, m.ord.aic, 1e-10);
  });
});

describe("PCA matches NumPy", () => {
  it("eigenvalues, loadings (sign-normalised), Bartlett's test and KMO", () => {
    const p = R.pca;
    const r = pca(p.x);
    r.eigenvalues.forEach((v, j) => close(v, p.eigenvalues[j], 1e-10));
    r.loadings.forEach((row, i) => row.forEach((v, j) => close(v, p.loadings[i][j], 1e-8)));
    close(r.bartlett, p.bartlett, 1e-9); close(r.bartlettP, p.bartlett_p, 1e-7); close(r.kmo, p.kmo, 1e-10);
  });
});

describe("resampling matches a bit-for-bit Python port of the generator, and SciPy", () => {
  const b = R.boot;
  it("bootstrap SE, percentile and BCa intervals (SciPy _bca_interval on the same resamples)", () => {
    for (const st of ["mean", "median"] as const) {
      const r = bootstrapCi(b.x, st, b.B, b.seed, 0.95);
      r.reps.slice(0, 5).forEach((v, i) => close(v, b[st].reps_head[i], 1e-12));
      close(r.se, b[st].se, 1e-10); close(r.acceleration, b[st].a, 1e-10);
      close(r.percentile[0], b[st].pct[0], 1e-12); close(r.percentile[1], b[st].pct[1], 1e-12);
      close(r.bca![0], b[st].bca[0], 1e-8); close(r.bca![1], b[st].bca[1], 1e-8);
      // Independent Monte Carlo check against scipy.stats.bootstrap (20,000 resamples, different generator): within Monte Carlo error.
      expect(Math.abs(r.bca![0] - b[st].scipy_bca_mc[0]) / b[st].scipy_bca_mc[0]).toBeLessThan(0.03);
      expect(Math.abs(r.bca![1] - b[st].scipy_bca_mc[1]) / b[st].scipy_bca_mc[1]).toBeLessThan(0.03);
    }
  });
  it("permutation test: exact p equals scipy.stats.permutation_test; Monte Carlo p is reproducible and close to SciPy's", () => {
    const p = R.perm;
    const e = permutationTest(p.a, p.b, 10000, 1);
    expect(e.exact).toBe(true); expect(e.permutations).toBe(1716); close(e.p, p.exact_p, 1e-12);
    const m = permutationTest(p.qa, p.qb, 5000, 99, 0);
    expect(m.exact).toBe(false); close(m.p, p.mc_p, 1e-12);
    expect(Math.abs(m.p - p.scipy_mc_p)).toBeLessThan(0.01);
  });
});

describe("standardisation matches SciPy-based formulas", () => {
  it("direct (Fay-Feuer gamma CI) and indirect (SMR, exact Poisson CI and test)", () => {
    const s = R.standardize;
    const strata = s.events.map((e: number, i: number) => ({ events: e, pop: s.pop[i] }));
    const d = directStandardize(strata, s.std_pop);
    close(d.rate, s.dsr, 1e-12); close(d.lo, s.dsr_ci[0], 1e-7); close(d.hi, s.dsr_ci[1], 1e-7);
    const ind = indirectStandardize(strata, s.std_rate);
    close(ind.smr, s.smr, 1e-12); close(ind.lo, s.smr_ci[0], 1e-7); close(ind.hi, s.smr_ci[1], 1e-7); close(ind.p, s.smr_p, 1e-7);
  });
});

// --- External checks of methods implemented earlier -----------------------------------------------------------------------------
// R is not installed in the build environment, so these use published worked examples (cited) or an independent implementation.

describe("external checks", () => {
  it("Games-Howell p-values match SciPy's studentized range distribution", () => {
    const g = R.groups;
    const r = gamesHowell([g.g1, g.g2, g.g3]);
    R.games_howell.forEach((w: { i: number; j: number; df: number; p: number }, k: number) => { expect([r[k].i, r[k].j]).toEqual([w.i, w.j]); close(r[k].df, w.df); close(r[k].p, w.p, 1e-6); });
  });
  it("ICC forms reproduce Shrout & Fleiss (1979), Table 4, and the CIs printed by psych::ICC for the same data", () => {
    // Shrout PE, Fleiss JL. Intraclass correlations: uses in assessing rater reliability. Psychol Bull 1979;86:420-8 (6 targets, 4 judges).
    // CIs: Revelle W, psych package, ICC() documentation example on the same data (two decimals).
    const sf = [[9, 2, 5, 8], [6, 1, 3, 2], [8, 4, 6, 8], [7, 1, 2, 6], [10, 5, 6, 9], [6, 2, 4, 7]];
    const f = icc(sf).forms;
    const r2 = (x: number, want: number) => expect(Math.abs(x - want), `${x} vs ${want}`).toBeLessThanOrEqual(0.005 + 1e-12);
    r2(f[0].single, 0.17); r2(f[1].single, 0.29); r2(f[2].single, 0.71); r2(f[0].average, 0.44); r2(f[1].average, 0.62); r2(f[2].average, 0.91);
    r2(f[0].lo, -0.13); r2(f[0].hi, 0.72); r2(f[1].lo, 0.02); r2(f[1].hi, 0.76); r2(f[2].lo, 0.34); r2(f[2].hi, 0.95);
    r2(f[0].loAvg, -0.88); r2(f[0].hiAvg, 0.91); r2(f[1].loAvg, 0.07); r2(f[1].hiAvg, 0.93); r2(f[2].hiAvg, 0.99);
    // Cronbach's alpha equals ICC(3,k), and Feldt's interval equals the ICC(3,k) interval (same F distribution), so the published
    // ICC(3,k) values also check alpha and its CI.
    const a = cronbachAlpha(sf);
    close(a.alpha, f[2].average, 1e-12); close(a.lo, f[2].loAvg, 1e-10); close(a.hi, f[2].hiAvg, 1e-10);
  });
  it("AUC and DeLong SE on the Hanley & McNeil (1982) rating data", () => {
    // Hanley JA, McNeil BJ. The meaning and use of the area under a ROC curve. Radiology 1982;143:29-36, Table 1: published AUC 0.893.
    const d = R.delong;
    const r = rocAuc([...d.pos, ...d.neg], [...d.pos.map(() => 1), ...d.neg.map(() => 0)]);
    expect(Math.abs(r.auc - 0.893)).toBeLessThan(0.0005);
    close(r.auc, d.auc, 1e-12);
    close(r.se, d.se, 1e-10); // DeLong SE from an independent midrank implementation (Sun & Xu 2014)
  });
  it("Hosmer-Lemeshow statistic recomputed independently in NumPy", () => {
    const o = R.ols, l = R.logit;
    const X = o.age.map((a: number, i: number) => [1, a, o.sex[i]]);
    const h = hosmerLemeshow(logistic(X, l.y).fitted, l.y);
    close(h.chi2, R.hosmer_lemeshow.chi2, 1e-6); close(h.p, R.hosmer_lemeshow.p, 1e-6); expect(h.df).toBe(8);
  });
});

"""Reference values for the Data Studio statistical engine.

Produces frontend/src/lib/datastudio/__tests__/reference.json from SciPy and statsmodels, which the TypeScript tests treat as the oracle.
Run from the repository root:  python frontend/scripts/gen_datastudio_reference.py
Versions used are recorded in the output.
"""
import json
import os

import numpy as np
import scipy
import scipy.stats as st
import statsmodels
import statsmodels.api as sm
from statsmodels.stats.diagnostic import het_breuschpagan
from statsmodels.stats.inter_rater import cohens_kappa, fleiss_kappa
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.oneway import anova_oneway
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.stats.contingency_tables import StratifiedTable
from statsmodels.duration.survfunc import SurvfuncRight, survdiff
from statsmodels.duration.hazard_regression import PHReg

rng = np.random.default_rng(20261126)
out = {"versions": {"scipy": scipy.__version__, "statsmodels": statsmodels.__version__, "numpy": np.__version__}}


def L(a):
    return [float(v) for v in np.asarray(a).ravel()]


# Descriptives -----------------------------------------------------------------------------------------------------------------
x = np.round(rng.normal(50, 10, 40), 2)
skewed = np.round(rng.lognormal(1, 0.8, 60), 3)
out["describe"] = {
    "x": L(x),
    "mean": float(x.mean()), "sd": float(x.std(ddof=1)), "skew": float(st.skew(x, bias=False)), "kurt": float(st.kurtosis(x, bias=False)),
    "q1": float(np.percentile(x, 25)), "median": float(np.median(x)), "q3": float(np.percentile(x, 75)),
    "ci": L(st.t.interval(0.95, len(x) - 1, loc=x.mean(), scale=st.sem(x))),
    "skewed": L(skewed), "skewed_skew": float(st.skew(skewed, bias=False)), "skewed_kurt": float(st.kurtosis(skewed, bias=False)),
}

# Shapiro-Wilk ---------------------------------------------------------------------------------------------------------------
sw = []
for n in [3, 4, 5, 7, 11, 12, 20, 50, 200]:
    s = np.round(rng.normal(0, 1, n) + (rng.exponential(1, n) if n % 2 else 0), 4)
    w, p = st.shapiro(s)
    sw.append({"x": L(s), "w": float(w), "p": float(p)})
w, p = st.shapiro(skewed)
sw.append({"x": L(skewed), "w": float(w), "p": float(p)})
out["shapiro"] = sw

# Levene (median) and Welch ANOVA ---------------------------------------------------------------------------------------------
g1 = np.round(rng.normal(10, 2, 15), 2); g2 = np.round(rng.normal(12, 4, 18), 2); g3 = np.round(rng.normal(11, 1, 12), 2)
lev = st.levene(g1, g2, g3, center="median")
wa = anova_oneway([g1, g2, g3], use_var="unequal")
out["groups"] = {"g1": L(g1), "g2": L(g2), "g3": L(g3), "levene": [float(lev.statistic), float(lev.pvalue)],
                 "welch": [float(wa.statistic), float(wa.pvalue), float(wa.df[0]), float(wa.df[1])]}

# Mann-Whitney, Wilcoxon, Kruskal, Friedman ------------------------------------------------------------------------------------
a_small = [1.1, 2.3, 3.4, 4.8, 5.2]; b_small = [2.9, 6.1, 7.4, 8.8, 9.0, 10.2]
mw_exact = st.mannwhitneyu(a_small, b_small, alternative="two-sided", method="exact")
ta = np.round(rng.normal(5, 2, 25)); tb = np.round(rng.normal(6, 2, 30))
mw_asym = st.mannwhitneyu(ta, tb, alternative="two-sided", method="asymptotic", use_continuity=True)
d_exact = [0.5, -1.2, 2.3, 3.1, -0.4, 1.7, 2.9, 4.2, -2.6, 1.1, 3.6, 0.9]
w_exact = st.wilcoxon(d_exact, method="exact")
d_ties = list(np.round(rng.normal(1, 2, 40)))
w_asym = st.wilcoxon(d_ties, zero_method="wilcox", correction=False, method="approx")
fr_data = np.round(rng.normal(0, 1, (15, 4)) + np.array([0, 0.3, 0.6, 0.2]), 1)
fr = st.friedmanchisquare(*fr_data.T)
out["nonparam"] = {
    "mw_exact": {"a": a_small, "b": b_small, "u": float(mw_exact.statistic), "p": float(mw_exact.pvalue)},
    "mw_asym": {"a": L(ta), "b": L(tb), "u": float(mw_asym.statistic), "p": float(mw_asym.pvalue)},
    "w_exact": {"d": d_exact, "stat": float(w_exact.statistic), "p": float(w_exact.pvalue)},
    "w_asym": {"d": [float(v) for v in d_ties], "stat": float(w_asym.statistic), "p": float(w_asym.pvalue)},
}
kw3 = np.round(rng.normal(7, 2, 20))
kw = st.kruskal(ta, tb, kw3)
out["nonparam"]["kruskal"] = {"groups": [L(ta), L(tb), L(kw3)], "h": float(kw.statistic), "p": float(kw.pvalue)}
out["nonparam"]["friedman"] = {"rows": fr_data.tolist(), "q": float(fr.statistic), "p": float(fr.pvalue)}

# Correlation ----------------------------------------------------------------------------------------------------------------
cx = np.round(rng.normal(0, 1, 30), 1); cy = np.round(cx * 0.6 + rng.normal(0, 1, 30), 1); cz = np.round(rng.normal(0, 1, 30), 1)
kt = st.kendalltau(cx, cy, method="asymptotic")
# partial correlation via residuals
Z = sm.add_constant(cz)
rx = sm.OLS(cx, Z).fit().resid; ry = sm.OLS(cy, Z).fit().resid
pr = st.pearsonr(rx, ry)
out["corr"] = {"x": L(cx), "y": L(cy), "z": L(cz), "kendall": [float(kt.statistic), float(kt.pvalue)], "partial_r": float(pr.statistic)}
pvals = [0.01, 0.04, 0.03, 0.2, 0.005, 0.5]
out["adjust"] = {"p": pvals, **{m: L(multipletests(pvals, method=m)[1]) for m in ["bonferroni", "holm", "fdr_bh"]}}

# Linear regression ---------------------------------------------------------------------------------------------------------
n = 80
age = np.round(rng.uniform(20, 70, n)); sex = rng.integers(0, 2, n); grp = rng.choice(["a", "b", "c"], n)
y = 5 + 0.3 * age + 2 * sex + np.where(grp == "b", 1.5, np.where(grp == "c", -1, 0)) + rng.normal(0, 3 + 0.05 * age, n)
y = np.round(y, 2)
X = np.column_stack([np.ones(n), age, sex, (grp == "b").astype(float), (grp == "c").astype(float)])
m = sm.OLS(y, X).fit()
mr = sm.OLS(y, X).fit(cov_type="HC3")
bp = het_breuschpagan(m.resid, X)
infl = m.get_influence()
out["ols"] = {
    "age": L(age), "sex": [int(v) for v in sex], "grp": [str(v) for v in grp], "y": L(y),
    "params": L(m.params), "bse": L(m.bse), "pvalues": L(m.pvalues), "ci": m.conf_int().tolist(), "r2": float(m.rsquared), "adjr2": float(m.rsquared_adj),
    "f": float(m.fvalue), "fp": float(m.f_pvalue), "aic": float(m.aic), "bic": float(m.bic), "llf": float(m.llf),
    "hc3_bse": L(mr.bse), "bp": [float(bp[0]), float(bp[1])],
    "vif": [float(variance_inflation_factor(X, j)) for j in range(1, X.shape[1])],
    "cooks_max": float(infl.cooks_distance[0].max()), "dw": float(sm.stats.stattools.durbin_watson(m.resid)),
}
# interaction model
Xi = np.column_stack([np.ones(n), age, sex, age * sex])
mi = sm.OLS(y, Xi).fit()
out["ols"]["inter_params"] = L(mi.params); out["ols"]["inter_bse"] = L(mi.bse)

# Logistic regression ------------------------------------------------------------------------------------------------------
eta = -4 + 0.06 * age + 0.8 * sex
yb = (rng.uniform(0, 1, n) < 1 / (1 + np.exp(-eta))).astype(int)
lm = sm.Logit(yb, X[:, :3]).fit(disp=0)
pos = lm.predict()[yb == 1]; neg = lm.predict()[yb == 0]
auc = float(np.mean([(p > q) + 0.5 * (p == q) for p in pos for q in neg]))
out["logit"] = {"y": [int(v) for v in yb], "params": L(lm.params), "bse": L(lm.bse), "pvalues": L(lm.pvalues), "llf": float(lm.llf), "llnull": float(lm.llnull),
                "llr": float(lm.llr), "llr_p": float(lm.llr_pvalue), "prsquared": float(lm.prsquared), "aic": float(lm.aic), "auc": auc}

# Categorical ---------------------------------------------------------------------------------------------------------------
t = np.array([[12, 5], [7, 16]])
g = st.chi2_contingency(t, correction=False, lambda_="log-likelihood")
strata = [np.array([[10, 20], [5, 25]]), np.array([[8, 12], [6, 18]]), np.array([[15, 10], [9, 14]])]
stt = StratifiedTable(strata)
bd = stt.test_equal_odds(adjust=False)
mh = stt.test_null_odds(correction=True)
kt_table = np.array([[20, 5, 1], [4, 15, 3], [2, 4, 18]])
ck = cohens_kappa(kt_table)
ckw = cohens_kappa(kt_table, wt="linear")
ckq = cohens_kappa(kt_table, wt="quadratic")
fl_counts = np.array([[0, 0, 0, 0, 14], [0, 2, 6, 4, 2], [0, 0, 3, 5, 6], [0, 3, 9, 2, 0], [2, 2, 8, 1, 1], [7, 7, 0, 0, 0], [3, 2, 6, 3, 0], [2, 5, 3, 2, 2], [6, 5, 2, 1, 0], [0, 2, 2, 3, 7]])
out["cat"] = {
    "g_table": t.tolist(), "g": [float(g[0]), float(g[1])],
    "strata": [s.tolist() for s in strata], "mh_or": float(stt.oddsratio_pooled), "mh_ci": L(stt.oddsratio_pooled_confint()),
    "mh_chi2": [float(mh.statistic), float(mh.pvalue)], "bd": [float(bd.statistic), float(bd.pvalue)],
    "kappa_table": kt_table.tolist(),
    "kappa": [float(ck.kappa), float(ck.std_kappa), float(ck.kappa_low), float(ck.kappa_upp), float(ck.pvalue_two_sided)],
    "kappa_linear": [float(ckw.kappa), float(ckw.std_kappa)], "kappa_quadratic": [float(ckq.kappa), float(ckq.std_kappa)],
    "fleiss_counts": fl_counts.tolist(), "fleiss": float(fleiss_kappa(fl_counts)),
}

# Survival -------------------------------------------------------------------------------------------------------------------
ns = 60
grp_s = rng.integers(0, 2, ns)
tt = np.round(rng.exponential(np.where(grp_s == 1, 8, 14)), 1) + 0.1
cens = np.round(rng.uniform(2, 25, ns), 1)
time = np.minimum(tt, cens); status = (tt <= cens).astype(int)
sf = SurvfuncRight(time, status)
chi2, pv = survdiff(time, status, grp_s)
age_s = np.round(rng.normal(60, 8, ns))
ph = PHReg(time, np.column_stack([grp_s, age_s]), status=status, ties="breslow").fit()
out["surv"] = {"time": L(time), "status": [int(v) for v in status], "group": [int(v) for v in grp_s], "age": L(age_s),
               "km_time": L(sf.surv_times), "km_prob": L(sf.surv_prob), "km_se": L(sf.surv_prob_se),
               "logrank": [float(chi2), float(pv)], "cox_params": L(ph.params), "cox_bse": L(ph.bse), "cox_llf": float(ph.llf)}

# Reliability -----------------------------------------------------------------------------------------------------------------
true = rng.normal(0, 1, 25)
items = np.round(np.column_stack([true + rng.normal(0, 0.7, 25) for _ in range(4)]), 2)
k = items.shape[1]
alpha = k / (k - 1) * (1 - items.var(axis=0, ddof=1).sum() / items.sum(axis=1).var(ddof=1))
# ICC by explicit two-way ANOVA
nn, kk = items.shape
gm = items.mean(); rm = items.mean(axis=1); cm = items.mean(axis=0)
SSR = kk * ((rm - gm) ** 2).sum(); SSC = nn * ((cm - gm) ** 2).sum(); SST = ((items - gm) ** 2).sum(); SSE = SST - SSR - SSC
MSR = SSR / (nn - 1); MSC = SSC / (kk - 1); MSE = SSE / ((nn - 1) * (kk - 1)); MSW = (SSC + SSE) / (nn * (kk - 1))
out["rel"] = {"items": items.tolist(), "alpha": float(alpha),
              "icc1": float((MSR - MSW) / (MSR + (kk - 1) * MSW)),
              "icc2": float((MSR - MSE) / (MSR + (kk - 1) * MSE + kk * (MSC - MSE) / nn)),
              "icc3": float((MSR - MSE) / (MSR + (kk - 1) * MSE))}

# ==============================================================================================================================
# Second batch. A separate generator keeps every earlier reference value unchanged.
import pandas as pd  # noqa: E402
import statsmodels.formula.api as smf  # noqa: E402
from statsmodels.stats.anova import anova_lm  # noqa: E402
from statsmodels.miscmodels.ordinal_model import OrderedModel  # noqa: E402
from scipy.stats._resampling import _bca_interval  # noqa: E402

rng2 = np.random.default_rng(20261124)


def anova_rows(tab):
    res = {}
    for k in tab.index:
        if k == "Intercept":
            continue
        resid = k == "Residual"
        res[str(k)] = [float(tab.loc[k, "sum_sq"]), float(tab.loc[k, "df"]), None if resid else float(tab.loc[k, "F"]), None if resid else float(tab.loc[k, "PR(>F)"])]
    return res


# Factorial ANOVA / ANCOVA (unbalanced, so Type II and III differ) ------------------------------------------------------------
na = 90
fa = rng2.choice(["p", "q", "r"], na, p=[0.5, 0.3, 0.2]); fb = rng2.choice(["u", "v"], na, p=[0.65, 0.35]); fc = rng2.choice(["m", "n"], na)
cov = np.round(rng2.normal(50, 10, na), 1)
ya = np.round(10 + np.where(fa == "q", 2, np.where(fa == "r", -1, 0)) + np.where(fb == "v", 1.5, 0) + np.where((fa == "q") & (fb == "v"), 2, 0)
              + 0.15 * cov + np.where(fc == "n", 0.8, 0) + rng2.normal(0, 2, na), 2)
dfa = pd.DataFrame({"y": ya, "a": fa, "b": fb, "c": fc, "x": cov})
anc = smf.ols("y ~ C(a, Sum)*C(b, Sum) + x", data=dfa).fit()
three = smf.ols("y ~ C(a, Sum)*C(b, Sum)*C(c, Sum)", data=dfa).fit()
slopes = smf.ols("y ~ C(a, Sum)*C(b, Sum) + x + C(a, Sum):x + C(b, Sum):x", data=dfa).fit()
out["anova2"] = {"y": L(ya), "a": [str(v) for v in fa], "b": [str(v) for v in fb], "c": [str(v) for v in fc], "x": L(cov),
                 "ancova3": anova_rows(anova_lm(anc, typ=3)), "ancova2": anova_rows(anova_lm(anc, typ=2)),
                 "three3": anova_rows(anova_lm(three, typ=3)), "three2": anova_rows(anova_lm(three, typ=2)),
                 "slopes3": anova_rows(anova_lm(slopes, typ=3)), "x_slope": [float(anc.params["x"]), float(anc.bse["x"])]}

# GLMs ----------------------------------------------------------------------------------------------------------------------
ng = 150
g_age = np.round(rng2.uniform(20, 80, ng)); g_sex = rng2.integers(0, 2, ng); g_t = np.round(rng2.uniform(0.5, 5, ng), 2)
Xg = np.column_stack([np.ones(ng), g_age, g_sex])
mu_g = np.exp(-2 + 0.02 * g_age + 0.4 * g_sex) * g_t
y_pois = rng2.poisson(mu_g)
y_nb = rng2.poisson(mu_g * rng2.gamma(1 / 0.7, 0.7, ng))
y_gam = np.round(rng2.gamma(2.0, np.exp(1 + 0.01 * g_age + 0.3 * g_sex) / 2.0), 3)
pois = sm.GLM(y_pois, Xg, family=sm.families.Poisson(), offset=np.log(g_t)).fit(tol=1e-14)
pois_r = sm.GLM(y_pois, Xg, family=sm.families.Poisson(), offset=np.log(g_t)).fit(tol=1e-14, cov_type="HC0")
gam = sm.GLM(y_gam, Xg, family=sm.families.Gamma(link=sm.families.links.Log())).fit(tol=1e-14)
gam_r = sm.GLM(y_gam, Xg, family=sm.families.Gamma(link=sm.families.links.Log())).fit(tol=1e-14, cov_type="HC0")
nb = sm.NegativeBinomial(y_nb, Xg, loglike_method="nb2", offset=np.log(g_t)).fit(method="newton", maxiter=300, disp=0, tol=1e-14)
nb_r = sm.NegativeBinomial(y_nb, Xg, loglike_method="nb2", offset=np.log(g_t)).fit(method="newton", maxiter=300, disp=0, tol=1e-14, cov_type="HC0")
mu_nb = nb.predict(Xg, offset=np.log(g_t))
nb_dev = float(sm.families.NegativeBinomial(alpha=nb.params[-1]).deviance(y_nb, mu_nb))
out["glm"] = {"age": L(g_age), "sex": [int(v) for v in g_sex], "t": L(g_t), "y_pois": [int(v) for v in y_pois], "y_nb": [int(v) for v in y_nb], "y_gam": L(y_gam),
              "pois": {"params": L(pois.params), "bse": L(pois.bse), "llf": float(pois.llf), "deviance": float(pois.deviance), "pearson": float(pois.pearson_chi2), "aic": float(pois.aic), "hc0": L(pois_r.bse)},
              "gamma": {"params": L(gam.params), "bse": L(gam.bse), "scale": float(gam.scale), "llf": float(gam.llf), "deviance": float(gam.deviance), "pearson": float(gam.pearson_chi2), "aic": float(gam.aic), "hc0": L(gam_r.bse)},
              "nb": {"params": L(nb.params), "bse": L(nb.bse), "llf": float(nb.llf), "aic": float(nb.aic), "deviance": nb_dev, "hc0": L(nb_r.bse)}}

# Multinomial and ordinal logistic ---------------------------------------------------------------------------------------------
nm = 160
m_x1 = np.round(rng2.normal(0, 1, nm), 2); m_x2 = rng2.integers(0, 2, nm)
Xm = np.column_stack([np.ones(nm), m_x1, m_x2])
eta1 = 0.3 + 0.8 * m_x1 - 0.5 * m_x2; eta2 = -0.2 - 0.6 * m_x1 + 0.9 * m_x2
den = 1 + np.exp(eta1) + np.exp(eta2)
pr = np.column_stack([1 / den, np.exp(eta1) / den, np.exp(eta2) / den])
y_mn = np.array([rng2.choice(3, p=row) for row in pr])
mn = sm.MNLogit(y_mn, Xm).fit(method="newton", maxiter=200, disp=0, tol=1e-14)
lat = 0.9 * m_x1 + 0.7 * m_x2 + rng2.logistic(0, 1, nm)
y_ord = np.digitize(lat, [-0.8, 0.4, 1.5])
om = OrderedModel(y_ord, np.column_stack([m_x1, m_x2]), distr="logit").fit(method="newton", maxiter=200, disp=0, tol=1e-14)
out["multicat"] = {"x1": L(m_x1), "x2": [int(v) for v in m_x2], "y_mn": [int(v) for v in y_mn], "y_ord": [int(v) for v in y_ord],
                   "mn": {"params": np.asarray(mn.params).T.tolist(), "bse": np.asarray(mn.bse).T.tolist(), "llf": float(mn.llf), "llnull": float(mn.llnull), "llr": float(mn.llr), "aic": float(mn.aic)},
                   "ord": {"params": L(om.params[:2]), "bse": L(om.bse[:2]), "thresholds": L(om.model.transform_threshold_params(om.params)[1:-1]), "llf": float(om.llf), "aic": float(om.aic)}}

# PCA ---------------------------------------------------------------------------------------------------------------------------
latent = rng2.normal(0, 1, (60, 2))
pcx = np.round(np.column_stack([latent[:, 0] + rng2.normal(0, 0.5, 60), latent[:, 0] * 0.8 + rng2.normal(0, 0.6, 60), latent[:, 1] + rng2.normal(0, 0.5, 60),
                                latent[:, 1] * 0.7 - latent[:, 0] * 0.3 + rng2.normal(0, 0.6, 60), rng2.normal(0, 1, 60)]), 3)
Rm = np.corrcoef(pcx, rowvar=False)
ev, evec = np.linalg.eigh(Rm)
order = np.argsort(ev)[::-1]; ev = ev[order]; evec = evec[:, order]
for j in range(evec.shape[1]):
    if evec[np.argmax(np.abs(evec[:, j])), j] < 0:
        evec[:, j] = -evec[:, j]
pk = Rm.shape[0]; pn = pcx.shape[0]
Ri = np.linalg.inv(Rm)
part = -Ri / np.sqrt(np.outer(np.diag(Ri), np.diag(Ri)))
offd = ~np.eye(pk, dtype=bool)
out["pca"] = {"x": pcx.tolist(), "eigenvalues": L(ev), "loadings": (evec * np.sqrt(ev)).tolist(),
              "bartlett": float(-(pn - 1 - (2 * pk + 5) / 6) * np.log(np.linalg.det(Rm))), "kmo": float((Rm[offd] ** 2).sum() / ((Rm[offd] ** 2).sum() + (part[offd] ** 2).sum()))}
out["pca"]["bartlett_p"] = float(st.chi2.sf(out["pca"]["bartlett"], pk * (pk - 1) / 2))


# Bootstrap and permutation, with a bit-for-bit port of the engine's mulberry32 generator ---------------------------------------
def mulberry32(seed):
    state = [seed & 0xFFFFFFFF]
    M = 0xFFFFFFFF

    def imul(x, y):
        return (x * y) & M

    def nxt():
        a = (state[0] + 0x6D2B79F5) & M
        state[0] = a
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & M) ^ t
        return ((t ^ (t >> 14)) & M) / 4294967296
    return nxt


bx = np.round(rng2.lognormal(2, 0.6, 35), 2)
boot = {"x": L(bx), "B": 2000, "seed": 12345}
for stat, fn in [("mean", np.mean), ("median", np.median)]:
    rnd = mulberry32(12345)
    n_b = len(bx)
    reps = np.array([fn(bx[[int(rnd() * n_b) for _ in range(n_b)]]) for _ in range(2000)])
    a1, a2, ahat = _bca_interval((bx,), lambda v, axis=-1, fn=fn: fn(v, axis=axis), -1, 0.025, reps[None, :], None)
    boot[stat] = {"reps_head": L(reps[:5]), "se": float(reps.std(ddof=1)), "pct": L(np.percentile(reps, [2.5, 97.5])),
                  "bca": L(np.percentile(reps, [100 * float(np.squeeze(a1)), 100 * float(np.squeeze(a2))])), "a": float(np.squeeze(ahat))}
    sb = st.bootstrap((bx,), lambda v, axis=-1, fn=fn: fn(v, axis=axis), n_resamples=20000, method="BCa", random_state=1)
    boot[stat]["scipy_bca_mc"] = [float(sb.confidence_interval.low), float(sb.confidence_interval.high)]
out["boot"] = boot
pa = np.round(rng2.normal(10, 2, 6), 2); pb = np.round(rng2.normal(12, 2, 7), 2)
pt = st.permutation_test((pa, pb), lambda u, v, axis=-1: np.abs(np.mean(u, axis=axis) - np.mean(v, axis=axis)), permutation_type="independent",
                         alternative="greater", n_resamples=np.inf, vectorized=True)
qa = np.round(rng2.normal(10, 3, 30), 2); qb = np.round(rng2.normal(11.5, 3, 25), 2)
rnd = mulberry32(99)
allq = np.concatenate([qa, qb]); perm = allq.copy(); obs = qa.mean() - qb.mean(); cnt = 0
for _ in range(5000):
    for i in range(len(perm) - 1, 0, -1):
        j = int(rnd() * (i + 1)); perm[i], perm[j] = perm[j], perm[i]
    dd = perm[:30].sum() / 30 - (allq.sum() - perm[:30].sum()) / 25
    cnt += abs(dd) >= abs(obs) - 1e-9 * max(1, abs(obs))
mc = st.permutation_test((qa, qb), lambda u, v, axis=-1: np.mean(u, axis=axis) - np.mean(v, axis=axis), permutation_type="independent", n_resamples=50000, vectorized=True, random_state=2)
out["perm"] = {"a": L(pa), "b": L(pb), "exact_p": float(pt.pvalue), "qa": L(qa), "qb": L(qb), "mc_p": (int(cnt) + 1) / 5001, "scipy_mc_p": float(mc.pvalue)}

# Standardisation: Fay-Feuer gamma intervals (as epitools::ageadjust.direct) and exact Poisson SMR, with SciPy distributions ---------
ev_s = np.array([4, 12, 30, 61, 95]); pop_s = np.array([12000, 15000, 14000, 9000, 5000]); std_pop = np.array([20000, 25000, 22000, 18000, 15000])
std_rate = np.array([0.0002, 0.0007, 0.0018, 0.0060, 0.0170])
wst = std_pop / std_pop.sum(); rate_s = ev_s / pop_s
dsr = float((wst * rate_s).sum()); dvar = float((wst ** 2 * ev_s / pop_s ** 2).sum()); wm = float((wst / pop_s).max())
dlo = st.gamma.ppf(0.025, dsr ** 2 / dvar, scale=dvar / dsr); dhi = st.gamma.ppf(0.975, (dsr + wm) ** 2 / (dvar + wm ** 2), scale=(dvar + wm ** 2) / (dsr + wm))
O = int(ev_s.sum()); E = float((pop_s * std_rate).sum())
smr_p = min(1.0, 2 * min(st.poisson.cdf(O, E), st.poisson.sf(O - 1, E)))
out["standardize"] = {"events": [int(v) for v in ev_s], "pop": [int(v) for v in pop_s], "std_pop": [int(v) for v in std_pop], "std_rate": L(std_rate),
                      "dsr": dsr, "dsr_ci": [float(dlo), float(dhi)], "smr": O / E, "smr_ci": [float(st.chi2.ppf(0.025, 2 * O) / (2 * E)), float(st.chi2.ppf(0.975, 2 * O + 2) / (2 * E))], "smr_p": float(smr_p)}

# External checks for earlier methods -----------------------------------------------------------------------------------------
# Games-Howell p-values with SciPy's studentized range distribution (independent of jStat's Tukey implementation).
gh = []
gg = [g1, g2, g3]
for i in range(3):
    for j in range(i + 1, 3):
        vi, vj = gg[i].var(ddof=1) / len(gg[i]), gg[j].var(ddof=1) / len(gg[j])
        dfw = (vi + vj) ** 2 / (vi ** 2 / (len(gg[i]) - 1) + vj ** 2 / (len(gg[j]) - 1))
        q = abs(gg[i].mean() - gg[j].mean()) / np.sqrt((vi + vj) / 2)
        gh.append({"i": i, "j": j, "df": float(dfw), "q": float(q), "p": float(st.studentized_range.sf(q, 3, dfw))})
out["games_howell"] = gh


# DeLong standard error by the fast midrank algorithm of Sun & Xu (2014), an implementation independent of the engine's pairwise one,
# on the published Hanley & McNeil (1982) rating data.
def midrank(v):
    o = np.argsort(v, kind="mergesort"); sv = v[o]; r = np.zeros(len(v)); i = 0
    while i < len(v):
        j = i
        while j < len(v) and sv[j] == sv[i]:
            j += 1
        r[i:j] = 0.5 * (i + j - 1) + 1
        i = j
    res = np.empty(len(v)); res[o] = r
    return res


hm_neg = np.repeat([1, 2, 3, 4, 5], [33, 6, 6, 11, 2]).astype(float); hm_pos = np.repeat([1, 2, 3, 4, 5], [3, 2, 2, 11, 33]).astype(float)
m_, n_ = len(hm_pos), len(hm_neg)
tz = midrank(np.concatenate([hm_pos, hm_neg])); tx = midrank(hm_pos); ty = midrank(hm_neg)
auc_hm = (tz[:m_].sum() / m_ - (m_ + 1) / 2) / n_
v01 = (tz[:m_] - tx) / n_; v10 = 1 - (tz[m_:] - ty) / m_
out["delong"] = {"pos": L(hm_pos), "neg": L(hm_neg), "auc": float(auc_hm), "se": float(np.sqrt(np.var(v01, ddof=1) / m_ + np.var(v10, ddof=1) / n_))}

# Hosmer-Lemeshow (deciles of risk, groups split by sorted position as the engine does) recomputed in NumPy on the logit data above.
pl = lm.predict(); oo = np.argsort(pl, kind="mergesort"); hl = 0.0
for k in range(10):
    grp_k = oo[(k * n) // 10:((k + 1) * n) // 10]
    o_k, e_k, nk = yb[grp_k].sum(), pl[grp_k].sum(), len(grp_k)
    hl += (o_k - e_k) ** 2 / (nk * (e_k / nk) * (1 - e_k / nk))
out["hosmer_lemeshow"] = {"chi2": float(hl), "p": float(st.chi2.sf(hl, 8))}

path =os.path.join(os.path.dirname(__file__), "..", "src", "lib", "datastudio", "__tests__", "reference.json")
with open(path, "w") as f:
    json.dump(out, f, indent=1)
print("wrote", os.path.abspath(path))

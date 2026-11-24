// Exports: CSV that is safe to open in a spreadsheet, result tables as CSV, a data dictionary, and a reproducible Python script.

import type { AnalysisResult, ResultTable } from "./engine/common";
import type { Operation } from "./transform";
import { nRows, type Dataset } from "./types";

/**
 * One CSV field. Text that a spreadsheet would treat as a formula (starting with = + - @, tab or carriage return) is prefixed with an
 * apostrophe so it is shown as text and never executed (OWASP CSV injection guidance). Plain numbers are left alone.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function datasetToCsv(d: Dataset, useLabels = false): string {
  const n = nRows(d);
  const rows: unknown[][] = [];
  for (let i = 0; i < n; i++) rows.push(d.variables.map((v, j) => { const c = d.columns[j][i]; return useLabels && c !== null && v.valueLabels?.[String(c)] ? v.valueLabels[String(c)] : c; }));
  return toCsv(d.variables.map((v) => v.name), rows);
}

export function dictionaryRows(d: Dataset): { header: string[]; rows: unknown[][] } {
  return {
    header: ["Variable", "Label", "Type", "Measurement level", "Role", "Value labels", "Missing codes", "Valid min", "Valid max", "Formula", "Protocol link"],
    rows: d.variables.map((v) => [v.name, v.label ?? "", v.type, v.measure, v.role ?? "none",
      v.valueLabels ? Object.entries(v.valueLabels).map(([k, l]) => `${k}=${l}`).join("; ") : "", (v.missingCodes ?? []).join("; "),
      v.validMin ?? "", v.validMax ?? "", v.formula ?? "", v.protocolLink ?? ""]),
  };
}

export function tableToCsv(t: ResultTable): string { return toCsv(t.columns, t.rows); }

export function resultToCsv(r: AnalysisResult): string {
  return r.tables.map((t) => `${csvCell(t.title)}\r\n${tableToCsv(t)}${(t.notes ?? []).map((n) => `${csvCell(n)}\r\n`).join("")}`).join("\r\n");
}

// --- Reproducible Python ------------------------------------------------------------------------------------------------------------

const py = (s: string) => JSON.stringify(s);
const pyList = (a: string[]) => `[${a.map(py).join(", ")}]`;

/** Python for the data-cleaning log, so the exact steps can be rerun outside Toprot. Steps without a direct equivalent are noted. */
function opsToPython(ops: Operation[]): string[] {
  const out: string[] = [];
  for (const o of ops) {
    switch (o.op) {
      case "rename": out.push(`df = df.rename(columns={${py(o.from)}: ${py(o.to)}})`); break;
      case "delete_columns": out.push(`df = df.drop(columns=${pyList(o.names)})`); break;
      case "drop_duplicates": out.push(`df = df.drop_duplicates(${o.by?.length ? `subset=${pyList(o.by)}` : ""}).reset_index(drop=True)`); break;
      case "drop_missing": out.push(`df = df.dropna(subset=${pyList(o.names)}, how=${py(o.how)}).reset_index(drop=True)`); break;
      case "impute": out.push(o.method === "constant" ? `df[${py(o.name)}] = df[${py(o.name)}].fillna(${JSON.stringify(o.value)})` : `df[${py(o.name)}] = df[${py(o.name)}].fillna(df[${py(o.name)}].${o.method === "mode" ? "mode().iloc[0]" : `${o.method}()`})`); break;
      case "math": out.push(`df[${py(o.target)}] = ${{ ln: "np.log", log10: "np.log10", log2: "np.log2", log1p: "np.log1p", sqrt: "np.sqrt", square: "np.square", inverse: "1 / ", abs: "np.abs" }[o.fn]}(df[${py(o.name)}])`); break;
      case "standardize": out.push(o.method === "z" ? `df[${py(o.target)}] = (df[${py(o.name)}] - df[${py(o.name)}].mean()) / df[${py(o.name)}].std()` : o.method === "center" ? `df[${py(o.target)}] = df[${py(o.name)}] - df[${py(o.name)}].mean()` : `df[${py(o.target)}] = (df[${py(o.name)}] - df[${py(o.name)}].min()) / (df[${py(o.name)}].max() - df[${py(o.name)}].min())`); break;
      case "sort": out.push(`df = df.sort_values(${pyList(o.by.map((b) => b.name))}, ascending=[${o.by.map((b) => (b.desc ? "False" : "True")).join(", ")}], na_position="last").reset_index(drop=True)`); break;
      default: out.push(`# Step "${o.op}" was applied in Toprot Data Studio (${JSON.stringify(o).slice(0, 160)}). The version you export already contains its result.`);
    }
  }
  return out;
}

export function pythonScript(opts: { datasetName: string; versionNo: number; checksum: string; method: string; params: Record<string, unknown>; csvName: string; operations?: Operation[] }): string {
  const p = opts.params;
  const s = (k: string) => py(String(p[k]));
  const conf = Number(p.conf ?? 0.95);
  const L: string[] = [
    `# Reproducible analysis exported from Toprot Data Studio`,
    `# Dataset: ${opts.datasetName}, version ${opts.versionNo} (SHA-256 of canonical data: ${opts.checksum})`,
    `# Method: ${opts.method}. Parameters: ${JSON.stringify(p)}`,
    `# Requires: pandas, numpy, scipy, statsmodels. Results should match Toprot to within rounding.`,
    `import numpy as np`, `import pandas as pd`, `import scipy.stats as st`, `import statsmodels.api as sm`, `import statsmodels.formula.api as smf`, ``,
    `df = pd.read_csv(${py(opts.csvName)})  # the exported version of the dataset`,
  ];
  if (opts.operations?.length) L.push("", "# Cleaning steps already applied to this version, for the record:", ...opsToPython(opts.operations).map((l) => `# ${l}`));
  L.push("");
  const dropna = (cols: string[]) => `d = df[${pyList(cols)}].dropna()`;
  const Q = (n: string) => `Q(${py(n)})`;
  switch (opts.method) {
    case "describe": L.push(`print(df[${pyList(p.variables as string[])}].describe())`, ...(p.by ? [`print(df.groupby(${s("by")})[${pyList(p.variables as string[])}].describe())`] : []), `print(df[${pyList(p.variables as string[])}].skew(), df[${pyList(p.variables as string[])}].kurt())`); break;
    case "frequencies": for (const v of p.variables as string[]) L.push(`print(df[${py(v)}].value_counts(dropna=False).sort_index())`); break;
    case "normality": L.push(`print(st.shapiro(df[${s("variable")}].dropna()))`); break;
    case "crosstab": L.push(dropna([String(p.row), String(p.col)]), `tab = pd.crosstab(d[${s("row")}], d[${s("col")}])`, `print(tab)`, `print(st.chi2_contingency(tab, correction=${p.yates ? "True" : "False"}))`, `if tab.shape == (2, 2): print(st.fisher_exact(tab))`); break;
    case "ttest_one": L.push(`print(st.ttest_1samp(df[${s("variable")}].dropna(), ${Number(p.mu)}))`); break;
    case "ttest_ind": L.push(dropna([String(p.outcome), String(p.group)]), `groups = sorted(d[${s("group")}].unique())`, `a = d.loc[d[${s("group")}].astype(str) == ${p.levelA !== undefined ? s("levelA") : "str(groups[0])"}, ${s("outcome")}]`, `b = d.loc[d[${s("group")}].astype(str) == ${p.levelB !== undefined ? s("levelB") : "str(groups[1])"}, ${s("outcome")}]`, `print("Welch:", st.ttest_ind(a, b, equal_var=False))`, `print("Student:", st.ttest_ind(a, b, equal_var=True))`, `print("Levene (median):", st.levene(a, b, center="median"))`); break;
    case "ttest_paired": L.push(dropna([String(p.a), String(p.b)]), `print(st.ttest_rel(d[${s("a")}], d[${s("b")}]))`); break;
    case "anova_oneway": L.push(dropna([String(p.outcome), String(p.group)]), `print(st.f_oneway(*[g[${s("outcome")}] for _, g in d.groupby(${s("group")})]))`, `from statsmodels.stats.oneway import anova_oneway`, `print(anova_oneway(d[${s("outcome")}], d[${s("group")}], use_var="unequal"))`, `from statsmodels.stats.multicomp import pairwise_tukeyhsd`, `print(pairwise_tukeyhsd(d[${s("outcome")}], d[${s("group")}].astype(str), alpha=${(1 - conf).toFixed(3)}))`); break;
    case "mannwhitney": L.push(dropna([String(p.outcome), String(p.group)]), `groups = sorted(d[${s("group")}].unique())`, `a = d.loc[d[${s("group")}].astype(str) == ${p.levelA !== undefined ? s("levelA") : "str(groups[0])"}, ${s("outcome")}]`, `b = d.loc[d[${s("group")}].astype(str) == ${p.levelB !== undefined ? s("levelB") : "str(groups[1])"}, ${s("outcome")}]`, `print(st.mannwhitneyu(a, b, alternative="two-sided"))`); break;
    case "wilcoxon": L.push(dropna([String(p.a), String(p.b)]), `print(st.wilcoxon(d[${s("a")}] - d[${s("b")}]))`); break;
    case "kruskal": L.push(dropna([String(p.outcome), String(p.group)]), `print(st.kruskal(*[g[${s("outcome")}] for _, g in d.groupby(${s("group")})]))`); break;
    case "friedman": L.push(dropna(p.variables as string[]), `print(st.friedmanchisquare(*[d[c] for c in ${pyList(p.variables as string[])}]))`); break;
    case "correlation": L.push(`print(df[${pyList(p.variables as string[])}].corr(method=${s("method")}))`); break;
    case "linear_regression": {
      const terms = [...(p.predictors as string[]).map(Q), ...((p.polynomial as string[]) ?? []).map((v) => `I(${Q(v)}**2)`), ...((p.interactions as [string, string][]) ?? []).map(([a, b]) => `${Q(a)}:${Q(b)}`)];
      L.push(`# Text and nominal predictors: wrap them in C(...) to treat them as categorical, e.g. C(Q("group"), Treatment(reference="a")).`, `m = smf.ols(${py(`${Q(String(p.outcome))} ~ ${terms.join(" + ")}`)}, data=df).fit(${p.robust ? 'cov_type="HC3"' : ""})`, `print(m.summary())`); break;
    }
    case "logistic_regression": {
      const terms = [...(p.predictors as string[]).map(Q), ...((p.interactions as [string, string][]) ?? []).map(([a, b]) => `${Q(a)}:${Q(b)}`)];
      L.push(`df["_event"] = (df[${s("outcome")}].astype(str) == ${p.event !== undefined ? s("event") : "None"}).astype(float).where(df[${s("outcome")}].notna())`, `m = smf.logit(${py(`_event ~ ${terms.join(" + ")}`)}, data=df).fit()`, `print(m.summary())`, `print(np.exp(m.params), np.exp(m.conf_int(alpha=${(1 - conf).toFixed(3)})))`); break;
    }
    case "kaplan_meier": L.push(`from statsmodels.duration.survfunc import SurvfuncRight, survdiff`, dropna([String(p.time), String(p.event), ...(p.group ? [String(p.group)] : [])]), `print(SurvfuncRight(d[${s("time")}], d[${s("event")}]).summary())`, ...(p.group ? [`print(survdiff(d[${s("time")}], d[${s("event")}], d[${s("group")}]))`] : [])); break;
    case "cox": L.push(`from statsmodels.duration.hazard_regression import PHReg`, `m = PHReg.from_formula(${py(`${Q(String(p.time))} ~ ${(p.predictors as string[]).map(Q).join(" + ")}`)}, data=df.dropna(), status=df.dropna()[${s("event")}], ties="breslow").fit()`, `print(m.summary())`); break;
    case "kappa": L.push(`from statsmodels.stats.inter_rater import cohens_kappa`, dropna([String(p.a), String(p.b)]), `print(cohens_kappa(pd.crosstab(d[${s("a")}], d[${s("b")}])${p.weights && p.weights !== "none" ? `, wt=${s("weights")}` : ""}))`); break;
    case "table1": {
      const vars = p.variables as string[], med = (p.medianVars as string[]) ?? [], dp = Number(p.decimals ?? 1);
      L.push(`d = df${p.by ? `.dropna(subset=[${s("by")}])` : ""}`, `groups = [("Overall", d)]${p.by ? ` + [(str(k), g) for k, g in d.groupby(${s("by")})]` : ""}`, `rows = []`,
        `for v in ${pyList(vars)}:`,
        `    for name, g in groups:`,
        `        x = g[v]`,
        `        if v in ${pyList(med)}: cell = f"{x.median():.${dp}f} [{x.quantile(0.25):.${dp}f}, {x.quantile(0.75):.${dp}f}]"`,
        `        elif pd.api.types.is_numeric_dtype(x) and x.nunique() > 2: cell = f"{x.mean():.${dp}f} ({x.std():.${dp}f})"`,
        `        else: cell = "; ".join(f"{k}: {n} ({100 * n / x.notna().sum():.${dp}f}%)" for k, n in x.value_counts().sort_index().items())`,
        `        rows.append((v, name, cell, int(x.isna().sum())))`,
        `print(pd.DataFrame(rows, columns=["variable", "group", "summary", "missing"]).pivot(index="variable", columns="group"))`);
      if (p.pvalues && p.by) L.push(`# p-values: Welch t-test or Welch ANOVA (mean rows), Mann-Whitney or Kruskal-Wallis (median rows), chi-square or Fisher's exact (categorical rows).`);
      break;
    }
    case "anova_factorial": {
      const fac = (p.factors as string[]).map((f) => `C(${Q(f)}, Sum)`), covs = ((p.covariates as string[]) ?? []).map(Q);
      L.push(`from statsmodels.stats.anova import anova_lm`, `m = smf.ols(${py(`${Q(String(p.outcome))} ~ ${fac.join(p.interactions === false ? " + " : " * ")}${covs.length ? ` + ${covs.join(" + ")}` : ""}`)}, data=df).fit()`, `print(anova_lm(m, typ=${p.ssType === "2" ? 2 : 3}))`);
      if (covs.length) L.push(`# Homogeneity of slopes: add factor x covariate terms and test them`, `ms = smf.ols(${py(`${Q(String(p.outcome))} ~ ${fac.join(p.interactions === false ? " + " : " * ")} + ${covs.join(" + ")} + ${fac.flatMap((f) => covs.map((c) => `${f}:${c}`)).join(" + ")}`)}, data=df).fit()`, `print(anova_lm(ms, typ=3))`);
      break;
    }
    case "glm": {
      const terms = [...(p.predictors as string[]).map(Q), ...((p.interactions as [string, string][]) ?? []).map(([a, b]) => `${Q(a)}:${Q(b)}`)];
      const f = py(`${Q(String(p.outcome))} ~ ${terms.join(" + ")}`);
      const cols = [String(p.outcome), ...(p.predictors as string[]), ...(p.exposure ? [String(p.exposure)] : [])];
      L.push(dropna(cols), ...(p.exposure ? [`off = np.log(d[${s("exposure")}])`] : []));
      const fitArgs = p.robust ? `cov_type="HC0"` : "";
      if (p.family === "negbin") L.push(`m = smf.negativebinomial(${f}, data=d${p.exposure ? ", offset=off" : ""}, loglike_method="nb2").fit(method="newton", maxiter=200${fitArgs ? `, ${fitArgs}` : ""})`);
      else L.push(`m = smf.glm(${f}, data=d, family=sm.families.${p.family === "gamma" ? "Gamma(link=sm.families.links.Log())" : "Poisson()"}${p.exposure ? ", offset=off" : ""}).fit(${fitArgs})`);
      L.push(`print(m.summary())`, `print(np.exp(m.params), np.exp(m.conf_int(alpha=${(1 - conf).toFixed(3)})))`);
      break;
    }
    case "multinomial_logistic": {
      L.push(dropna([String(p.outcome), ...(p.predictors as string[])]), `# The reference category is the first in sorted order${p.reference !== undefined ? `; reorder so ${s("reference")} comes first` : ""}.`,
        `cats = sorted(d[${s("outcome")}].astype(str).unique())${p.reference !== undefined ? `\ncats.remove(${s("reference")}); cats.insert(0, ${s("reference")})` : ""}`,
        `d["_y"] = d[${s("outcome")}].astype(str).map({c: i for i, c in enumerate(cats)})`,
        `m = smf.mnlogit(${py(`_y ~ ${(p.predictors as string[]).map(Q).join(" + ")}`)}, data=d).fit(method="newton")`, `print(m.summary())`, `print(np.exp(m.params))`);
      break;
    }
    case "ordinal_logistic": {
      L.push(`from statsmodels.miscmodels.ordinal_model import OrderedModel`, dropna([String(p.outcome), ...(p.predictors as string[])]),
        `y = pd.Categorical(d[${s("outcome")}], ordered=True)  # categories in sorted order`,
        `X = pd.get_dummies(d[${pyList(p.predictors as string[])}], drop_first=True, dtype=float)`,
        `m = OrderedModel(y, X, distr="logit").fit(method="bfgs", maxiter=1000)`, `print(m.summary())`, `print(np.exp(m.params[:X.shape[1]]))`);
      break;
    }
    case "pca": L.push(dropna(p.variables as string[]), `R = np.corrcoef(d.values, rowvar=False)`, `ev, vec = np.linalg.eigh(R)`, `order = np.argsort(ev)[::-1]; ev, vec = ev[order], vec[:, order]`, `print("eigenvalues", ev, "explained", ev / ev.sum())`, `print(pd.DataFrame(vec * np.sqrt(ev), index=d.columns))  # loadings (signs may differ)`); break;
    case "bootstrap_ci": L.push(`x = df[${s("variable")}].dropna().to_numpy()`, `# Toprot draws resamples with the mulberry32 generator (seed ${Number(p.seed ?? 20261124)}); NumPy's generator differs, so intervals agree within Monte Carlo error.`, ...(["mean", "median"].filter((st) => p.statistic === st || !p.statistic || p.statistic === "both").map((st) => `print(${py(st)}, st.bootstrap((x,), np.${st}, n_resamples=${Number(p.replicates ?? 2000)}, confidence_level=${conf}, method="BCa", random_state=${Number(p.seed ?? 20261124)}).confidence_interval)`))); break;
    case "permutation_test": L.push(dropna([String(p.outcome), String(p.group)]), `groups = sorted(d[${s("group")}].unique())`, `a = d.loc[d[${s("group")}].astype(str) == ${p.levelA !== undefined ? s("levelA") : "str(groups[0])"}, ${s("outcome")}]`, `b = d.loc[d[${s("group")}].astype(str) == ${p.levelB !== undefined ? s("levelB") : "str(groups[1])"}, ${s("outcome")}]`, `res = st.permutation_test((a, b), lambda u, v, axis=-1: np.abs(np.mean(u, axis=axis) - np.mean(v, axis=axis)), permutation_type="independent", alternative="greater", n_resamples=${Number(p.permutations ?? 10000)}, vectorized=True, random_state=${Number(p.seed ?? 20261124)})`, `print(res.statistic, res.pvalue)  # exact when n_resamples covers every relabelling`); break;
    case "standardization": {
      const pop = p.population ? s("population") : null;
      L.push(`d = df.copy()`, ...(pop ? [] : [`d["_pop"] = 1.0`]), `popcol = ${pop ?? '"_pop"'}`, `keys = [${s("stratum")}]${p.group ? ` + [${s("group")}]` : ""}`,
        `agg = d.groupby(keys).agg(events=(${s("events")}, "sum"), pop=(popcol, "sum")).reset_index()`,
        `pooled = agg.groupby(${s("stratum")})[["events", "pop"]].sum()`,
        `std_pop = ${p.stdPop ? `d.groupby(${s("stratum")})[${s("stdPop")}].first()` : `pooled["pop"]  # pooled population as the standard`}`,
        `std_rate = ${p.stdRate ? `d.groupby(${s("stratum")})[${s("stdRate")}].first()` : p.refGroup !== undefined && p.group ? `(lambda r: r["events"] / r["pop"])(agg[agg[${s("group")}].astype(str) == ${s("refGroup")}].groupby(${s("stratum")})[["events", "pop"]].sum())  # reference-group rates` : `pooled["events"] / pooled["pop"]  # pooled rates as the standard`}`,
        `w = std_pop / std_pop.sum(); a = ${(1 - conf).toFixed(3)}; mult = ${Number(p.multiplier ?? 100000)}`,
        `for g, sub in (${p.group ? `agg.groupby(${s("group")})` : `[("All", agg)]`}):`,
        `    sub = sub.groupby(${s("stratum")})[["events", "pop"]].sum().reindex(w.index)`,
        `    r = sub["events"] / sub["pop"]; dsr = (w * r).sum(); var = (w ** 2 * sub["events"] / sub["pop"] ** 2).sum(); wm = (w / sub["pop"]).max()`,
        `    lo = st.gamma.ppf(a / 2, dsr ** 2 / var, scale=var / dsr); hi = st.gamma.ppf(1 - a / 2, (dsr + wm) ** 2 / (var + wm ** 2), scale=(var + wm ** 2) / (dsr + wm))`,
        `    O = sub["events"].sum(); E = (sub["pop"] * std_rate).sum()`,
        `    print(g, "direct rate", mult * dsr, (mult * lo, mult * hi), "SMR", O / E, (st.chi2.ppf(a / 2, 2 * O) / (2 * E), st.chi2.ppf(1 - a / 2, 2 * O + 2) / (2 * E)))`);
      break;
    }
    default: L.push(`# No Python template for "${opts.method}" yet. The parameters above fully specify the analysis.`);
  }
  return L.join("\n") + "\n";
}

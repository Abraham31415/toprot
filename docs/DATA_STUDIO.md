# Toprot Data Studio

Code: `frontend/src/lib/datastudio/` (engine, data layer), `frontend/src/components/datastudio/` (interface),
`frontend/src/app/studies/[id]/data/` (pages and server actions), `frontend/src/app/data-studio/` (navigation entry).
Schema: `supabase/migrations/20261126090000_data_studio.sql`.

This document is the architecture audit, the design record, the deployment guide and the implementation status report.

---

## 1. Architecture audit (what existed before Data Studio)

| Area | Found | Reused? |
|---|---|---|
| Frontend | Next.js 16 App Router, React 19, TypeScript, Tailwind v4 semantic tokens, Lucide icons, `components/ds` design system | Yes: same tokens, `Button`, layout patterns, `AppFrame`/`AppShell`, `StudyNav` |
| Backend | Next.js server actions and route handlers on Vercel; a small Python FastAPI service on Render's **free** plan (`service/`) for document generation and sample sizes | Server actions only. The Python service was **not** used (see decision D1) |
| Database / auth | Supabase Postgres, Supabase Auth, row level security everywhere, migrations in `supabase/migrations` | Yes |
| Permissions | `public.study_role()` is the single source of truth; `can_read_study` / `can_write_study` in RLS; `requireProject()` in `lib/collab/access.ts` on the server | Yes, unchanged. Data Studio adds no new permission system |
| Statistics | `lib/stats/` (TypeScript, jStat distributions): t-tests, chi-square, Fisher, ANOVA, Tukey, Pearson/Spearman, simple regressions, epidemiology 2x2, diagnostics, 20+ sample-size methods, **validated against SciPy/statsmodels** (`scripts/gen_stats_reference.py`) | Yes: extended, never replaced |
| Sample size / power | Complete calculators under `/tools` (`lib/tools`, `lib/stats/samplesize.ts`) | Linked from Data Studio, not duplicated |
| Visualisation | None (no chart library in the bundle) | New dependency-free SVG renderer |
| Manuscripts | TipTap editor (`components/writing`), HTML paste supported, Word export | Integration by HTML copy/paste of tables (see status) |
| AI | `lib/ai/runAiOperation`: credit reservation, metering in Postgres, model routing, per-feature config in `ai_features`, plan gating in `ai_reserve` | Yes: new feature key `data_analyst` |
| Billing / plans | Plans `free`, `pro`, `team` as rows (`plans`), limits in data, `billing_user_plan()`, `collab_project_plan()` | Yes: new `ds_plan_limits` table keyed by `plans` |
| Storage | Private Supabase Storage buckets with RLS on `storage.objects` | Yes: two new private buckets |
| Tests | Vitest; DB tests against a scratch Postgres with every migration applied (`AdminDb` harness) | Yes |
| Hosting limits | Vercel serverless (request body 4.5 MB; server-action body 1 MB by default); Render free tier sleeps and has 512 MB RAM | Shaped decisions D1 to D3 |

What was missing: dataset storage and versioning, file import, a data editor, profiling, data cleaning, multivariable models,
nonparametric tests, survival analysis, reliability statistics, charts, result persistence, reporting and AI interpretation of results.

## 2. Architecture decisions

**D1. Compute runs in TypeScript on the Next.js server, not in the Python service.** The existing statistics engine is TypeScript and already
validated against SciPy. The Python service runs on Render's free plan (cold starts of up to a minute, 512 MB RAM, no job queue), which is
not acceptable for interactive analysis and would need a paid plan plus a job system. Datasets are bounded by plan limits (100,000 rows
and 500 variables at most), and every method completes in milliseconds to a few seconds at that size, so analyses run synchronously in
a server action with per-user rate limits and a daily quota. Bootstrap and permutation methods also run here: they are capped at
20,000 resamples and 100,000 relabellings, which take well under a few seconds at plan limits. *Revisit when:* mixed models, GEE or
multiple imputation are added (they are heavier and better served by statsmodels/R in an isolated worker with a queue).

**D2. The server is the only writer.** The browser can read Data Studio tables through RLS but cannot insert or update them, and cannot touch
the data bucket. Server actions check the project role, re-parse uploads, replay cleaning steps and recompute statistics before storing
anything. A stored checksum or result therefore never comes from the browser. (The browser preview uses the same code paths, but its output is
never trusted.)

**D3. Uploads go straight to Storage.** Files are uploaded by the browser to `ds-uploads/<study>/<user>/…` (RLS: own folder, writable
projects only), then the server downloads, validates and deletes them. This avoids the 1 MB server-action and 4.5 MB Vercel body limits
without raising them globally.

**D4. Immutable, checksummed versions.** Each version is canonical JSON, gzip-compressed, stored at `ds-data/<study>/<dataset>/<version>.json.gz`,
with a SHA-256 checksum of the canonical form. Reading verifies the checksum. Versions cannot be updated (trigger), "restore" creates a new
version, and moving the "current" pointer is compare-and-set so concurrent editors cannot overwrite each other. Analyses reference a version.

**D5. Analysis definitions drive the interface.** `engine/registry.ts` lists each method's fields, tier and assumptions; the form is generated
from it and the server validates against the same definitions (`engine/params.ts`).

**D6. Numbers never come from an LLM.** The AI analyst receives the rendered result (tables, estimates, diagnostics, variable names and
labels) and never data rows. After answering, every number in its text is checked against the numbers it was given; untraceable numbers are
shown to the user as a warning. AI usage is metered by the existing credit system; analyses consume no AI credits.

**D7. No new paid services or heavy dependencies.** XLSX reading, charts, CSV handling and linear algebra are implemented in-repo (about
2,000 lines in total) rather than adding SheetJS (licence and CVE history), Plotly (3 MB) or a numerics library.

## 3. Data model

| Table | Purpose |
|---|---|
| `ds_plan_limits` | Per-plan limits: datasets per project, rows, columns, upload size, project storage, versions per dataset, analyses per day, method tier, export formats |
| `ds_datasets` | A named dataset in a project; `current_version_id`; soft delete (`deleted_at`) |
| `ds_versions` | Immutable versions: number, parent, storage path, SHA-256, size, variable dictionary, cleaning operations applied, import report, engine version, creator |
| `ds_analyses` | Saved analyses: method, validated settings, structured result, engine version, duration, version reference. Result/config immutable; title and pin editable |
| `ds_charts` | Saved chart specifications (chart + style), tied to a version |
| `ds_usage` | Compute metering (imports, versions, analyses, failed analyses, exports). Not visible to browsers |

Functions: `ds_project_limits(study)`, `ds_meter_analysis(actor, study, method, ms, failed)` (atomic check-and-record),
`ds_project_bytes(study)`, `ds_admin_overview(days)` (aggregates only, no research data). All are service-role only.
Triggers: version immutability and consistency, dataset-count limit (advisory-locked), analysis-result immutability.
Audit: imports, versions, restores, merges, deletions and exports are written to the existing `collab_events` log via `collab_log`.

## 4. Statistical methods and validation

Conventions: SD with n - 1; quantiles R type 7; skewness/kurtosis bias-adjusted (SPSS/SciPy `bias=False`); CIs t-based for means, Wilson for
proportions, log/Woolf for ratios; complete-case analysis with the number excluded always reported; AIC/BIC count regression coefficients only
(statsmodels and Stata convention; R adds 2 for the residual variance).

| Method | Validated against | Tolerance |
|---|---|---|
| Descriptives (mean, SD, quartiles, CI, skewness, kurtosis) | NumPy / SciPy | 1e-8 relative |
| Shapiro-Wilk (Royston AS R94), n = 3 to 200 | SciPy `shapiro` | W 1e-6, p 1e-5 |
| Levene (median), Welch ANOVA | SciPy, statsmodels `anova_oneway` | 1e-8 / 1e-7 |
| Mann-Whitney (exact and asymptotic), Wilcoxon signed-rank (exact and approximate), Kruskal-Wallis, Friedman | SciPy | 1e-8 to 1e-10 |
| Kendall tau-b, partial correlation, Bonferroni/Holm/BH | SciPy, statsmodels `multipletests` | 1e-8 |
| OLS: coefficients, SEs, p, CIs, R², adj R², F, AIC, BIC, log-likelihood, HC3 SEs, Breusch-Pagan, VIF, Cook's D, Durbin-Watson, interactions | statsmodels `OLS` | 1e-8 (CIs 1e-7: jStat t-quantile precision) |
| Logistic regression: coefficients, SEs, p, LL, LR test, McFadden R², AIC, AUC | statsmodels `Logit` | 1e-6 to 1e-9 |
| Likelihood-ratio chi-square; Mantel-Haenszel OR, RGB CI, MH test, Breslow-Day | SciPy, statsmodels `StratifiedTable` | 1e-6 to 1e-8 |
| Cohen's kappa (unweighted, linear, quadratic, SE, CI), Fleiss' kappa | statsmodels `inter_rater` | 1e-7 |
| Kaplan-Meier with Greenwood SE, log-rank, Cox PH (Breslow) | statsmodels `SurvfuncRight`, `survdiff`, `PHReg` | 1e-6 to 1e-10 |
| Cronbach's alpha, ICC1/ICC2/ICC3 point estimates | Explicit two-way ANOVA in NumPy | 1e-8 |
| Factorial ANOVA and ANCOVA: Type II and Type III sums of squares, F, p (two-way with covariate, three-way), homogeneity-of-slopes tests, covariate slope | statsmodels `anova_lm` (`C(x, Sum)` coding) | SS and F 1e-8, p 1e-7, df exact |
| Poisson GLM with offset: coefficients, SEs, log-likelihood, deviance, Pearson chi-square, AIC, HC0 robust SEs | statsmodels `GLM(Poisson)` | 1e-8 |
| Gamma GLM (log link): coefficients, SEs, scale, log-likelihood, deviance, Pearson, AIC, HC0 robust SEs | statsmodels `GLM(Gamma(Log))` | 1e-8 (HC0 1e-7) |
| Negative binomial NB2 with offset: coefficients, alpha, SEs (incl. alpha), log-likelihood, AIC, deviance, HC0 robust SEs | statsmodels `NegativeBinomial(nb2)` (Newton) | coefficients and alpha 1e-7, SEs 1e-6, log-likelihood and AIC 1e-9 |
| Multinomial logistic: coefficients, SEs, log-likelihood, null log-likelihood, LR test, AIC | statsmodels `MNLogit` | coefficients and SEs 1e-7, log-likelihoods 1e-9 (statsmodels fits the null model iteratively; ours is closed form) |
| Ordinal (proportional-odds) logistic: slopes, thresholds, log-likelihood, AIC, slope SEs | statsmodels `OrderedModel(distr="logit")` | estimates 1e-7, log-likelihood 1e-10, SEs 1e-5 (statsmodels uses a numerical Hessian) |
| PCA: eigenvalues, loadings (sign-normalised), Bartlett's sphericity test, KMO | NumPy `eigh` / explicit formulas | eigenvalues 1e-10, loadings 1e-8, Bartlett 1e-9, KMO 1e-10 |
| Bootstrap (mean, median): resamples, SE, percentile and BCa intervals | Bit-for-bit Python port of the engine's seeded generator; BCa from SciPy's own `_bca_interval` on the same resamples; independently, `scipy.stats.bootstrap` (different generator) | resamples and percentile 1e-12, BCa 1e-8; SciPy Monte Carlo BCa within 3% |
| Permutation test (difference in means): exact and Monte Carlo p | `scipy.stats.permutation_test` (exact, 1,716 relabellings); Python port of the generator (Monte Carlo); SciPy Monte Carlo | exact 1e-12; Monte Carlo identical to the port, within 0.01 of SciPy's |
| Direct standardisation (Fay-Feuer gamma CI, as R `epitools::ageadjust.direct`), indirect standardisation (SMR, exact Poisson CI and test) | SciPy `gamma`, `chi2`, `poisson` | rate 1e-12, CIs and p 1e-7 |
| Games-Howell p-values and Welch df | SciPy `studentized_range` (independent of jStat's Tukey distribution) | df 1e-8, p 1e-6 |
| ICC1/2/3 (single and average) with CIs; Cronbach's alpha and its Feldt CI | Published example: Shrout & Fleiss (1979) Table 4 (6 targets, 4 judges) and the CIs printed by R `psych::ICC` for the same data; alpha = ICC(3,k) identity | Published values to 2 decimals (±0.005); identity 1e-10 |
| AUC and DeLong SE | Published example: Hanley & McNeil (1982) rating data (AUC 0.893); DeLong SE from an independent midrank implementation (Sun & Xu 2014) in NumPy | AUC ±0.0005 of the published value; SE 1e-10 |
| Hosmer-Lemeshow (deciles of risk) | Independent NumPy recomputation only (see below) | 1e-6 |
| Existing `lib/stats` methods (t-tests, chi-square, Fisher, ANOVA, Tukey, epi 2x2, diagnostics, sample sizes) | SciPy/statsmodels (pre-existing suite) | unchanged |

Reference values: `frontend/scripts/gen_datastudio_reference.py` (SciPy 1.13.1, statsmodels 0.14.6; versions recorded in the JSON).
The second batch of references uses its own random generator, so earlier reference values are unchanged.

External checks: R is not installed in the build environment, so the methods that had no statsmodels equivalent were checked against
published worked examples (cited in `engine-reference.test.ts`) or an independent implementation, as listed above. Limits of those checks:
- The ICC and alpha intervals are checked to the two decimals printed in the published sources, not to full precision.
- Hosmer-Lemeshow is checked only against an independent NumPy implementation of the same grouping (deciles by sorted position). R's
  `ResourceSelection::hoslem.test` groups by quantile cut points instead, which gives different groups when predicted risks are tied, so the
  statistic is not expected to match it exactly. It has not been compared with R.
- Still not externally validated (implemented from published formulas, covered by behaviour tests): Hedges-Olkin CI for d, McNemar,
  Cochran's Q, sign test, Bland-Altman CIs, Harrell's C, and the informal proportional-odds check (separate binary logits; a Brant test is
  not computed). These should be checked against R (`exact2x2`, `DescTools`, `BlandAltmanLeh`, `survival`) when R is available.

Edge cases with automated tests (`__tests__/runners.test.ts`): empty and all-missing data, constant variables, perfect multicollinearity
(the offending term is named), too few observations for the model, logistic separation, sparse tables (Fisher recommended), zero events,
zero cells (corrected and disclosed), invalid types and unknown variables, values near 1e12, extreme outliers (reported, never removed),
duplicate identifiers and suspicious missing codes (import and profile); for the second batch: Table 1 with missing values, p-values off
by default and a single-category group refused; empty factorial cells with interactions refused (with the reason); negative or fractional
counts, non-positive gamma outcomes and non-positive exposures refused; Poisson overdispersion flagged; a negative binomial model with no
overdispersion refused in favour of Poisson; fewer than three outcome categories and separation in multinomial and ordinal models; a constant
variable in PCA named; identical results from the same seed and different results from a different seed; exact permutation p-values for small
groups; standardisation without a standard, or with a standard that varies within a stratum, refused. A failed method returns a clear reason
and no partial result.

## 5. Plans and quotas

Seeded in `ds_plan_limits` (edit with SQL; nothing is hard-coded):

Statistical methods follow the researcher's **subscription tier**. Teams adds collaboration (shared projects and datasets, team workspaces,
role-based permissions, team administration), not exclusive access to statistical methods, so Teams has exactly the statistics of Advanced.

| | Free | Pro | Advanced | Team |
|---|---|---|---|---|
| Datasets per project | 3 | 25 | 50 | 100 |
| Rows / variables | 5,000 / 100 | 100,000 / 500 | 250,000 / 1,000 | 100,000 / 500 |
| Cells per dataset (all plans, fixed in code) | 3,000,000 | 3,000,000 | 3,000,000 | 3,000,000 |
| Upload size | 5 MB | 25 MB | 50 MB | 25 MB |
| Project storage | 25 MB | 500 MB | 1 GB | 2 GB |
| Versions per dataset | 20 | 200 | 500 | 500 |
| Analyses per person per project per day | 60 | 600 | 1,500 | 3,000 |
| Method tier | basic | standard | advanced | advanced |
| Methods | descriptives, Table 1, frequencies, normality, crosstabs, t-tests, one-way ANOVA, nonparametric tests, correlation | + linear, logistic, multinomial and ordinal regression, Poisson/negative binomial/gamma GLMs, factorial ANOVA and ANCOVA, epidemiology 2x2, age standardisation and SMR, diagnostic accuracy, ROC, kappa, **reliability (alpha, ICC), Bland-Altman**, Friedman, McNemar, Cochran's Q, partial correlation, bootstrap CIs, permutation tests | every method: + survival (Kaplan-Meier, log-rank, Cox), Mantel-Haenszel, PCA | same as Advanced |
| Exports | CSV | CSV, SVG, PNG, Python | CSV, SVG, PNG, Python | CSV, SVG, PNG, Python |
| AI analyst | no | yes (AI credits) | yes (AI credits) | yes (AI credits) |

**Where entitlements live.** `frontend/src/lib/datastudio/entitlements.ts` is the single place that compares tiers: `canUseMethod` (browser
locks), `checkMethodAccess` (the `runAnalysisAction` server action, before any data is loaded or metered), `upgradePrompt`, and
`planComparison` (pricing page). The tier each method needs is its `tier` in `engine/registry.ts`; the tier each plan grants is
`ds_plan_limits.method_tier`, which must equal `PLAN_METHOD_TIER` (tested in `data-studio.db.test.ts`). An unrecognised tier is treated as
`basic`. Tests: `entitlements.test.ts` (full method x plan matrix), `run-action-entitlements.test.ts` (server action refuses per plan).

The limits that apply are those of the plan governing the **project** (`collab_project_plan`), so collaborators work within the owner's or
team's plan. The **Advanced** plan (`plan_key = 'advanced'`, created by `20261127090000`, configured by `20261128090000_subscription_plans_final.sql`)
is priced at $15.99 but **inactive**: it is shown on the pricing page as not yet open and cannot be bought until the provider products are
mapped and tested (docs/billing.md). Advanced's 250,000 rows x 1,000 variables are still bounded by the fixed 3,000,000-cell limit per
dataset. Analyses and charts never use AI credits; only the AI analyst does.

```sql
update ds_plan_limits set max_rows = 20000 where plan_key = 'free';
update ds_plan_limits set exports = array['csv','svg'] where plan_key = 'free';
update ai_features set enabled = false where feature_key = 'data_analyst';   -- AI analyst kill switch
select ds_admin_overview(30);                                              -- usage without research data
```

## 6. Security and privacy

- Authentication from the session cookie; project role checked server-side on every action (`requireProject`), backed by the same database
  function as RLS. Deleting a dataset or a saved result requires the owner role; typing the dataset name confirms deletion.
- Browser writes to every Data Studio table and the data bucket are revoked (tested). Uploads: own folder only, writable projects only (tested).
- Upload validation: extension allow-list, magic-byte sniffing (binary-as-text and OLE/zip mismatches refused), size limit before and after
  upload, zip-bomb guards in the XLSX reader (declared size, entry count, total expansion), row/column limits enforced during parsing.
- Expressions for computed variables and filters use an in-repo parser and evaluator; nothing reaches `eval` or `Function` (tested).
- CSV exports neutralise formula injection (`= + - @` tab and CR prefixes) while leaving numbers alone (tested).
- Raw uploads are deleted after import; deleted datasets have their files removed from storage.
- No user-supplied code is executed anywhere. Python scripts are exported for the user to run themselves.
- AI: aggregated results only; the exact text sent is shown to the user; untrusted user context is length-limited and passed through the
  existing injection detector; output numbers are verified.

## 7. Deployment

1. Apply `supabase/migrations/20261126090000_data_studio.sql` (Supabase SQL editor or `supabase db push`). It creates tables, functions,
   policies and the two private buckets, seeds `ds_plan_limits` for existing plans, and adds the `data_analyst` AI feature to Pro and Team.
   It does not modify existing tables or rows other than appending `data_analyst` to the Pro and Team `ai_features` arrays.
2. Deploy the frontend as usual. No new environment variables. The AI analyst needs the existing `ANTHROPIC_API_KEY`.
3. Check: open a project, Data Studio tab, import a CSV, run descriptive statistics, open Results.

Rollback: the feature is additive. Hiding it means removing the two navigation entries; dropping it means dropping the `ds_*` tables, the
functions, the two buckets and the `data_analyst` feature row.

## 8. Running the tests

```bash
cd frontend
npx vitest run src/lib/datastudio            # engine, data layer, AI grounding, DB schema (needs the scratch Postgres for the .db test)
python scripts/gen_datastudio_reference.py   # regenerate reference values (needs scipy and statsmodels)
```

## 9. Implementation status

Legend: **Done** = interface, server logic, validation, persistence and automated tests. **Partial** = usable but with a stated gap.
**Deferred** = not built; nothing in the interface claims it.

### Done
- Data Studio navigation (main sidebar and project tab), project-scoped datasets, permissions, plan limits, metering, audit events.
- Import: CSV, TSV, TXT, XLSX (multi-sheet, dates, shared/inline strings), JSON (records or columns). Encoding detection (BOM, UTF-8
  validation, Windows-1252 fallback), delimiter detection, header option, skip rows, decimal comma, day/month order, type overrides,
  missing tokens, duplicate names, sanitised names with original header kept as label, ID detection, suspicious missing codes, mostly-numeric
  text, ragged rows, duplicate rows, all-empty columns, preview before import.
- Spreadsheet view: virtualised rows, sort, find, missing-only filter, inline editing, keyboard navigation, delete, copy, paste a block,
  value labels shown, missing and out-of-range highlighting. Variable view with every property editable.
- Data dictionary (variable view plus CSV export), quality profile (missingness, distributions, outliers, invalid ranges, inconsistent
  spelling, sparse categories, duplicates, identical variables).
- Cleaning: compute (safe expressions, 33 functions), recode (values, ranges, missing), bands, standardise/normalise/centre, log and other
  transforms, outlier flags (never deletion), single imputation with indicator, replace, text clean-up, filter, remove duplicates, remove
  missing, sort, insert/delete rows and variables, rename, type conversion, wide-to-long, long-to-wide, merge (left/inner, many-to-one) and
  append. Each with preview, confirmation for destructive steps, undo/redo, a description, and a replayable log.
- Versioning: immutable checksummed versions, history with steps, view any version, restore, concurrent-edit protection.
- 36 analyses (section 4), with assumption checks, effect sizes, warnings, charts and generated methods text; rules-based test-selection
  guide with design questions and causal caveats.
- Table 1 builder (`table1`): chosen variables overall and by an optional group; mean (SD) or median [Q1, Q3] chosen per variable; n (%)
  for categorical variables; missing counts; decimal places; optional p-values (off by default) with the test named on each row (Welch t-test
  or Welch ANOVA, Mann-Whitney or Kruskal-Wallis, chi-square, or Fisher's exact for sparse 2x2 tables). Exports through the result tables.
- Factorial ANOVA and ANCOVA (`anova_factorial`): up to four factors with all interactions, covariates, Type II or Type III sums of squares
  (stated in the table title and key results), partial eta-squared, cell statistics, Levene's test on residuals, and a homogeneity-of-slopes
  test for each factor × covariate pair.
- Generalized linear models (`glm`): Poisson, negative binomial (NB2, alpha by maximum likelihood) and gamma with a log link; exposure
  offsets; rate ratios (ratios of means for gamma); HC0 sandwich SEs; deviance, Pearson chi-square / df, AIC, BIC, LR test; overdispersion
  and excess-zero checks for Poisson; a boundary-corrected LR test of alpha = 0 for negative binomial.
- Multinomial logistic (`multinomial_logistic`, chosen reference category, joint Wald tests per term) and ordinal proportional-odds logistic
  (`ordinal_logistic`, thresholds and an informal proportional-odds check).
- PCA (`pca`) on standardized variables: eigenvalues, explained variance, loadings, communalities, scree plot, Bartlett's test and KMO.
- Bootstrap CIs for the mean and median (`bootstrap_ci`, BCa and percentile) and a two-group permutation test (`permutation_test`, exact when
  feasible, otherwise Monte Carlo). Both use the seeded mulberry32 generator; the seed is a form field, stored with the settings, shown in the
  result and in the methods text, so results reproduce exactly.
- Direct and indirect standardisation with SMRs (`standardization`) on dataset variables (events, population or person-time, strata,
  optional groups, a standard population or standard rates, or the pooled data or a reference group as the standard).
- Python export templates for every method above (statsmodels/SciPy code that reproduces the analysis).
- Results: history with pinning, version tracking with "computed on older data" warning, re-run on the current version, reporting styles
  (decimals, p-value style, leading zero) that never alter stored results, copy tables as HTML for Word or the manuscript editor, CSV,
  reproducibility record (method, settings, version, checksum, engine), Python script export.
- Visualisation: histogram (with normal curve), bar (counts, percent, mean, grouped), box, means with CI, scatter (with fit), Q-Q, correlation
  heatmap; analysis charts add KM curves with CIs and censoring, ROC, forest plots, residual plots, Bland-Altman. Editor for titles, labels,
  fonts, sizes, palettes (colour-blind safe and grayscale), line and marker sizes, axis limits, grid, legend; style templates; SVG and PNG at
  96/300/600 dpi.
- AI Research Analyst: five tasks, grounded in saved results, credits metered, number verification, "what was sent" disclosure.

### Partial
- **Manuscript integration**: tables and methods text are copied as HTML into the editor. There is no live link between a manuscript table and
  its analysis yet, so outdated tables are flagged only inside Data Studio ("computed on version N"), not inside the manuscript.
- **Comments on outputs / supervisor feedback**: reviewers can read every dataset, result and chart under existing project permissions; there is
  no comment thread on a result yet (project discussion remains the place for feedback).
- **Charts**: violin, density, pair plot, bubble, line/longitudinal trend, funnel and calibration plots are not built; multi-panel layouts are not
  built. PDF export is via the SVG (vector) rather than a direct PDF file.
- **Cox model**: proportional-hazards diagnostics (Schoenfeld residuals) are not computed; the interface says so.
- **Report generation**: results export as CSV/HTML/Python; a single assembled Word/PDF analysis report is not built.
- **Admin visibility**: `ds_admin_overview()` exists; it is not yet shown on the `/admin` pages.

### Deferred (with reason)
- SPSS (.sav/.por), Stata (.dta), Parquet and .xls import: need a reader library or the Python service (pyreadstat/pyarrow). The import
  screen explains how to export CSV instead. Value labels from SPSS/Stata are therefore not imported.
- Repeated-measures ANOVA, MANOVA, mixed models, GEE, time-varying Cox covariates: need validated implementations
  (statsmodels-equivalent) and, for some, a worker (decision D1). The test guide states these are not yet available when it would recommend them.
- Factor analysis (with rotation), propensity scores, multiple imputation, mediation and moderation, interrupted time series, survey
  weighting, meta-analysis. Zero-inflated count models. A formal Brant test for the proportional-odds assumption.
- Analysis pipelines (saved, re-runnable chains across datasets). Today: cleaning logs replay on save, analyses re-run on new versions, and
  settings export as Python.
- Background job queue, cancellation and progress for long jobs (not needed at current limits; see D1).
- Arbitrary user code execution (R or Python). Deliberately not built: it needs an isolated sandbox service.
- Datasets larger than 3 million cells: the whole version is loaded into the browser, so `MAX_CELLS` in `lib/datastudio/server.ts` caps it.
  Server-side paging of the grid would lift this.
- Mobile: browsing data and results works on small screens; editing and analysis are designed for desktop.

## 10. Recommended next steps

1. Validate the remaining methods listed as "not externally validated" (and Hosmer-Lemeshow) against R when R is available, and tighten the
   ICC and alpha CI checks from two decimals to full precision.
2. Manuscript links: store the analysis id and version with an inserted table so the editor can flag outdated content.
3. Estimated marginal means and post-hoc contrasts for factorial ANOVA/ANCOVA; a Brant test for ordinal models.
4. When mixed models or multiple imputation are needed: a paid, isolated Python worker (statsmodels) with a queue, called with a dataset
   version id and returning a structured result in the same `AnalysisResult` format. Budget: a small always-on instance (Render Starter or
   Fly.io shared CPU, about 7 to 10 USD a month) rather than the free tier.

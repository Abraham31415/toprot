import {
  caseControl, clusterTrial, cohort, diagnosticAccuracy, kishDesignEffect, powerTwoMeans, powerTwoProportions,
  repeatedMeasures, singleMean, singleProportion, survivalEvents, twoMeans, twoProportions, pairedMeans,
  finitePopulation, nonresponseAdjust, designEffectCluster, ceil, type SizeResult,
} from "../stats/samplesize";
import { normPpf, tPpf } from "../stats/dist";
import { CONF_FIELD, NONRESPONSE_FIELD, POWER_FIELD, RATIO_FIELD, alphaText, confText, fmt, parseList } from "./helpers";
import type { Calculator, ToolResult } from "./types";

const REF = {
  cochran: "Cochran WG. Sampling Techniques. 3rd ed. New York: Wiley; 1977.",
  kish: "Kish L. Survey Sampling. New York: Wiley; 1965.",
  lwanga: "Lwanga SK, Lemeshow S. Sample Size Determination in Health Studies: A Practical Manual. Geneva: World Health Organization; 1991.",
  fleiss: "Fleiss JL, Levin B, Paik MC. Statistical Methods for Rates and Proportions. 3rd ed. Hoboken: Wiley; 2003.",
  kelsey: "Kelsey JL, Whittemore AS, Evans AS, Thompson WD. Methods in Observational Epidemiology. 2nd ed. New York: Oxford University Press; 1996.",
  buderer: "Buderer NMF. Statistical methodology: I. Incorporating the prevalence of disease into the sample size calculation for sensitivity and specificity. Acad Emerg Med. 1996;3(9):895-900.",
  schoenfeld: "Schoenfeld DA. Sample-size formula for the proportional-hazards regression model. Biometrics. 1983;39(2):499-503.",
  donner: "Donner A, Klar N. Design and Analysis of Cluster Randomization Trials in Health Research. London: Arnold; 2000.",
  diggle: "Diggle PJ, Heagerty P, Liang KY, Zeger SL. Analysis of Longitudinal Data. 2nd ed. Oxford: Oxford University Press; 2002.",
  frison: "Frison L, Pocock SJ. Repeated measures in clinical trials: analysis using mean summary statistics and its implications for design. Stat Med. 1992;11(13):1685-1704.",
  cohen: "Cohen J. Statistical Power Analysis for the Behavioral Sciences. 2nd ed. Hillsdale: Lawrence Erlbaum; 1988.",
  hedges: "Hedges LV, Olkin I. Statistical Methods for Meta-Analysis. Orlando: Academic Press; 1985.",
};

const DISCLAIMER = "Results are planning estimates from closed-form formulas. They are not a substitute for review by a qualified statistician.";

/** Turn a SizeResult into the common ToolResult shape. */
function toResult(r: SizeResult, rows: [string, string][], methods: string, notes: string[] = []): ToolResult {
  if (!r.ok) return { error: r.error };
  return { headline: { label: r.headline.label, value: String(Number.isInteger(r.headline.value) ? r.headline.value : fmt(r.headline.value, 3)) }, rows, steps: r.steps, notes: [...notes, DISCLAIMER], methods };
}

const DEFF: Calculator["fields"][number] = {
  id: "deff", label: "Design effect", kind: "number", default: "1", min: 1, max: 20, step: 0.1,
  help: "1 for simple random sampling. Use 1 + (m - 1) x ICC for cluster sampling, where m is the average cluster size.",
};
const POP: Calculator["fields"][number] = {
  id: "pop", label: "Population size (0 = very large)", kind: "number", default: "0", min: 0, step: 1,
  help: "Total size of the source population. Leave 0 if it is large or unknown; the finite population correction then is not applied.",
};

const adj = (n: Record<string, number>) => ({
  designEffect: n.deff > 1 ? n.deff : undefined,
  population: n.pop > 1 ? n.pop : undefined,
  nonresponse: n.nonresponse > 0 ? n.nonresponse : undefined,
});

export const SIZE_CALCULATORS: Calculator[] = [
  {
    slug: "sample-size-proportion", name: "Single Proportion and Cross-Sectional Prevalence", category: "sample-size", kind: "calculator",
    summary: "Sample size to estimate a prevalence or proportion, with design effect, finite population and nonresponse adjustments.",
    keywords: ["prevalence", "cross-sectional", "survey", "Cochran", "Kish", "Leslie Kish", "proportion", "finite population"],
    description: "Use this for a cross-sectional survey or any study that estimates one proportion with a chosen precision. It is the formula often cited as the Kish-Leslie or Cochran formula for descriptive studies.",
    fields: [
      { id: "p", label: "Expected proportion", kind: "number", default: "0.5", min: 0.001, max: 0.999, step: 0.01, help: "Best guess from a pilot or earlier studies. Use 0.5 if unknown, because it gives the largest (safest) sample." },
      { id: "d", label: "Margin of error (absolute)", kind: "number", default: "0.05", min: 0.001, max: 0.5, step: 0.01, help: "Half-width of the interval you want, as a proportion. 0.05 means plus or minus 5 percentage points." },
      CONF_FIELD, DEFF, POP, NONRESPONSE_FIELD,
    ],
    formula: "n0 = Z^2 x P(1 - P) / d^2.   Then n = n0 x DEFF; finite population: n = n / (1 + (n - 1) / N); nonresponse: n = n / (1 - r).",
    assumptions: ["Simple random sampling, or a design effect that reflects the actual design.", "A single outcome measured as a proportion.", "Normal approximation to the binomial, which is reasonable when n x P and n x (1 - P) are both at least 10."],
    limitations: ["Poor approximation for very rare or very common outcomes. Use an exact method in those cases.", "A guessed proportion that is far off will change the result."],
    references: [REF.cochran, REF.kish, REF.lwanga],
    run: (n) => {
      const r = singleProportion(n.p, n.d, n.conf, adj(n));
      const text = r.ok ? `The required sample size was estimated for a single proportion using n = Z²P(1−P)/d² (Cochran, 1977; Kish, 1965), with a ${confText(n.conf)} confidence level, an expected proportion of ${fmt(n.p)} and a margin of error of ${fmt(n.d)}. After the specified adjustments the minimum sample size was ${r.values.n}.` : "";
      return toResult(r, r.ok ? [["Sample size before adjustment", fmt(r.values.n0, 1)], ["Final sample size", String(r.values.n)]] : [], text, ["The expected proportion is an assumption. Report where it came from."]);
    },
  },
  {
    slug: "sample-size-mean", name: "Single Mean", category: "sample-size", kind: "calculator",
    summary: "Sample size to estimate a mean with a chosen margin of error.",
    keywords: ["mean", "continuous", "estimate", "standard deviation", "precision"],
    description: "Use this to estimate an average (for example mean haemoglobin) with a stated precision.",
    fields: [
      { id: "sd", label: "Standard deviation", kind: "number", default: "10", min: 0.0001, step: 0.1, help: "From a pilot study or the literature on a similar population." },
      { id: "d", label: "Margin of error (same units)", kind: "number", default: "2", min: 0.0001, step: 0.1, help: "Half-width of the confidence interval you want." },
      CONF_FIELD, DEFF, POP, NONRESPONSE_FIELD,
    ],
    formula: "n0 = (Z x SD / d)^2, followed by the same design effect, finite population and nonresponse adjustments.",
    assumptions: ["Approximately normal sampling distribution of the mean.", "The standard deviation is known or well estimated."],
    limitations: ["Uses the normal quantile, not the t quantile, so very small samples are slightly underestimated."],
    references: [REF.cochran, REF.lwanga],
    run: (n) => {
      const r = singleMean(n.sd, n.d, n.conf, adj(n));
      return toResult(r, r.ok ? [["Sample size before adjustment", fmt(r.values.n0, 1)], ["Final sample size", String(r.values.n)]] : [], r.ok ? `The sample size needed to estimate a mean was calculated as n = (Z·σ/d)² (Cochran, 1977) with ${confText(n.conf)} confidence, σ = ${fmt(n.sd)} and a margin of error of ${fmt(n.d)}, giving ${r.values.n} participants after adjustments.` : "");
    },
  },
  {
    slug: "sample-size-two-proportions", name: "Two Independent Proportions", category: "sample-size", kind: "calculator",
    summary: "Sample size to compare two proportions, for example treatment versus control.",
    keywords: ["two proportions", "comparison", "trial", "Fleiss", "binary outcome", "risk difference"],
    description: "Use this to compare the proportion with an outcome in two independent groups.",
    fields: [
      { id: "p1", label: "Proportion in group 1", kind: "number", default: "0.4", min: 0.001, max: 0.999, step: 0.01 },
      { id: "p2", label: "Proportion in group 2", kind: "number", default: "0.25", min: 0.001, max: 0.999, step: 0.01, help: "The smallest difference worth detecting is |p1 - p2|." },
      CONF_FIELD, POWER_FIELD, RATIO_FIELD, NONRESPONSE_FIELD,
    ],
    formula: "n1 = [Z(a/2) sqrt((1 + 1/k) p̄ q̄) + Z(b) sqrt(p1 q1 + p2 q2 / k)]^2 / (p1 - p2)^2,   n2 = k x n1.",
    assumptions: ["Two independent groups, two-sided test, no continuity correction.", "Proportions are the true values you expect, not just guesses at the boundary."],
    limitations: ["A continuity-corrected or exact method gives somewhat larger sizes for small samples.", "Does not model clustering or stratification."],
    references: [REF.fleiss, REF.kelsey, REF.lwanga],
    run: (n) => {
      const r = twoProportions(n.p1, n.p2, n.conf, n.power, n.ratio);
      if (!r.ok) return { error: r.error };
      const inflate = (x: number) => (n.nonresponse > 0 ? ceil(nonresponseAdjust(x, n.nonresponse)) : x);
      const n1 = inflate(r.values.n1), n2 = inflate(r.values.n2);
      return toResult(r, [["Group 1", String(n1)], ["Group 2", String(n2)], ["Total", String(n1 + n2)]],
        `Sample size was calculated to compare two independent proportions (${fmt(n.p1)} and ${fmt(n.p2)}) using the formula of Fleiss et al. (2003), with a two-sided α of ${alphaText(n.conf)} and ${fmt(n.power * 100, 0)}% power, requiring ${r.values.n1} and ${r.values.n2} participants per group${n.nonresponse > 0 ? `, or ${n1} and ${n2} after allowing for ${fmt(n.nonresponse * 100, 0)}% nonresponse` : ""}.`);
    },
  },
  {
    slug: "sample-size-two-means", name: "Two Independent Means", category: "sample-size", kind: "calculator",
    summary: "Sample size to compare the means of two independent groups.",
    keywords: ["two means", "t-test", "difference", "trial", "continuous outcome"],
    description: "Use this to compare a continuous outcome between two independent groups.",
    fields: [
      { id: "delta", label: "Difference in means to detect", kind: "number", default: "5", step: 0.1, help: "The smallest difference that matters clinically." },
      { id: "sd", label: "Common standard deviation", kind: "number", default: "10", min: 0.0001, step: 0.1 },
      CONF_FIELD, POWER_FIELD, RATIO_FIELD, NONRESPONSE_FIELD,
    ],
    formula: "n1 = (1 + 1/k) (Z(a/2) + Z(b))^2 SD^2 / delta^2,   n2 = k x n1.",
    assumptions: ["Normally distributed outcome with equal standard deviations in the two groups.", "Two-sided test at the stated alpha."],
    limitations: ["Normal approximation. Software using the t distribution gives a result one or two participants larger for small samples."],
    references: [REF.cohen, REF.lwanga, REF.fleiss],
    run: (n) => {
      const r = twoMeans(n.delta, n.sd, n.conf, n.power, n.ratio);
      if (!r.ok) return { error: r.error };
      const inflate = (x: number) => (n.nonresponse > 0 ? ceil(nonresponseAdjust(x, n.nonresponse)) : x);
      const n1 = inflate(r.values.n1), n2 = inflate(r.values.n2);
      return toResult(r, [["Group 1", String(n1)], ["Group 2", String(n2)], ["Total", String(n1 + n2)]],
        `The sample size to detect a mean difference of ${fmt(n.delta)} (SD ${fmt(n.sd)}) between two independent groups was calculated with a two-sided α of ${alphaText(n.conf)} and ${fmt(n.power * 100, 0)}% power, giving ${r.values.n1} and ${r.values.n2} participants per group${n.nonresponse > 0 ? ` (${n1} and ${n2} after ${fmt(n.nonresponse * 100, 0)}% nonresponse)` : ""}.`);
    },
  },
  {
    slug: "sample-size-paired-means", name: "Paired Means", category: "sample-size", kind: "calculator",
    summary: "Sample size for before and after or matched-pair comparisons.",
    keywords: ["paired", "before after", "matched pairs", "crossover"],
    description: "Use this when each participant is measured twice, or participants are matched in pairs.",
    fields: [
      { id: "delta", label: "Mean difference to detect", kind: "number", default: "3", step: 0.1 },
      { id: "sd", label: "SD of the paired differences", kind: "number", default: "8", min: 0.0001, step: 0.1, help: "The SD of the within-pair differences, not of the raw measurements." },
      CONF_FIELD, POWER_FIELD, NONRESPONSE_FIELD,
    ],
    formula: "n = ((Z(a/2) + Z(b)) x SD_diff / delta)^2 pairs.",
    assumptions: ["Differences are approximately normal.", "Pairs are independent of each other."],
    limitations: ["If you only know the SD of each measurement, you also need their correlation to get SD_diff."],
    references: [REF.cohen, REF.lwanga],
    run: (n) => {
      const r = pairedMeans(n.delta, n.sd, n.conf, n.power);
      if (!r.ok) return { error: r.error };
      const total = n.nonresponse > 0 ? ceil(nonresponseAdjust(r.values.n, n.nonresponse)) : r.values.n;
      return toResult(r, [["Pairs required", String(r.values.n)], ["With nonresponse", String(total)]],
        `The number of pairs needed to detect a mean difference of ${fmt(n.delta)} (SD of differences ${fmt(n.sd)}) was ${r.values.n} at a two-sided α of ${alphaText(n.conf)} and ${fmt(n.power * 100, 0)}% power.`);
    },
  },
  {
    slug: "sample-size-case-control", name: "Case-Control Study", category: "sample-size", kind: "calculator",
    summary: "Cases and controls needed to detect an odds ratio, given exposure among controls.",
    keywords: ["case-control", "odds ratio", "unmatched", "exposure", "Kelsey", "Fleiss"],
    description: "Use this for an unmatched case-control study. It turns the odds ratio and control exposure into the exposure expected among cases, then applies the two-proportion formula.",
    fields: [
      { id: "p0", label: "Exposure prevalence among controls", kind: "number", default: "0.3", min: 0.001, max: 0.999, step: 0.01 },
      { id: "or", label: "Odds ratio to detect", kind: "number", default: "2", min: 0.01, step: 0.1, help: "Use a value above 1 for a risk factor or below 1 for a protective factor." },
      { id: "k", label: "Controls per case", kind: "number", default: "1", min: 0.1, max: 10, step: 0.5 },
      CONF_FIELD, POWER_FIELD,
    ],
    formula: "p1 = OR x p0 / (1 - p0 + OR x p0), then the Fleiss two-proportion formula with ratio k = controls per case.",
    assumptions: ["Unmatched design.", "Exposure prevalence among controls represents the source population."],
    limitations: ["Matched designs need a different calculation.", "Gains from more than about four controls per case are small."],
    references: [REF.kelsey, REF.fleiss, REF.lwanga],
    run: (n) => {
      const r = caseControl(n.p0, n.or, n.conf, n.power, n.k);
      if (!r.ok) return { error: r.error };
      return toResult(r, [["Cases", String(r.values.cases)], ["Controls", String(r.values.controls)], ["Exposure among cases (implied)", fmt(r.values.p1)]],
        `For an unmatched case-control study, detecting an odds ratio of ${fmt(n.or)} with ${fmt(n.p0 * 100, 0)}% exposure among controls, a two-sided α of ${alphaText(n.conf)} and ${fmt(n.power * 100, 0)}% power requires ${r.values.cases} cases and ${r.values.controls} controls (Kelsey et al., 1996; Fleiss et al., 2003).`);
    },
  },
  {
    slug: "sample-size-cohort", name: "Cohort Study", category: "sample-size", kind: "calculator",
    summary: "Exposed and unexposed participants needed to detect a relative risk.",
    keywords: ["cohort", "relative risk", "risk ratio", "exposed", "incidence"],
    description: "Use this for a cohort study comparing the risk of an outcome between exposed and unexposed groups.",
    fields: [
      { id: "p0", label: "Risk in the unexposed", kind: "number", default: "0.1", min: 0.001, max: 0.999, step: 0.01 },
      { id: "rr", label: "Relative risk to detect", kind: "number", default: "2", min: 0.01, step: 0.1 },
      { id: "k", label: "Unexposed per exposed", kind: "number", default: "1", min: 0.1, max: 10, step: 0.5 },
      CONF_FIELD, POWER_FIELD, NONRESPONSE_FIELD,
    ],
    formula: "p1 = RR x p0, then the Fleiss two-proportion formula.",
    assumptions: ["Fixed follow-up with complete outcome ascertainment, or losses handled with the nonresponse adjustment.", "Constant baseline risk."],
    limitations: ["For rates with varying follow-up use person-time or survival methods."],
    references: [REF.kelsey, REF.fleiss, REF.lwanga],
    run: (n) => {
      const r = cohort(n.p0, n.rr, n.conf, n.power, n.k);
      if (!r.ok) return { error: r.error };
      const f = (x: number) => (n.nonresponse > 0 ? ceil(nonresponseAdjust(x, n.nonresponse)) : x);
      return toResult(r, [["Exposed", String(f(r.values.exposed))], ["Unexposed", String(f(r.values.unexposed))], ["Total", String(f(r.values.exposed) + f(r.values.unexposed))]],
        `For a cohort study, detecting a relative risk of ${fmt(n.rr)} with a baseline risk of ${fmt(n.p0)}, a two-sided α of ${alphaText(n.conf)} and ${fmt(n.power * 100, 0)}% power requires ${f(r.values.exposed)} exposed and ${f(r.values.unexposed)} unexposed participants (Fleiss et al., 2003).`);
    },
  },
  {
    slug: "sample-size-diagnostic-accuracy", name: "Diagnostic Accuracy: Sensitivity and Specificity", category: "sample-size", kind: "calculator",
    summary: "Participants needed to estimate sensitivity and specificity with a given precision (Buderer).",
    keywords: ["diagnostic", "sensitivity", "specificity", "Buderer", "accuracy", "test"],
    description: "Use this for a diagnostic accuracy study. It accounts for disease prevalence, because sensitivity is only estimated from people with the disease.",
    fields: [
      { id: "se", label: "Expected sensitivity", kind: "number", default: "0.9", min: 0.01, max: 0.99, step: 0.01 },
      { id: "sp", label: "Expected specificity", kind: "number", default: "0.85", min: 0.01, max: 0.99, step: 0.01 },
      { id: "d", label: "Precision (absolute half-width)", kind: "number", default: "0.05", min: 0.005, max: 0.3, step: 0.005 },
      { id: "prev", label: "Disease prevalence in the study population", kind: "number", default: "0.2", min: 0.001, max: 0.999, step: 0.01 },
      CONF_FIELD, NONRESPONSE_FIELD,
    ],
    formula: "n(sens) = Z^2 Se (1 - Se) / (d^2 x prevalence);  n(spec) = Z^2 Sp (1 - Sp) / (d^2 x (1 - prevalence)). The larger governs.",
    assumptions: ["Prevalence in the sample matches the stated value.", "A single reference standard applied to everyone."],
    limitations: ["Aims at precision, not at a hypothesis test of accuracy.", "Verification bias and spectrum effects are not modelled."],
    references: [REF.buderer, REF.lwanga],
    run: (n) => {
      const r = diagnosticAccuracy(n.se, n.sp, n.d, n.prev, n.conf, n.nonresponse);
      return toResult(r, r.ok ? [["Needed for sensitivity", String(r.values.forSensitivity)], ["Needed for specificity", String(r.values.forSpecificity)], ["Final (larger, adjusted)", String(r.values.n)]] : [],
        r.ok ? `The sample size for a diagnostic accuracy study was calculated by the method of Buderer (1996) to estimate sensitivity (${fmt(n.se)}) and specificity (${fmt(n.sp)}) within ±${fmt(n.d)} at ${confText(n.conf)} confidence, assuming a prevalence of ${fmt(n.prev)}, giving ${r.values.n} participants.` : "");
    },
  },
  {
    slug: "sample-size-cluster-trial", name: "Cluster Randomised Trial", category: "sample-size", kind: "calculator",
    summary: "Clusters and participants needed when whole groups are randomised.",
    keywords: ["cluster", "intracluster correlation", "ICC", "design effect", "village", "school", "ward"],
    description: "Use this when groups (villages, schools, clinics) rather than individuals are randomised. Individually randomised sizes are inflated by the design effect.",
    fields: [
      { id: "outcome", label: "Outcome type", kind: "select", default: "mean", options: [{ value: "mean", label: "Mean (continuous)" }, { value: "proportion", label: "Proportion (binary)" }] },
      { id: "delta", label: "Difference in means to detect", kind: "number", default: "5", step: 0.1, showIf: { id: "outcome", equals: "mean" } },
      { id: "sd", label: "Standard deviation", kind: "number", default: "20", min: 0.0001, step: 0.1, showIf: { id: "outcome", equals: "mean" } },
      { id: "p1", label: "Proportion in arm 1", kind: "number", default: "0.4", min: 0.001, max: 0.999, step: 0.01, showIf: { id: "outcome", equals: "proportion" } },
      { id: "p2", label: "Proportion in arm 2", kind: "number", default: "0.25", min: 0.001, max: 0.999, step: 0.01, showIf: { id: "outcome", equals: "proportion" } },
      { id: "m", label: "Average cluster size", kind: "number", default: "20", min: 1, step: 1 },
      { id: "icc", label: "Intracluster correlation (ICC)", kind: "number", default: "0.05", min: 0, max: 1, step: 0.01, help: "Typical values in health research are 0.01 to 0.10. Use a published ICC for a similar outcome and setting." },
      CONF_FIELD, POWER_FIELD,
    ],
    formula: "DEFF = 1 + (m - 1) x ICC.  Participants per arm = individually randomised n per arm x DEFF.  Clusters per arm = participants per arm / m.",
    assumptions: ["Equal cluster sizes (use the mean size, or a coefficient-of-variation adjustment, for unequal sizes).", "Two arms with equal allocation."],
    limitations: ["Too few clusters (fewer than about 4 to 6 per arm) makes the normal approximation unreliable.", "Does not model stratification or matching."],
    references: [REF.donner, REF.kish],
    run: (n, raw) => {
      const r = raw.outcome === "mean" ? clusterTrial("mean", n.delta, n.sd, n.conf, n.power, n.m, n.icc) : clusterTrial("proportion", n.p1, n.p2, n.conf, n.power, n.m, n.icc);
      return toResult(r, r.ok ? [["Design effect", fmt(r.values.designEffect)], ["Participants per arm", String(r.values.perArm)], ["Clusters per arm", String(r.values.clustersPerArm)], ["Total clusters", String(r.values.totalClusters)], ["Total participants", String(r.values.totalParticipants)]] : [],
        r.ok ? `For a two-arm cluster randomised trial with an average cluster size of ${fmt(n.m, 0)} and ICC of ${fmt(n.icc)}, the design effect was ${fmt(r.values.designEffect)} (Donner and Klar, 2000). ${r.values.clustersPerArm} clusters per arm (${r.values.perArm} participants per arm) are needed for ${fmt(n.power * 100, 0)}% power at a two-sided α of ${alphaText(n.conf)}.` : "");
    },
  },
  {
    slug: "sample-size-repeated-measures", name: "Repeated Measures", category: "sample-size", kind: "calculator",
    summary: "Participants per group when comparing the average of several measurements per person.",
    keywords: ["repeated measures", "longitudinal", "correlation", "Diggle", "Frison", "Pocock"],
    description: "Use this when each person is measured several times and the groups are compared on the average of those measurements.",
    fields: [
      { id: "delta", label: "Difference in means to detect", kind: "number", default: "5", step: 0.1 },
      { id: "sd", label: "Standard deviation of a single measurement", kind: "number", default: "20", min: 0.0001, step: 0.1 },
      { id: "rho", label: "Correlation between repeated measures", kind: "number", default: "0.5", min: 0, max: 0.99, step: 0.05, help: "Within-person correlation, assumed equal for every pair of visits (compound symmetry)." },
      { id: "m", label: "Number of measurements per person", kind: "number", default: "4", min: 1, max: 50, step: 1 },
      CONF_FIELD, POWER_FIELD,
    ],
    formula: "n per group = 2 (Z(a/2) + Z(b))^2 SD^2 [1 + (m - 1) rho] / (m x delta^2).",
    assumptions: ["Compound symmetry (equal correlation between all pairs of visits).", "No missing visits, or a separate inflation for dropout.", "The comparison is of the mean over visits, not of a trend."],
    limitations: ["Does not cover analyses of change from baseline or of slopes, which need different formulas.", "Real correlations often decay with time between visits."],
    references: [REF.diggle, REF.frison],
    run: (n) => {
      const r = repeatedMeasures(n.delta, n.sd, n.rho, n.m, n.conf, n.power);
      return toResult(r, r.ok ? [["Per group", String(r.values.perGroup)], ["Total", String(r.values.total)]] : [],
        r.ok ? `Sample size for comparing the mean of ${fmt(n.m, 0)} repeated measurements between two groups assumed a within-person correlation of ${fmt(n.rho)} (Diggle et al., 2002; Frison and Pocock, 1992). To detect a difference of ${fmt(n.delta)} (SD ${fmt(n.sd)}) with ${fmt(n.power * 100, 0)}% power at a two-sided α of ${alphaText(n.conf)}, ${r.values.perGroup} participants per group are needed.` : "");
    },
  },
  {
    slug: "sample-size-survival", name: "Survival and Time-to-Event (Log-Rank)", category: "sample-size", kind: "calculator",
    summary: "Events and participants needed to detect a hazard ratio (Schoenfeld).",
    keywords: ["survival", "time to event", "hazard ratio", "log-rank", "Schoenfeld", "events"],
    description: "Use this for a two-group comparison of time to an event. Power depends on the number of events, not the number of participants.",
    fields: [
      { id: "hr", label: "Hazard ratio to detect", kind: "number", default: "0.6", min: 0.01, step: 0.05, help: "Use a value below 1 if the treatment lowers the hazard." },
      { id: "pe", label: "Overall probability of an event by end of follow-up (0 = skip)", kind: "number", default: "0.5", min: 0, max: 1, step: 0.05, help: "Overall across both groups. If given, the total number of participants is also shown." },
      CONF_FIELD, POWER_FIELD, RATIO_FIELD,
    ],
    formula: "d = (1 + k)^2 (Z(a/2) + Z(b))^2 / (k x [ln HR]^2) events;  N = d / P(event).",
    assumptions: ["Proportional hazards.", "Two groups, log-rank test, exponential-like event accrual.", "The overall event probability is realistic for your follow-up and accrual."],
    limitations: ["Gives events, so participants depend on an assumed event probability.", "Does not model staggered entry, competing risks or non-proportional hazards."],
    references: [REF.schoenfeld],
    run: (n) => {
      const r = survivalEvents(n.hr, n.conf, n.power, n.ratio, n.pe > 0 ? n.pe : undefined);
      return toResult(r, r.ok ? [["Events required", String(r.values.events)], ...(r.values.total ? ([["Total participants", String(r.values.total)]] as [string, string][]) : [])] : [],
        r.ok ? `The number of events needed to detect a hazard ratio of ${fmt(n.hr)} with a log-rank test was calculated by the Schoenfeld (1983) formula as ${r.values.events} events (two-sided α ${alphaText(n.conf)}, ${fmt(n.power * 100, 0)}% power${r.values.total ? `; ${r.values.total} participants assuming an overall event probability of ${fmt(n.pe)}` : ""}).` : "");
    },
  },
  {
    slug: "statistical-power-two-means", name: "Power: Two Means", category: "sample-size", kind: "calculator",
    summary: "Statistical power to detect a difference in means with a given sample size.",
    keywords: ["power", "statistical power", "two means", "sensitivity analysis", "post hoc"],
    description: "Use this to find the power you have with a fixed sample size, for example when recruitment is limited.",
    fields: [
      { id: "n1", label: "Participants in group 1", kind: "number", default: "64", min: 2, step: 1 },
      { id: "delta", label: "Difference in means", kind: "number", default: "5", step: 0.1 },
      { id: "sd", label: "Common standard deviation", kind: "number", default: "10", min: 0.0001, step: 0.1 },
      CONF_FIELD, RATIO_FIELD,
    ],
    formula: "Power = Phi( |delta| / (SD sqrt(1/n1 + 1/n2)) - Z(a/2) ).",
    assumptions: ["Normally distributed outcome, equal SDs, two-sided test."],
    limitations: ["Power calculated after a study from the observed effect adds no information beyond the p-value. Use it for planning, not to explain a null result."],
    references: [REF.cohen, REF.lwanga],
    run: (n) => {
      const r = powerTwoMeans(n.n1, n.delta, n.sd, n.conf, n.ratio);
      return toResult(r, r.ok ? [["Power", `${fmt(r.values.power * 100, 1)}%`]] : [], r.ok ? `With ${fmt(n.n1, 0)} participants in group 1 (ratio ${fmt(n.ratio)}), the study has ${fmt(r.values.power * 100, 1)}% power to detect a mean difference of ${fmt(n.delta)} (SD ${fmt(n.sd)}) at a two-sided α of ${alphaText(n.conf)}.` : "");
    },
  },
  {
    slug: "statistical-power-two-proportions", name: "Power: Two Proportions", category: "sample-size", kind: "calculator",
    summary: "Statistical power to detect a difference between two proportions.",
    keywords: ["power", "two proportions", "binary outcome", "sensitivity analysis"],
    description: "Use this to find the power you have for comparing two proportions with a fixed sample size.",
    fields: [
      { id: "n1", label: "Participants in group 1", kind: "number", default: "150", min: 2, step: 1 },
      { id: "p1", label: "Proportion in group 1", kind: "number", default: "0.4", min: 0.001, max: 0.999, step: 0.01 },
      { id: "p2", label: "Proportion in group 2", kind: "number", default: "0.25", min: 0.001, max: 0.999, step: 0.01 },
      CONF_FIELD, RATIO_FIELD,
    ],
    formula: "Z(b) = (|p1 - p2| sqrt(n1) - Z(a/2) sqrt((1 + 1/k) p̄ q̄)) / sqrt(p1 q1 + p2 q2 / k);  Power = Phi(Z(b)).",
    assumptions: ["Independent groups, two-sided test, normal approximation."],
    limitations: ["Approximation is weaker for small samples or extreme proportions."],
    references: [REF.fleiss, REF.lwanga],
    run: (n) => {
      const r = powerTwoProportions(n.n1, n.p1, n.p2, n.conf, n.ratio);
      return toResult(r, r.ok ? [["Power", `${fmt(r.values.power * 100, 1)}%`]] : [], r.ok ? `With ${fmt(n.n1, 0)} participants in group 1, the study has ${fmt(r.values.power * 100, 1)}% power to detect a difference between proportions of ${fmt(n.p1)} and ${fmt(n.p2)} at a two-sided α of ${alphaText(n.conf)} (Fleiss et al., 2003).` : "");
    },
  },
  {
    slug: "finite-population-correction", name: "Finite Population Correction", category: "sample-size", kind: "calculator",
    summary: "Reduce a calculated sample size when the source population is small.",
    keywords: ["finite population", "correction", "small population", "FPC"],
    description: "Use this when you sample a large fraction of a small population, for example all nurses in one hospital.",
    fields: [
      { id: "n0", label: "Calculated sample size (infinite population)", kind: "number", default: "384", min: 1, step: 1 },
      { id: "N", label: "Population size", kind: "number", default: "1000", min: 2, step: 1 },
    ],
    formula: "n = n0 / (1 + (n0 - 1) / N).",
    assumptions: ["Sampling without replacement from a known, fixed population."],
    limitations: ["Small effect unless the sample is more than about 5% of the population."],
    references: [REF.cochran, REF.kish],
    run: (n) => {
      const out = finitePopulation(n.n0, n.N);
      return { headline: { label: "Corrected sample size", value: String(ceil(out)) }, rows: [["Before correction", fmt(n.n0, 1)], ["After correction", fmt(out, 1)]], steps: [`n = ${fmt(n.n0, 1)} / (1 + (${fmt(n.n0, 1)} - 1) / ${fmt(n.N, 0)}) = ${fmt(out, 2)}`, `Round up: ${ceil(out)}`], notes: [DISCLAIMER], methods: `A finite population correction (Cochran, 1977) was applied for a source population of ${fmt(n.N, 0)}, reducing the sample size from ${fmt(n.n0, 0)} to ${ceil(out)}.` };
    },
  },
  {
    slug: "nonresponse-adjustment", name: "Nonresponse and Dropout Adjustment", category: "sample-size", kind: "calculator",
    summary: "Inflate a sample size to allow for refusals and loss to follow-up.",
    keywords: ["nonresponse", "dropout", "attrition", "loss to follow-up", "inflation"],
    description: "Use this to increase a calculated sample size so that enough participants remain after nonresponse or dropout.",
    fields: [
      { id: "n", label: "Required analysable sample size", kind: "number", default: "300", min: 1, step: 1 },
      { id: "r", label: "Expected nonresponse or dropout", kind: "number", default: "0.1", min: 0, max: 0.95, step: 0.01, help: "As a proportion, e.g. 0.10 for 10%." },
    ],
    formula: "n_adjusted = n / (1 - r).  (Dividing is correct; multiplying by 1 + r under-corrects.)",
    assumptions: ["Dropout is unrelated to the outcome."],
    limitations: ["If dropout is related to the outcome, inflating the sample does not remove the bias."],
    references: [REF.lwanga, REF.fleiss],
    run: (n) => {
      const out = nonresponseAdjust(n.n, n.r);
      return { headline: { label: "Participants to recruit", value: String(ceil(out)) }, rows: [["Analysable sample", fmt(n.n, 0)], ["Recruit", String(ceil(out))]], steps: [`n_adjusted = ${fmt(n.n, 0)} / (1 - ${fmt(n.r)}) = ${fmt(out, 2)}`, `Round up: ${ceil(out)}`], notes: [DISCLAIMER], methods: `To allow for ${fmt(n.r * 100, 0)}% nonresponse or dropout, the sample size was inflated as n/(1 − r), giving ${ceil(out)} participants to recruit.` };
    },
  },
  {
    slug: "design-effect", name: "Design Effect (Cluster and Kish Weights)", category: "sample-size", kind: "calculator",
    summary: "Compute a design effect from cluster size and ICC, or from unequal survey weights (Kish).",
    keywords: ["design effect", "DEFF", "Kish", "weights", "effective sample size", "ICC", "cluster"],
    description: "The design effect is the factor by which a complex sample's variance exceeds that of a simple random sample of the same size. Two common sources are clustering and unequal weights.",
    fields: [
      { id: "mode", label: "Source", kind: "select", default: "cluster", options: [{ value: "cluster", label: "Clustering (m and ICC)" }, { value: "kish", label: "Unequal weights (Kish)" }] },
      { id: "m", label: "Average cluster size", kind: "number", default: "20", min: 1, step: 1, showIf: { id: "mode", equals: "cluster" } },
      { id: "icc", label: "Intracluster correlation (ICC)", kind: "number", default: "0.05", min: 0, max: 1, step: 0.01, showIf: { id: "mode", equals: "cluster" } },
      { id: "n", label: "Total sample size (optional, 0 to skip)", kind: "number", default: "0", min: 0, step: 1, showIf: { id: "mode", equals: "cluster" } },
      { id: "weights", label: "Survey weights (one per respondent)", kind: "textarea", default: "1 1 1 2 2 3 3 4", placeholder: "Separate with spaces, commas or new lines", showIf: { id: "mode", equals: "kish" } },
    ],
    formula: "Cluster: DEFF = 1 + (m - 1) x ICC.   Kish weights: DEFF = n x sum(w^2) / (sum w)^2 = 1 + CV(w)^2.   Effective n = n / DEFF.",
    assumptions: ["Equal cluster sizes (or the mean size) for the cluster formula.", "Weights are positive and reflect unequal selection probabilities."],
    limitations: ["Kish's formula covers only the effect of weights, not of clustering or stratification."],
    references: [REF.kish, REF.donner],
    run: (n, raw) => {
      if (raw.mode === "kish") {
        const w = parseList(raw.weights ?? "", "Weights");
        if (typeof w === "string") return { error: w };
        if (w.some((x) => x <= 0)) return { error: "Weights must be positive." };
        const k = kishDesignEffect(w);
        return { headline: { label: "Design effect (weights)", value: fmt(k.deff) }, rows: [["Respondents", String(k.n)], ["Effective sample size", fmt(k.effectiveN, 1)]], steps: [`DEFF = n x sum(w^2) / (sum w)^2 = ${fmt(k.deff, 4)}`, `Effective n = ${k.n} / ${fmt(k.deff, 4)} = ${fmt(k.effectiveN, 1)}`], notes: [DISCLAIMER], methods: `The design effect due to unequal weighting was ${fmt(k.deff)} (Kish, 1965), reducing ${k.n} respondents to an effective sample size of ${fmt(k.effectiveN, 0)}.` };
      }
      const d = designEffectCluster(n.m, n.icc);
      const rows: [string, string][] = [["Design effect", fmt(d)]];
      if (n.n > 0) rows.push(["Effective sample size", fmt(n.n / d, 1)]);
      return { headline: { label: "Design effect (clustering)", value: fmt(d) }, rows, steps: [`DEFF = 1 + (m - 1) x ICC = 1 + (${fmt(n.m, 0)} - 1) x ${fmt(n.icc)} = ${fmt(d, 4)}`], notes: [DISCLAIMER], methods: `The design effect for clustering was 1 + (m − 1)ρ = ${fmt(d)} with an average cluster size of ${fmt(n.m, 0)} and ICC of ${fmt(n.icc)} (Kish, 1965; Donner and Klar, 2000).` };
    },
  },
  {
    slug: "effect-size", name: "Effect Size Calculator", category: "sample-size", kind: "calculator",
    summary: "Cohen's d, Hedges' g, Cohen's h and conversions between d, r and the odds ratio.",
    keywords: ["effect size", "Cohen d", "Hedges g", "Cohen h", "odds ratio to d", "correlation"],
    description: "Standardised effect sizes help choose a target difference for power calculations and compare results across studies.",
    fields: [
      { id: "mode", label: "Compute", kind: "select", default: "d", options: [{ value: "d", label: "Cohen's d and Hedges' g from two groups" }, { value: "h", label: "Cohen's h from two proportions" }, { value: "or", label: "Convert odds ratio to d and r" }] },
      { id: "m1", label: "Mean, group 1", kind: "number", default: "52", step: 0.1, showIf: { id: "mode", equals: "d" } },
      { id: "s1", label: "SD, group 1", kind: "number", default: "10", min: 0.0001, step: 0.1, showIf: { id: "mode", equals: "d" } },
      { id: "n1", label: "n, group 1", kind: "number", default: "40", min: 2, step: 1, showIf: { id: "mode", equals: "d" } },
      { id: "m2", label: "Mean, group 2", kind: "number", default: "46", step: 0.1, showIf: { id: "mode", equals: "d" } },
      { id: "s2", label: "SD, group 2", kind: "number", default: "11", min: 0.0001, step: 0.1, showIf: { id: "mode", equals: "d" } },
      { id: "n2", label: "n, group 2", kind: "number", default: "38", min: 2, step: 1, showIf: { id: "mode", equals: "d" } },
      { id: "p1", label: "Proportion, group 1", kind: "number", default: "0.4", min: 0, max: 1, step: 0.01, showIf: { id: "mode", equals: "h" } },
      { id: "p2", label: "Proportion, group 2", kind: "number", default: "0.25", min: 0, max: 1, step: 0.01, showIf: { id: "mode", equals: "h" } },
      { id: "or", label: "Odds ratio", kind: "number", default: "2", min: 0.0001, step: 0.1, showIf: { id: "mode", equals: "or" } },
    ],
    formula: "d = (M1 - M2) / SDpooled;  g = d x (1 - 3 / (4(n1 + n2) - 9));  h = 2 asin(sqrt p1) - 2 asin(sqrt p2);  d = ln(OR) x sqrt(3) / pi;  r = d / sqrt(d^2 + 4).",
    assumptions: ["Approximately normal outcomes with similar SDs for d and g.", "The OR-to-d conversion assumes an underlying logistic distribution."],
    limitations: ["Cohen's benchmarks (0.2 small, 0.5 medium, 0.8 large) are rough conventions, not clinical thresholds."],
    references: [REF.cohen, REF.hedges],
    run: (n, raw) => {
      if (raw.mode === "h") {
        const h = 2 * Math.asin(Math.sqrt(n.p1)) - 2 * Math.asin(Math.sqrt(n.p2));
        return { headline: { label: "Cohen's h", value: fmt(h) }, rows: [["h", fmt(h, 4)]], steps: [`h = 2 asin(sqrt(${fmt(n.p1)})) - 2 asin(sqrt(${fmt(n.p2)})) = ${fmt(h, 4)}`], notes: ["Rough guide: 0.2 small, 0.5 medium, 0.8 large."], methods: `The effect size for the difference between proportions ${fmt(n.p1)} and ${fmt(n.p2)} was Cohen's h = ${fmt(h)} (Cohen, 1988).` };
      }
      if (raw.mode === "or") {
        const d = (Math.log(n.or) * Math.sqrt(3)) / Math.PI, r = d / Math.sqrt(d * d + 4);
        return { headline: { label: "Cohen's d (from OR)", value: fmt(d) }, rows: [["d", fmt(d, 4)], ["r", fmt(r, 4)]], steps: [`d = ln(${fmt(n.or)}) x sqrt(3) / pi = ${fmt(d, 4)}`, `r = d / sqrt(d^2 + 4) = ${fmt(r, 4)}`], notes: ["Approximate: assumes a logistic latent distribution."], methods: `An odds ratio of ${fmt(n.or)} corresponds approximately to Cohen's d = ${fmt(d)} and r = ${fmt(r)}.` };
      }
      const sp = Math.sqrt(((n.n1 - 1) * n.s1 ** 2 + (n.n2 - 1) * n.s2 ** 2) / (n.n1 + n.n2 - 2));
      const d = (n.m1 - n.m2) / sp, g = d * (1 - 3 / (4 * (n.n1 + n.n2) - 9));
      const se = Math.sqrt((n.n1 + n.n2) / (n.n1 * n.n2) + (d * d) / (2 * (n.n1 + n.n2)));
      const z = normPpf(0.975), t = tPpf(0.975, n.n1 + n.n2 - 2);
      void t;
      return { headline: { label: "Cohen's d", value: fmt(d) }, rows: [["Pooled SD", fmt(sp, 3)], ["Cohen's d", fmt(d, 3)], ["Hedges' g", fmt(g, 3)], ["Approx. 95% CI for d", `${fmt(d - z * se, 2)} to ${fmt(d + z * se, 2)}`]], steps: [`Pooled SD = ${fmt(sp, 4)}`, `d = (${fmt(n.m1)} - ${fmt(n.m2)}) / ${fmt(sp, 4)} = ${fmt(d, 4)}`, `g = d x (1 - 3 / (4(n1 + n2) - 9)) = ${fmt(g, 4)}`], notes: ["Rough guide: 0.2 small, 0.5 medium, 0.8 large."], methods: `The standardised mean difference was Cohen's d = ${fmt(d)} (Hedges' g = ${fmt(g)}) (Cohen, 1988; Hedges and Olkin, 1985).` };
    },
  },
];

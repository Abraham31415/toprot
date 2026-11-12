import { ALL_TOOLS, toolHref } from "./registry";
import { categoryOf, type DirCategoryId, type DirItem, type IconKey } from "./directory-core";
import type { ToolMeta } from "./types";

export * from "./directory-core";

// Presentation data for the /tools directory. Server only: it reads the calculator registry. The browser receives the finished items.

type Entry = { label: string; blurb: string; icon: IconKey; group?: string; aliases?: string[] };

// Labels are short but never change meaning: the complete technical name stays on the tool's page. Where two tools would
// otherwise share a label, the label says which is which.
export const ENTRIES: Record<string, Entry> = {
  // Sample size and power
  "sample-size-proportion": { label: "Single Proportion", blurb: "Sample size to estimate a prevalence or proportion.", icon: "percent", group: "Estimate a value", aliases: ["prevalence", "cross-sectional", "survey", "cochran", "kish", "descriptive"] },
  "sample-size-mean": { label: "Single Mean", blurb: "Sample size to estimate a mean with a set margin of error.", icon: "ruler", group: "Estimate a value", aliases: ["average", "continuous"] },
  "sample-size-diagnostic-accuracy": { label: "Diagnostic Accuracy Study", blurb: "Participants needed to estimate sensitivity and specificity.", icon: "stethoscope", group: "Estimate a value", aliases: ["sensitivity", "specificity", "test accuracy"] },
  "sample-size-two-proportions": { label: "Two Proportions", blurb: "Compare two groups on a yes/no outcome.", icon: "git-compare", group: "Compare groups", aliases: ["binary", "rct", "trial"] },
  "sample-size-two-means": { label: "Two Means", blurb: "Compare two independent groups on a measurement.", icon: "git-compare", group: "Compare groups", aliases: ["t-test", "continuous", "rct", "trial"] },
  "sample-size-paired-means": { label: "Paired Means", blurb: "Compare two measurements on the same people.", icon: "link", group: "Compare groups", aliases: ["paired t-test", "before after", "matched"] },
  "sample-size-pre-post": { label: "ANCOVA Sample Size", blurb: "Baseline-adjusted comparison: change score or ANCOVA.", icon: "trending-up", group: "Compare groups", aliases: ["ancova", "change score", "pre post", "baseline", "analysis of covariance"] },
  "sample-size-repeated-measures": { label: "Repeated Measures", blurb: "Several measurements on each participant over time.", icon: "repeat", group: "Compare groups", aliases: ["longitudinal", "within subject"] },
  "sample-size-survival": { label: "Survival Analysis", blurb: "Sample size for log-rank time-to-event comparisons.", icon: "hourglass", group: "Compare groups", aliases: ["log-rank", "time to event", "kaplan-meier", "hazard ratio", "hr"] },
  "sample-size-cluster-trial": { label: "Cluster Trial", blurb: "Clusters and participants needed when groups are randomised.", icon: "network", group: "Compare groups", aliases: ["cluster randomised", "cluster randomized", "icc", "intraclass"] },
  "sample-size-case-control": { label: "Case-Control", blurb: "Cases and controls needed to detect an odds ratio.", icon: "git-compare", group: "Observational studies", aliases: ["or", "odds ratio"] },
  "sample-size-matched-case-control": { label: "Matched Case-Control", blurb: "Matched sets when each case has one or more controls.", icon: "link", group: "Observational studies", aliases: ["matching", "1:m"] },
  "sample-size-cohort": { label: "Cohort Study", blurb: "Exposed and unexposed participants to detect a relative risk.", icon: "users-round", group: "Observational studies", aliases: ["rr", "relative risk", "risk ratio"] },
  "statistical-power-two-means": { label: "Power: Two Means", blurb: "Power for comparing two means at a fixed sample size.", icon: "gauge", group: "Power and effect size", aliases: ["statistical power", "beta"] },
  "statistical-power-two-proportions": { label: "Power: Two Proportions", blurb: "Power for comparing two proportions at a fixed sample size.", icon: "gauge", group: "Power and effect size", aliases: ["statistical power", "beta"] },
  "effect-size": { label: "Effect Size", blurb: "Cohen's d, Hedges' g, Cohen's h and conversions.", icon: "ruler", group: "Power and effect size", aliases: ["cohen", "cohens d", "hedges g", "smd", "standardized mean difference"] },
  "design-effect": { label: "Design Effect", blurb: "From cluster size and ICC, or unequal survey weights.", icon: "layers", group: "Adjustments", aliases: ["deff", "kish", "cluster", "weights"] },
  "finite-population-correction": { label: "Finite Population", blurb: "Reduce the sample when the population is small.", icon: "filter", group: "Adjustments", aliases: ["fpc", "small population"] },
  "nonresponse-adjustment": { label: "Dropout Adjustment", blurb: "Inflate for nonresponse or loss to follow-up.", icon: "users", group: "Adjustments", aliases: ["attrition", "loss to follow-up", "non-response", "missing"] },
  "study-sample-size-calculator": { label: "Study-Linked Calculator", blurb: "Nine designs with a stress test; saves into a protocol.", icon: "calculator", group: "Adjustments", aliases: ["protocol", "stress test", "sensitivity analysis"] },
  // Statistical analysis
  "descriptive-statistics": { label: "Descriptive Statistics", blurb: "Mean, SD, median, quartiles and a confidence interval.", icon: "chart-column", group: "Describe and estimate", aliases: ["mean", "median", "sd", "standard deviation", "iqr", "summary statistics"] },
  "confidence-interval-mean": { label: "Mean Interval", blurb: "Confidence interval for a mean.", icon: "ruler", group: "Describe and estimate", aliases: ["ci", "95% ci", "confidence interval"] },
  "confidence-interval-proportion": { label: "Proportion Interval", blurb: "Confidence interval for a proportion.", icon: "percent", group: "Describe and estimate", aliases: ["ci", "wilson", "95% ci", "confidence interval"] },
  "missing-data-summary": { label: "Missing Data Summary", blurb: "Count and percentage missing per variable.", icon: "file-search", group: "Describe and estimate", aliases: ["missingness", "nonresponse", "completeness"] },
  "one-sample-t-test": { label: "One-Sample t-Test", blurb: "Compare a mean with a known value.", icon: "scale", group: "Compare groups", aliases: ["t test", "student"] },
  "two-sample-t-test": { label: "Two-Sample t-Test", blurb: "Compare the means of two independent groups.", icon: "git-compare", group: "Compare groups", aliases: ["t test", "student", "welch", "independent samples"] },
  "paired-t-test": { label: "Paired t-Test", blurb: "Compare two measurements on the same people.", icon: "link", group: "Compare groups", aliases: ["t test", "before after", "dependent samples"] },
  "one-way-anova": { label: "One-Way ANOVA", blurb: "Compare the means of three or more groups.", icon: "layers", group: "Compare groups", aliases: ["analysis of variance", "f test", "anova"] },
  "anova-post-hoc-tukey": { label: "ANOVA Post-Hoc (Tukey)", blurb: "Which groups differ after a one-way ANOVA.", icon: "split", group: "Compare groups", aliases: ["tukey", "hsd", "multiple comparisons", "tukey-kramer"] },
  "chi-square-test": { label: "Chi-Square Test", blurb: "Test for association in a 2x2 table.", icon: "grid", group: "Compare groups", aliases: ["chi2", "x2", "contingency table", "association", "independence"] },
  "fishers-exact-test": { label: "Fisher's Exact Test", blurb: "Exact test for a 2x2 table with small counts.", icon: "grid", group: "Compare groups", aliases: ["exact test", "small sample", "contingency table"] },
  "pearson-correlation": { label: "Pearson Correlation", blurb: "Linear correlation with a confidence interval.", icon: "chart-scatter", group: "Relationships", aliases: ["r", "correlation coefficient", "linear correlation"] },
  "spearman-correlation": { label: "Spearman Correlation", blurb: "Rank-based association for ordinal or skewed data.", icon: "chart-scatter", group: "Relationships", aliases: ["rho", "rank correlation", "nonparametric", "non-parametric"] },
  "simple-linear-regression": { label: "Linear Regression", blurb: "Fit a line with standard errors and p-values.", icon: "chart-line", group: "Relationships", aliases: ["ols", "least squares", "slope", "r2", "r squared"] },
  "simple-logistic-regression": { label: "Logistic Regression", blurb: "Odds ratio for a yes/no outcome per unit of one predictor.", icon: "trending-up", group: "Relationships", aliases: ["odds ratio", "binary outcome", "logit"] },
  "statistical-analysis-plan-generator": { label: "Analysis Plan Generator", blurb: "Draft an analysis plan with the right test per comparison.", icon: "file-text", group: "Planning", aliases: ["sap", "analysis plan"] },
  // Epidemiology
  "diagnostic-test-calculator": { label: "Diagnostic Accuracy", blurb: "Sensitivity, specificity, predictive values and likelihood ratios.", icon: "stethoscope", aliases: ["sensitivity", "specificity", "ppv", "npv", "lr", "likelihood ratio", "dor", "roc", "test accuracy"] },
  "epidemiology-2x2-table": { label: "2x2 Table", blurb: "Risk, odds and attributable measures from one table.", icon: "grid", aliases: ["rr", "or", "rd", "paf", "attributable fraction", "contingency table"] },
  "odds-ratio-calculator": { label: "Odds Ratio", blurb: "Odds ratio with a confidence interval from a 2x2 table.", icon: "git-compare", aliases: ["or", "odds", "woolf", "case-control"] },
  "relative-risk-calculator": { label: "Relative Risk", blurb: "Risk ratio with a confidence interval from a 2x2 table.", icon: "git-compare", aliases: ["rr", "risk ratio", "cohort"] },
  "risk-difference-calculator": { label: "Risk Difference & NNT", blurb: "Absolute risk difference and number needed to treat.", icon: "scale", aliases: ["rd", "nnt", "nnh", "absolute risk", "arr", "number needed to treat"] },
  "prevalence-calculator": { label: "Prevalence", blurb: "Prevalence or cumulative incidence with an interval.", icon: "percent", aliases: ["cumulative incidence", "risk", "proportion", "wilson"] },
  "incidence-rate-calculator": { label: "Incidence Rate", blurb: "Events per person-time with an exact interval.", icon: "timer", aliases: ["person-years", "person-time", "poisson", "rate"] },
  // Research design
  "study-design-assistant": { label: "Study Design Assistant", blurb: "Compare candidate designs for your research aim.", icon: "lightbulb", aliases: ["cohort", "case-control", "rct", "cross-sectional", "which design"] },
  "research-question-builder": { label: "Research Question", blurb: "Structure a question as PICO, PICOT or PECO.", icon: "message-text", aliases: ["pico", "picot", "peco", "objectives"] },
  "eligibility-criteria-builder": { label: "Eligibility Criteria", blurb: "Build an eligibility list and check it for gaps.", icon: "list-checks", aliases: ["inclusion", "exclusion", "selection"] },
  "sampling-strategy-assistant": { label: "Sampling Strategy", blurb: "Choose a sampling method for your frame and aim.", icon: "dices", aliases: ["random", "stratified", "cluster", "convenience", "sampling"] },
  "variables-and-definitions-builder": { label: "Variables & Definitions", blurb: "Classify variables and define exposure and outcome.", icon: "variable", aliases: ["operational definitions", "measurement", "outcome", "exposure"] },
  "consent-ethics-template-builder": { label: "Consent & Ethics", blurb: "Draft participant information and consent forms.", icon: "shield-check", aliases: ["ethics", "informed consent", "irb", "ethics committee"] },
  "methodology-checks": { label: "Methodology Checks", blurb: "Consistency checks on your protocol.", icon: "clipboard-check", aliases: ["validation", "review"] },
  "protocol-builder": { label: "Protocol Builder", blurb: "Guided sections from objectives to ethics.", icon: "file-text", aliases: ["research protocol", "proposal"] },
  // Literature and references
  "literature-explorer": { label: "Literature Explorer", blurb: "Search OpenAlex, PubMed and Crossref.", icon: "search", aliases: ["pubmed", "openalex", "crossref", "search papers", "evidence table"] },
  "reference-manager": { label: "Reference Manager", blurb: "Collect, tag, de-duplicate and export references.", icon: "library", aliases: ["zotero", "mendeley", "endnote", "ris", "bibtex", "doi"] },
  "pdf-library": { label: "PDF Library", blurb: "Store, search and annotate your papers.", icon: "file-search", aliases: ["pdf", "annotate", "full text", "compare papers"] },
  // Data collection
  "data-dictionary-builder": { label: "Data Dictionary", blurb: "Define each variable and export a CSV dictionary.", icon: "file-spreadsheet", aliases: ["codebook", "variables", "csv"] },
  "questionnaire-builder": { label: "Questionnaire Builder", blurb: "Write questions, check wording, export a form and codebook.", icon: "form-input", aliases: ["survey", "instrument", "scale"] },
  "document-generation": { label: "Forms & Data Dictionary", blurb: "KoBo and REDCap forms from your protocol.", icon: "clipboard-list", aliases: ["kobo", "redcap", "xlsform", "data collection"] },
  // Writing and reporting
  "citation-formatter": { label: "Citation Formatter", blurb: "Format citations in APA, Vancouver, Harvard and any CSL style.", icon: "quote", aliases: ["apa", "vancouver", "harvard", "ieee", "chicago", "mla", "csl", "bibliography"] },
  "academic-editor": { label: "Writing Editor", blurb: "Write manuscripts with citations and export.", icon: "pen-line", aliases: ["manuscript", "thesis", "docx", "imrad", "word"] },
  "ai-assistant": { label: "AI Assistant", blurb: "Grounded help with your protocol and sources.", icon: "sparkles", aliases: ["ai", "chatgpt", "brainstorm", "summarise", "summarize"] },
  "research-timeline-builder": { label: "Timeline Builder", blurb: "Lay out project phases and milestone dates.", icon: "calendar-clock", aliases: ["gantt", "schedule", "milestones"] },
  "deviation-tracking": { label: "Milestones & Deviations", blurb: "Track progress and write a deviation report.", icon: "clipboard-check", aliases: ["deviation report", "protocol deviation", "tracking"] },
};

/** Landing pages for the most searched tools. They run the same calculators, at search-friendly addresses. */
const HUBS: { slug: string; href: string; entry: Entry; category: DirCategoryId }[] = [
  { slug: "sample-size-calculator", href: "/tools/sample-size-calculator", category: "sample-size", entry: { label: "Sample Size Calculator", blurb: "Pick a design and find how many participants you need.", icon: "calculator", group: "Estimate a value", aliases: ["n", "sample size", "how many participants", "power analysis"] } },
  { slug: "statistical-power-calculator", href: "/tools/statistical-power-calculator", category: "sample-size", entry: { label: "Power Calculator", blurb: "Statistical power for two proportions or two means.", icon: "gauge", group: "Power and effect size", aliases: ["statistical power", "beta", "power analysis"] } },
];

const fromTool = (t: ToolMeta): DirItem => {
  const e = ENTRIES[t.slug];
  return {
    slug: t.slug, href: toolHref(t), label: e?.label ?? t.name, fullName: t.name, blurb: e?.blurb ?? t.summary, icon: e?.icon ?? "calculator",
    category: categoryOf(t.category), group: e?.group ?? null, keywords: [...t.keywords, ...(e?.aliases ?? [])], account: t.kind === "workspace",
  };
};

// Order inside each category: the order of ENTRIES above, with the two landing pages in their natural places, so the first
// few cards a visitor sees are the most useful ones rather than whatever order the calculators were registered in.
const ORDER = Object.keys(ENTRIES);
ORDER.unshift("sample-size-calculator");
ORDER.splice(ORDER.indexOf("statistical-power-two-means"), 0, "statistical-power-calculator");
const rank = (slug: string) => { const i = ORDER.indexOf(slug); return i === -1 ? ORDER.length : i; };

const UNSORTED: DirItem[] = [
  ...ALL_TOOLS.map(fromTool),
  ...HUBS.map((h): DirItem => ({
    slug: h.slug, href: h.href, label: h.entry.label, fullName: h.entry.label, blurb: h.entry.blurb, icon: h.entry.icon, category: h.category,
    group: h.entry.group ?? null, keywords: h.entry.aliases ?? [], account: false,
  })),
];

export const DIRECTORY: DirItem[] = [...UNSORTED].sort((a, b) => rank(a.slug) - rank(b.slug));


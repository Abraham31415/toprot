import { CALCULATORS } from "./registry";
import { internalSlugFor, publicSlugFor } from "./aliases";

// Search-friendly landing content for the calculators people look for most. Everything here is plain text that appears on
// the page and in structured data, so it stays factual: no claim about a result that the calculator does not produce.
// Pages that have no entry here still get a full page (title, description, formula, assumptions, references).

export type Faq = { q: string; a: string };
export type SeoPage = {
  /** Public address: /tools/<slug>. */
  slug: string;
  /** Internal calculator slug that runs on the page. */
  tool: string;
  /** Page title before the site template adds " | ToProt". */
  title: string;
  /** Meta description, 160 characters at most. */
  description: string;
  h1: string;
  lead: string;
  whenToUse: string[];
  steps: string[];
  interpret: string[];
  /** Other calculators to link to, by internal or public slug. */
  alsoTools: string[];
  faqs: Faq[];
  /** Guide slugs. Only guides that are published are shown. */
  guides: string[];
};

export const SEO_PAGES: SeoPage[] = [
  {
    slug: "sample-size-calculator",
    tool: "sample-size-proportion",
    title: "Sample Size Calculator for Health Research",
    description: "Free sample size calculator for prevalence studies, group comparisons, case-control, cohort and survival designs, with formulas, steps and references.",
    h1: "Sample Size Calculator for Health Research",
    lead: "Work out how many participants your study needs. The calculator below estimates a single proportion, such as the prevalence of a condition in a cross-sectional survey. Choose another design from the list if you are comparing groups.",
    whenToUse: [
      "You are planning a cross-sectional survey or prevalence study and want a sample that gives a chosen margin of error.",
      "You are comparing two groups, two proportions or two means, and need enough participants for a stated power.",
      "You are planning a case-control, cohort, survival, paired or repeated-measures study and want the calculation written up for a protocol or an ethics application.",
    ],
    steps: [
      "Choose the design that matches your main research question. The calculators listed below cover the common designs.",
      "Enter the expected value from a pilot study or earlier published work. If you have no estimate for a proportion, 0.5 gives the largest and therefore safest sample.",
      "Set the confidence level and, for group comparisons, the power. 95% confidence and 80% power are common conventions, not rules.",
      "Add allowances for the design effect, a finite population and non-response if they apply.",
      "Copy the sentence and formula into your protocol and keep the references the calculator shows.",
    ],
    interpret: [
      "The result is the smallest number of participants who need to provide data. Increase it for expected dropout or non-response, which the single-proportion calculator can do for you.",
      "A sample size is only as good as its inputs. Small changes to the expected effect or proportion can change the result a lot, so try a few plausible values and report the one you chose and why.",
      "Ask a statistician to check the plan if your design is complex, for example clustered sampling or adjustment for several confounders.",
    ],
    alsoTools: [
      "sample-size-mean", "sample-size-two-proportions", "sample-size-two-means", "sample-size-paired-means", "sample-size-case-control",
      "sample-size-matched-case-control", "sample-size-cohort", "sample-size-survival", "sample-size-cluster-trial", "sample-size-diagnostic-accuracy",
      "sample-size-pre-post", "sample-size-repeated-measures", "statistical-power-calculator", "design-effect", "finite-population-correction", "nonresponse-adjustment",
    ],
    faqs: [
      { q: "What do I need to calculate a sample size?", a: "Usually the expected size of the effect or the proportion, the confidence level or significance level, the margin of error or the power you want, and the variability of the outcome. Add the dropout or non-response you expect." },
      { q: "What power should I use?", a: "Many studies aim for 80% or 90% power. Higher power needs more participants. State your choice and the reason in the protocol." },
      { q: "How do I allow for dropout or non-response?", a: "Divide the calculated sample size by one minus the expected loss. With 15% expected loss, divide by 0.85. The single-proportion calculator does this when you enter the non-response rate." },
      { q: "Why is the expected proportion set to 0.5?", a: "The product p(1 - p) is largest at 0.5, so assuming 0.5 gives the biggest and safest sample when you have no estimate. Use a better estimate if you have one." },
      { q: "Can this replace a statistician?", a: "No. It follows standard published formulas and shows its assumptions, but it is a planning aid. Complex designs should be reviewed by a statistician." },
    ],
    guides: ["how-to-calculate-sample-size"],
  },
  {
    slug: "chi-square-calculator",
    tool: "chi-square-test",
    title: "Chi-Square Test Calculator (2x2 Table)",
    description: "Free chi-square test of independence for a 2x2 table with optional Yates correction, expected counts, p-value and Cramer's V. No account needed.",
    h1: "Chi-Square Test Calculator",
    lead: "Test whether two categorical variables are associated. Enter the observed counts for a 2 x 2 table and read the chi-square statistic, degrees of freedom, p-value and expected counts.",
    whenToUse: [
      "You have two categorical variables, for example an exposure and an outcome, and want to test for an association.",
      "Your data are counts of independent participants, not paired or repeated measurements.",
      "Most expected counts are at least 5. If they are not, use Fisher's exact test instead.",
    ],
    steps: [
      "Arrange your data as a 2 x 2 table, with one variable in the rows and the other in the columns.",
      "Enter the four observed counts.",
      "Choose Pearson (no correction) or the Yates continuity correction.",
      "Read the p-value, then check the smallest expected count and the strength of association (Cramer's V).",
    ],
    interpret: [
      "The p-value is the probability of seeing an association at least this strong if the two variables were truly independent. A small p-value is evidence against independence. It is not proof of a causal link.",
      "Cramer's V describes the strength of the association on a scale from 0 to 1. Report it with the p-value, because a large sample can make a trivial association statistically significant.",
      "If any expected count is below 5, the chi-square approximation can be poor. Use the Fisher's exact test calculator.",
      "To describe how much more or less likely the outcome is, use the odds ratio or relative risk calculators.",
    ],
    alsoTools: ["fishers-exact-test", "odds-ratio-calculator", "relative-risk-calculator", "epidemiology-2x2-table"],
    faqs: [
      { q: "When should I use the chi-square test?", a: "Use it to test whether two categorical variables are associated when the observations are independent and the expected counts are large enough, commonly at least 5 in most cells." },
      { q: "Should I use the Yates continuity correction?", a: "Opinions differ. The correction makes the test more conservative for 2 x 2 tables. Many analysts use Pearson's chi-square when expected counts are adequate and Fisher's exact test when they are small. State which one you used." },
      { q: "What are the degrees of freedom?", a: "For a table with r rows and c columns they equal (r - 1)(c - 1), so a 2 x 2 table has 1 degree of freedom." },
      { q: "What if my expected counts are below 5?", a: "Use Fisher's exact test, which gives an exact p-value for a 2 x 2 table and does not rely on the chi-square approximation." },
      { q: "Does a significant result mean the exposure causes the outcome?", a: "No. The test shows an association in your data. Causation depends on the study design and on ruling out bias and confounding." },
    ],
    guides: ["choosing-a-statistical-test", "understanding-p-values-and-confidence-intervals"],
  },
  {
    slug: "odds-ratio-calculator",
    tool: "odds-ratio-calculator",
    title: "Odds Ratio Calculator with Confidence Interval",
    description: "Free odds ratio calculator from a 2x2 table with a log-scale confidence interval. Also shows relative risk, risk difference and NNT. No account needed.",
    h1: "Odds Ratio Calculator",
    lead: "Estimate the odds ratio and its confidence interval from a 2 x 2 table. The same table also gives the relative risk, the risk difference and the number needed to treat where those measures are valid.",
    whenToUse: [
      "You have a case-control study and want to describe the association between an exposure and a disease.",
      "You have cohort or cross-sectional counts and want the odds ratio alongside the relative risk.",
      "You want a quick crude estimate before running a logistic regression that adjusts for other variables.",
    ],
    steps: [
      "Put exposure in the rows and outcome in the columns, so a is exposed with the outcome and d is unexposed without it.",
      "Enter the four counts and choose a confidence level.",
      "Read the odds ratio and its interval. Check whether the interval includes 1.",
      "Copy the result sentence into your methods or results section.",
    ],
    interpret: [
      "An odds ratio of 1 means no association. A value above 1 means the odds of the outcome are higher in the exposed group, and a value below 1 means they are lower.",
      "If the confidence interval includes 1, the data are compatible with no association at that confidence level. A wide interval means the estimate is imprecise.",
      "The odds ratio overstates the relative risk when the outcome is common, so do not read it as a risk ratio unless the outcome is rare. In a cohort or cross-sectional study, the relative risk is usually easier to interpret.",
      "The estimate is crude. It is not adjusted for confounding, so use regression when other variables matter.",
    ],
    alsoTools: ["relative-risk-calculator", "risk-difference-calculator", "epidemiology-2x2-table", "chi-square-calculator", "fishers-exact-test", "simple-logistic-regression", "sample-size-case-control"],
    faqs: [
      { q: "What is an odds ratio?", a: "The odds of the outcome in the exposed group divided by the odds of the outcome in the unexposed group, where odds are the number with the outcome divided by the number without it." },
      { q: "How is the confidence interval calculated?", a: "On the log scale: the natural log of the odds ratio plus or minus the critical value times the square root of the sum of the reciprocals of the four cell counts (Woolf's method). The ends are then converted back with the exponential function." },
      { q: "What if one of the cells is zero?", a: "The odds ratio is undefined with a zero cell, so this calculator adds 0.5 to every cell, a common correction, and says so in the result notes. With very small counts consider Fisher's exact test." },
      { q: "Is an odds ratio the same as a risk ratio?", a: "No. They are similar only when the outcome is rare. When the outcome is common, the odds ratio is further from 1 than the risk ratio." },
      { q: "Can I use an odds ratio from a case-control study?", a: "Yes. In a case-control study the odds ratio is the standard measure of association, because risk cannot be estimated directly when cases and controls are sampled separately." },
    ],
    guides: ["how-to-choose-a-study-design", "understanding-p-values-and-confidence-intervals"],
  },
  {
    slug: "diagnostic-accuracy-calculator",
    tool: "diagnostic-test-calculator",
    title: "Diagnostic Test Accuracy Calculator",
    description: "Free calculator for sensitivity, specificity, PPV, NPV, likelihood ratios and diagnostic odds ratio with confidence intervals from a 2x2 table.",
    h1: "Diagnostic Test Accuracy Calculator",
    lead: "Compare a test result with a reference standard and get sensitivity, specificity, predictive values, likelihood ratios and the diagnostic odds ratio, each with a confidence interval where one applies.",
    whenToUse: [
      "You are evaluating a screening or diagnostic test against a reference standard in a study sample.",
      "You need sensitivity and specificity with confidence intervals for a protocol, thesis or manuscript.",
      "You want likelihood ratios to update the probability of disease after a positive or negative result.",
    ],
    steps: [
      "Enter the true positives, false positives, false negatives and true negatives from your 2 x 2 table.",
      "Choose a confidence level.",
      "Read sensitivity, specificity and the predictive values with their intervals.",
      "Check the prevalence in your sample before you interpret the predictive values.",
    ],
    interpret: [
      "Sensitivity is the proportion of people with the disease who test positive. Specificity is the proportion of people without the disease who test negative.",
      "Positive and negative predictive values depend on how common the disease is. The values shown apply only at the prevalence in your sample, so they may not transfer to a population where the disease is rarer or commoner.",
      "A positive likelihood ratio well above 1 and a negative likelihood ratio well below 1 mean the test changes the probability of disease substantially. The farther from 1, the stronger the evidence.",
      "Results depend on the quality of the reference standard and on how participants were selected. Report the study following the STARD guideline.",
    ],
    alsoTools: ["sample-size-diagnostic-accuracy", "odds-ratio-calculator", "prevalence-calculator", "epidemiology-2x2-table"],
    faqs: [
      { q: "What is the difference between sensitivity and specificity?", a: "Sensitivity measures how well a test detects people who have the disease. Specificity measures how well it correctly clears people who do not." },
      { q: "Why do predictive values change with prevalence?", a: "A positive result is more likely to be a true positive when the disease is common and more likely to be a false positive when it is rare, even if sensitivity and specificity stay the same." },
      { q: "What is a likelihood ratio?", a: "The positive likelihood ratio is sensitivity divided by one minus specificity. The negative likelihood ratio is one minus sensitivity divided by specificity. They describe how much a result shifts the odds of disease." },
      { q: "Do I need a reference standard?", a: "Yes. Accuracy is measured against the best available way of knowing who truly has the disease. Without a reference standard the figures cannot be interpreted." },
      { q: "How many participants do I need for a diagnostic accuracy study?", a: "Use the diagnostic accuracy sample size calculator, which sizes the study for a target sensitivity or specificity with a chosen precision." },
    ],
    guides: ["reporting-guidelines-explained", "how-to-choose-a-study-design"],
  },
  {
    slug: "statistical-power-calculator",
    tool: "statistical-power-two-proportions",
    title: "Statistical Power Calculator for Two Groups",
    description: "Free power calculator for comparing two proportions or two means. Find the power of your design at a given sample size, with the formula and references.",
    h1: "Statistical Power Calculator",
    lead: "Find the power of a comparison between two groups at the sample size you can achieve. The calculator below compares two proportions. Use the link for two means if your outcome is a continuous measurement.",
    whenToUse: [
      "Your sample size is limited, for example by a fixed number of patients, and you want to know the power you have.",
      "You are checking a plan for a sensitivity analysis, to see how power changes if the effect is smaller than expected.",
      "An ethics committee or supervisor has asked you to justify that the study can detect a meaningful difference.",
    ],
    steps: [
      "Enter the number of participants in the first group and the expected proportions in both groups.",
      "Set the confidence level and the allocation ratio between the groups.",
      "Read the power. Try smaller differences to see how quickly it falls.",
      "If the power is too low, plan more participants with the matching sample size calculator.",
    ],
    interpret: [
      "Power is the probability that the study detects a true difference of the size you entered, using your sample size and significance level. Many studies aim for 80% or 90%.",
      "Choose a difference that would matter in practice, not simply the one that makes the study feasible.",
      "Power should be planned before the data are collected. Calculating power afterwards from the observed result adds nothing beyond the p-value, so report a confidence interval instead.",
    ],
    alsoTools: ["statistical-power-two-means", "sample-size-two-proportions", "sample-size-two-means", "effect-size"],
    faqs: [
      { q: "What is statistical power?", a: "The probability of detecting an effect of a stated size when the effect truly exists. It is one minus the chance of a false negative." },
      { q: "What is a good level of power?", a: "Conventions of 80% or 90% are widely used. The right level depends on the consequences of missing a real effect, so justify your choice." },
      { q: "How can I increase power?", a: "Increase the sample size, study a larger effect, reduce variability in the outcome, or accept a higher significance level. Each choice has costs that you should state." },
      { q: "Is this the same as a sample size calculation?", a: "They use the same quantities. A sample size calculation solves for the number of participants at a chosen power. A power calculation solves for the power at a fixed number of participants." },
      { q: "Can I use this after my study to show it was powered?", a: "Power calculated from the observed result is not informative. Report the effect estimate with its confidence interval instead." },
    ],
    guides: ["how-to-calculate-sample-size", "understanding-p-values-and-confidence-intervals"],
  },
];

const bySlug = new Map(SEO_PAGES.map((p) => [p.slug, p]));
export const getSeoPage = (publicSlug: string): SeoPage | undefined => bySlug.get(publicSlug);

/** Public slugs of every calculator page, used for static generation and the sitemap. */
export function allPublicToolSlugs(): string[] {
  const set = new Set<string>(CALCULATORS.map((c) => publicSlugFor(c.slug)));
  for (const p of SEO_PAGES) set.add(p.slug);
  return [...set];
}

/** The calculator that runs on a public page. */
export const toolForPublicSlug = (publicSlug: string): string => getSeoPage(publicSlug)?.tool ?? internalSlugFor(publicSlug);

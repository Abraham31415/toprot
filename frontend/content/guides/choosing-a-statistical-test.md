---
title: Choosing a statistical test
description: How to choose between common tests by outcome type, number of groups and study design, including t-tests, chi-square, ANOVA and regression.
summary: The right test depends on what you measured, how many groups you have and whether the data are paired.
category: biostatistics
status: draft
author: ToProt editorial team (AI-assisted draft, not yet reviewed)
updatedOn: 2026-11-12
featured: false
keywords: [statistical test, t-test, chi-square, choosing a test]
tools: [chi-square-calculator, fishers-exact-test, two-sample-t-test, paired-t-test, one-way-anova, pearson-correlation, spearman-correlation, simple-linear-regression, simple-logistic-regression]
related: [understanding-p-values-and-confidence-intervals, how-to-calculate-sample-size]
sources:
  - citation: "Altman DG. Practical Statistics for Medical Research. London: Chapman and Hall; 1991."
    verified: false
    note: Carried over from the earlier draft. Not checked against the original source. Confirm the details before publishing.
  - citation: "Bland M. An Introduction to Medical Statistics. 4th ed. Oxford: Oxford University Press; 2015."
    verified: false
    note: Carried over from the earlier draft. Not checked against the original source. Confirm the details before publishing.
  - citation: "Agresti A. Categorical Data Analysis. 3rd ed. Hoboken: Wiley; 2013."
    verified: false
    note: Carried over from the earlier draft. Not checked against the original source. Confirm the details before publishing.
---

## Ask three questions

- What type is the outcome? Continuous (a measurement), categorical (groups), or time to an event.
- How many groups or measurements are being compared?
- Are the observations independent, or paired or repeated in the same people?

## Continuous outcomes

- Two independent groups: the two-sample t-test, or a rank-based test such as the Mann-Whitney test when the data are clearly not normal and the sample is small.
- Two paired measurements: the paired t-test, or the Wilcoxon signed-rank test.
- More than two independent groups: one-way analysis of variance (ANOVA), followed by a post hoc comparison, or the Kruskal-Wallis test.
- Linking two continuous variables: Pearson correlation, or Spearman rank correlation for monotonic or non-normal data, and simple linear regression for prediction.

## Categorical outcomes

- Two categorical variables: the chi-square test when expected counts are large enough, and Fisher's exact test when they are small.
- Describing the strength of association: the odds ratio or relative risk with a confidence interval.
- A binary outcome with several predictors: logistic regression.

## Time to an event

When the outcome is the time until an event, such as death or relapse, and some participants have not had the event by the end of follow-up, ordinary tests do not use the data properly. Survival methods, such as the Kaplan-Meier estimate with the log-rank test, or Cox regression, are designed for this. Plan these with a statistician.

## Worked examples

- Mean blood pressure in a treated group and a different untreated group: two-sample t-test.
- Weight before and after a programme in the same people: paired t-test.
- Proportion with an infection on two wards: chi-square test, or Fisher's exact test if counts are small.
- Link between age and a laboratory value: Pearson or Spearman correlation.
- How smoking is linked to a disease after adjusting for age and sex: logistic regression.

## Normal or not

Normality matters most in small samples. With large samples the t-test is usually robust to moderate departures from normality. With small samples, look at a plot of the data and consider a rank-based test if the distribution is clearly skewed.

## Check the assumptions

Most tests assume independent observations. Many also assume roughly normal data or large enough counts. Look at your data with a plot before choosing, and say in the methods which assumptions you checked and how.

## Plan the test before the data

Choose the test for each objective in the analysis plan before collecting data. Running many tests and reporting only the significant ones inflates false positives. If you do run several comparisons, say so and consider an adjustment.

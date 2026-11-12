---
title: Understanding p-values and confidence intervals
description: What a p-value and a 95% confidence interval mean, how to calculate and report them with worked examples, and the common mistakes to avoid.
summary: A p-value tells you how surprising your data would be if there were no effect. A confidence interval shows which effect sizes are compatible with the data. You need both.
category: biostatistics
status: published
author: ToProt editorial team
updatedOn: 2026-11-12
featured: true
keywords: [p-value, confidence interval, statistical significance, hypothesis test, standard error, t-test, multiple testing, effect size]
tools: [confidence-interval-mean, confidence-interval-proportion, one-sample-t-test, two-sample-t-test, chi-square-calculator, effect-size]
related: [how-to-calculate-sample-size, choosing-a-statistical-test]
reviewedBy: ToProt editorial team
reviewedOn: 2026-11-12
publishedOn: 2026-11-12
sources:
  - citation: "Wasserstein RL, Lazar NA. The ASA statement on p-values: context, process, and purpose. Am Stat. 2016;70(2):129-133."
    doi: 10.1080/00031305.2016.1154108
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and pages match. The issue number is from the journal's usual citation.
  - citation: "Greenland S, Senn SJ, Rothman KJ, et al. Statistical tests, P values, confidence intervals, and power: a guide to misinterpretations. Eur J Epidemiol. 2016;31(4):337-350."
    doi: 10.1007/s10654-016-0149-3
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and pages match. The issue number is from the journal's usual citation.
  - citation: "Altman DG, Bland JM. Statistics notes: absence of evidence is not evidence of absence. BMJ. 1995;311(7003):485."
    doi: 10.1136/bmj.311.7003.485
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and first page match. The issue number is from the journal's usual citation.
  - citation: "Gardner MJ, Altman DG. Confidence intervals rather than P values: estimation rather than hypothesis testing. BMJ. 1986;292(6522):746-750."
    doi: 10.1136/bmj.292.6522.746
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and pages match. The issue number is from the journal's usual citation.
  - citation: "Sterne JAC, Davey Smith G. Sifting the evidence: what's wrong with significance tests? BMJ. 2001;322(7280):226-231."
    doi: 10.1136/bmj.322.7280.226
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and pages match. The issue number is from the journal's usual citation.
  - citation: "Amrhein V, Greenland S, McShane B. Scientists rise up against statistical significance. Nature. 2019;567(7748):305-307."
    doi: 10.1038/d41586-019-00857-9
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and pages match. The issue number is from the journal's usual citation.
  - citation: "Newcombe RG. Two-sided confidence intervals for the single proportion: comparison of seven methods. Stat Med. 1998;17(8):857-872."
    doi: 10.1002/(SICI)1097-0258(19980430)17:8<857::AID-SIM777>3.0.CO;2-E
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and pages match. The issue number is from the DOI.
---

## Two ideas, one question

Most studies take a sample and ask what it says about a larger population. Two tools answer that question in different ways.

- A **confidence interval** gives a range of values for the effect that are compatible with the data. It shows how large the effect might be and how precisely it has been measured.
- A **p-value** is a single number that measures how well the data fit the hypothesis that there is no effect.

Reporting only a p-value hides the size and the precision of the effect, which is why journals and statisticians recommend reporting an estimate with its confidence interval [4].

## What a p-value is

A p-value is the probability of obtaining results at least as extreme as those observed, **if the null hypothesis and all the other assumptions behind the calculation were true** [2]. The null hypothesis is usually "there is no difference" or "there is no association".

A small p-value means that the data would be unusual if there were no effect, so the data and the null hypothesis do not fit well. It does not say which assumption failed: the null hypothesis, the model, the way the data were collected or chance.

By convention results with p below 0.05 are called "statistically significant". That threshold is a convention, not a law of nature, and the American Statistical Association has stated that conclusions should not rest on whether a p-value crosses a threshold [1]. Its main points are:

- A p-value can indicate how incompatible the data are with a specified model.
- It is not the probability that the hypothesis is true, and not the probability that the data arose by chance alone.
- It does not measure the size or importance of an effect.
- On its own it is not a good measure of evidence about a hypothesis.
- Proper inference needs full reporting of what was analysed and why.

## What a confidence interval is

A 95% confidence interval is calculated so that, if the study were repeated many times and an interval calculated each time, about 95% of those intervals would contain the true value. For one interval, the true value is either inside it or not; the 95% describes the method, not that interval.

In practice, read the interval as the range of effect sizes that are reasonably compatible with your data, given your assumptions [2,6]. A narrow interval means a precise estimate. A wide interval means the study cannot pin down the effect. The width falls as the sample size rises, which is why the sample size guide matters.

For a mean, the interval is

$$
mean ± t × SE, where SE = s / √n
$$

s is the sample standard deviation, n is the sample size and t is the value from the t distribution with n − 1 degrees of freedom (about 1.96 for large samples and larger for small ones).

For the difference between two proportions, the usual approximation is

$$
(p₁ − p₂) ± 1.96 × √( p₁(1 − p₁)/n₁ + p₂(1 − p₂)/n₂ )
$$

## Worked example 1: a mean

> A trial gives 40 patients a new treatment (fictional data). Their blood pressure falls on average by 8 mmHg, with a standard deviation of 12 mmHg.
>
> Standard error: SE = 12 / √40 = 1.897.
>
> With 39 degrees of freedom, t = 2.023. The 95% confidence interval is 8 ± 2.023 × 1.897 = 8 ± 3.84, which is **4.2 to 11.8 mmHg**.
>
> To test whether the mean change differs from zero: t = 8 / 1.897 = 4.22, and the two-sided p-value is **0.00014**, usually reported as p < 0.001.
>
> The average fall is probably between about 4 and 12 mmHg. The interval excludes zero, which agrees with the small p-value, and it also tells you how large the effect might be.

## Worked example 2: a difference in proportions

> In a survey, 45 of 150 women who did not take iron supplements were anaemic (30%), compared with 30 of 150 women who did (20%). The difference is 0.10, or 10 percentage points (fictional data).
>
> Standard error of the difference: √(0.30 × 0.70/150 + 0.20 × 0.80/150) = 0.0497.
>
> 95% confidence interval: 0.10 ± 1.96 × 0.0497 = **0.3 to 19.7 percentage points**.
>
> Test of no difference, using the pooled proportion (0.25): z = 0.10 / √(0.25 × 0.75 × (1/150 + 1/150)) = 2.00, giving **p = 0.046**.
>
> The p-value is just below 0.05, so the result would be called significant. But the interval shows that the true difference could be anywhere from almost nothing to nearly 20 points. A single p-value near 0.05 is weak evidence, and the interval conveys that better.

## Worked example 3: when the result is not significant

> A smaller trial finds that a treatment lowers blood pressure by 4 mmHg more than control, with a standard error of 3 mmHg (fictional data). z = 4 / 3 = 1.33, so p = 0.18. The 95% confidence interval is 4 ± 1.96 × 3, which is **−1.9 to +9.9 mmHg**.
>
> The result is "not significant", but it would be wrong to conclude the treatment does not work. The interval includes no effect, and it also includes a reduction of nearly 10 mmHg, which would matter clinically. The study is inconclusive, not negative [3].

## A confidence interval for a single proportion

For a proportion, the simple (Wald) interval, p ± 1.96 × √(p(1 − p)/n), can be inaccurate when the sample is small or the proportion is near 0 or 1. The Wilson score method is better [7]. For 45 anaemic women in 150 (30%), the simple interval is 22.7% to 37.3% and the Wilson interval is 23.2% to 37.8%. The ToProt proportion calculator offers the Wilson score and the Clopper-Pearson exact intervals.

## Statistical significance is not importance

A very large study can find a trivial difference with a tiny p-value, and a small study can miss an important one. Always ask how large the effect is and whether it matters to patients or policy. Report the effect size, such as a difference in means, a risk ratio or an odds ratio, with its confidence interval, and judge it against the smallest difference that would matter clinically [2,5].

## Many tests, many false positives

Each test at the 0.05 level has a 5% chance of a false positive if there is truly no effect. If you run many tests, the chance of at least one false positive grows. With 20 independent tests it is 1 − 0.95²⁰ = 64%. Decide your primary analysis before you see the data, label other analyses as exploratory, and consider adjusting for multiple comparisons, for example by the Bonferroni method, which divides the threshold by the number of tests (0.05 / 20 = 0.0025). Trying analyses until one is significant and reporting only that one ("p-hacking") makes the p-value meaningless [1,5].

## How to report results

- Give the estimate and its 95% confidence interval: "the mean fall was 8.0 mmHg (95% CI 4.2 to 11.8)".
- Give the exact p-value, such as p = 0.046, and write p < 0.001 for very small values rather than p = 0.000.
- Say which test you used and whether it was two-sided.
- Describe the size and importance of the effect in words, not only whether it crossed a threshold.
- Do not describe a result with p above 0.05 as showing "no effect" [3].

## Common mistakes

- Treating p = 0.05 as the probability that the null hypothesis is true.
- Treating p above 0.05 as proof of no difference.
- Reading a 95% confidence interval as "there is a 95% chance the true value is in this interval".
- Reporting only p-values with no estimate or interval.
- Calling a result "highly significant" and ignoring a tiny effect.
- Running many tests and reporting only the significant ones.

## Limitations

Both tools describe random sampling error only. They say nothing about bias, confounding, measurement error or a poorly chosen sample, and these can be far larger than the sampling error. They also depend on the assumptions of the method, such as independent observations and an approximately normal distribution of the estimate. A significant result from a biased study is still biased. For anything beyond the simple cases here, seek the advice of a statistician [2].

## Use it in ToProt

The [confidence interval for a mean](/tools/confidence-interval-mean) and the [confidence interval for a proportion](/tools/confidence-interval-proportion) calculators reproduce the examples above. The [one-sample t-test](/tools/one-sample-t-test), [two-sample t-test](/tools/two-sample-t-test) and [chi-square test](/tools/chi-square-calculator) calculators report the test statistic, the p-value and an interval, and the [effect size calculator](/tools/effect-size) shows how large a difference is.

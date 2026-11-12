---
title: How to calculate sample size for research
description: Learn the formulas for sample size in prevalence studies, comparisons of means and proportions, with worked examples, dropout, finite populations and clusters.
summary: The sample size decides whether your study can answer its question. This guide shows the formulas, the inputs they need and how to report the result.
category: biostatistics
status: draft
author: ToProt editorial team (AI-assisted draft, not yet reviewed)
updatedOn: 2026-11-12
featured: true
keywords: [sample size, sample size calculation, power, margin of error, prevalence, two proportions, two means, dropout, design effect]
tools: [sample-size-calculator, sample-size-proportion, sample-size-mean, sample-size-two-proportions, sample-size-two-means, finite-population-correction, design-effect, nonresponse-adjustment, statistical-power-calculator]
related: [how-to-write-a-research-protocol, understanding-p-values-and-confidence-intervals]
sources:
  - citation: "Charan J, Biswas T. How to calculate sample size for different study designs in medical research? Indian J Psychol Med. 2013;35(2):121-126."
    doi: 10.4103/0253-7176.116232
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and pages match.
  - citation: "Kadam P, Bhalerao S. Sample size calculation. Int J Ayurveda Res. 2010;1(1):55-57."
    doi: 10.4103/0974-7788.59946
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and first page match. The end page is from the journal's usual citation.
  - citation: "Schulz KF, Grimes DA. Sample size calculations in randomised trials: mandatory and mystical. Lancet. 2005;365(9467):1348-1353."
    doi: 10.1016/S0140-6736(05)61034-3
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and pages match. The issue number is from the journal's usual citation.
  - citation: "Bacchetti P. Current sample size conventions: flaws, harms, and alternatives. BMC Med. 2010;8:17."
    doi: 10.1186/1741-7015-8-17
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year and volume match. The article number is from the journal's usual citation.
  - citation: "Lwanga SK, Lemeshow S. Sample Size Determination in Health Studies: A Practical Manual. Geneva: World Health Organization; 1991."
    verified: false
    note: Book. Not checked against a copy or the WHO catalogue. Confirm the details before publishing.
  - citation: "Kish L. Survey Sampling. New York: John Wiley and Sons; 1965."
    verified: false
    note: Book. The source of the design effect idea. Not checked against a copy. Confirm the details before publishing.
---

## Why sample size matters

The sample size is the number of participants a study needs. If it is too small, the study may be unable to detect a real effect, or its estimates will be so imprecise that they are of little use. If it is too large, more people than necessary are exposed to the burden and risk of the study, and time and money are wasted. Ethics committees and funders therefore expect a calculation in the protocol, not a convenient number [3,4].

Every calculation answers one of two questions:

- **Estimation:** how many participants do I need to estimate a quantity, such as a prevalence or a mean, with a stated precision?
- **Comparison:** how many do I need to detect a difference of a stated size between groups, with a stated chance of finding it if it is real?

## The inputs you must choose

| Input | Meaning | Usual choice |
|---|---|---|
| Confidence level (1 − α) | How sure you want to be that an interval contains the true value. Equivalently, α is the chance of a false positive. | 95% (α = 0.05, two-sided) |
| Z for the confidence level (Z) | The standard normal value for that level | 1.645 for 90%, 1.960 for 95%, 2.576 for 99% |
| Power (1 − β) | The chance of detecting the difference if it is real | 80% or 90% |
| Z for power | The standard normal value for that power | 0.842 for 80%, 1.282 for 90%, 1.645 for 95% |
| Precision (d) | The half-width you accept for the interval, in the units of the quantity | Chosen from the purpose of the study |
| Expected value or variability | An expected proportion, or the standard deviation (SD) of a measurement | From a pilot study or published work |
| Effect size | The smallest difference worth detecting | The smallest clinically meaningful difference |

The expected values are the weakest part of most calculations, because they are guesses made before the study. Take them from a pilot study or from published studies in a similar population, say where they came from, and do not choose them to produce a convenient answer [4].

## Estimating one proportion (a prevalence)

$$
n = Z² × p × (1 − p) / d²
$$

Here p is the expected proportion and d is the precision as a proportion. When you have no idea of p, use p = 0.5, which gives the largest value of p(1 − p) and so the largest, safest sample size.

> **Worked example: prevalence of anaemia**
>
> You expect about 40% of pregnant women to be anaemic (p = 0.40), you want a precision of plus or minus 5 percentage points (d = 0.05) and 95% confidence (Z = 1.96).
>
> n = 1.96² × 0.40 × 0.60 / 0.05² = 3.8416 × 0.24 / 0.0025 = 368.8, which is **369** women.
>
> With no prior estimate (p = 0.5), n = 3.8416 × 0.25 / 0.0025 = 384.2, which rounds up to **385**.
>
> Always round up, because rounding down gives less than the precision you asked for.

The sample size rises quickly as the precision is tightened, because d is squared. For p = 0.40 and 95% confidence:

| Precision (d) | Sample size |
|---|---|
| ±10 points | 93 |
| ±7 points | 189 |
| ±5 points | 369 |
| ±4 points | 577 |
| ±3 points | 1,025 |

## Estimating one mean

$$
n = Z² × σ² / d²
$$

σ is the expected standard deviation of the measurement and d is the precision in the same units.

> **Worked example: mean blood pressure**
>
> The expected SD of systolic blood pressure is 15 mmHg, and you want the mean estimated within plus or minus 3 mmHg at 95% confidence.
>
> n = 1.96² × 15² / 3² = 3.8416 × 225 / 9 = 96.04, which is **97** participants.

## Comparing two proportions

For two independent groups of equal size, the number needed per group is

$$
n per group = [ Zα/2 × √(2 × p̄ × (1 − p̄)) + Zβ × √(p₁(1 − p₁) + p₂(1 − p₂)) ]² / (p₁ − p₂)²
$$

where p₁ and p₂ are the expected proportions in the two groups, p̄ is their average, Zα/2 is the Z value for the confidence level and Zβ is the Z value for the power.

> **Worked example: two groups**
>
> You expect 30% of one group and 20% of the other to have the outcome (p₁ = 0.30, p₂ = 0.20, so p̄ = 0.25). You use 95% confidence (Zα/2 = 1.96) and 80% power (Zβ = 0.8416).
>
> n per group = [1.96 × √(2 × 0.25 × 0.75) + 0.8416 × √(0.30 × 0.70 + 0.20 × 0.80)]² / 0.10² = **294** per group, or **588** in total.
>
> If you expect 10% to drop out, divide by 0.90: 294 / 0.90 = 326.7, so **327** per group (654 in total).

Different programs may give slightly different answers because some add a continuity correction or use another approximation. Say which method you used.

## Comparing two means

For two independent groups of equal size:

$$
n per group = 2 × σ² × (Zα/2 + Zβ)² / Δ²
$$

σ is the common standard deviation and Δ is the difference between means you want to detect.

> **Worked example: two means**
>
> The SD is 10 units and you want to detect a difference of 5 units (Δ = 5) with 95% confidence and 80% power.
>
> n per group = 2 × 100 × (1.96 + 0.8416)² / 25 = 2 × 100 × 7.849 / 25 = 62.8, which is **63** per group, or 126 in total. With 10% dropout, 63 / 0.90 = 70 per group.

Halving the difference you want to detect multiplies the sample size by four, so be realistic about the smallest difference that matters.

## Adjusting for real conditions

**Dropout and non-response.** Divide the calculated sample size by the proportion expected to complete the study (1 − dropout rate). A 10% dropout means dividing by 0.90. The result is the number to enrol.

**A small population.** When you sample a large fraction of a small, known population of size N, the finite population correction reduces the sample size:

$$
n adjusted = n / (1 + (n − 1) / N)
$$

For the anaemia example with a population of N = 1,500 women: 369 / (1 + 368 / 1,500) = 296.3, which is **297**. The correction matters only when the sample is more than a few percent of the population.

**Cluster sampling.** If participants are chosen in groups, such as clinics or villages, people in the same group resemble each other, which reduces the information each person adds. Multiply the sample size by the design effect [6]:

$$
Design effect = 1 + (m − 1) × ICC
$$

m is the average number of participants per cluster and ICC is the intracluster correlation coefficient. With m = 20 and ICC = 0.05, the design effect is 1 + 19 × 0.05 = 1.95, so the 369 women become 369 × 1.95 = 719.6, which is **720**.

## How to report the calculation

State the design and purpose, the formula or program used, every input with its source, and the final number including any adjustments. For example:

"We needed 410 participants to estimate the prevalence of anaemia with a precision of plus or minus 5 percentage points at 95% confidence, assuming a prevalence of 40% based on a regional survey [reference] and allowing for 10% non-response."

## Limitations and cautions

- **The result is only as good as the inputs.** If the true prevalence or SD differs from what you assumed, the precision or power will differ too. Run the calculation for a range of plausible inputs and report the sensitivity [4].
- **These formulas assume simple random sampling and approximately normal estimates.** Small samples, very rare or very common outcomes, and other designs need other methods, such as exact methods or simulation.
- **Power is not a guarantee.** With 80% power, one study in five will miss a real effect of the size assumed.
- **A single calculation covers a single primary question.** Secondary analyses, subgroup analyses and regression models with many variables may need more participants, and rules of thumb for them are debated, so ask a statistician.
- **Do not work backwards.** Choosing the effect size to fit the number of participants you can afford, and presenting it as if it were chosen first, misleads reviewers [3,4].
- **A feasibility sample is not a calculation.** A pilot study is useful for estimating SDs and recruitment rates but not for confirming that an effect exists.

Always have a statistician review the calculation for a study that will influence clinical decisions or that has an unusual design.

## Use it in ToProt

The [sample size calculator](/tools/sample-size-calculator) uses these formulas and shows its steps, with a table of how the result changes with dropout and precision. Individual calculators are also available for a [single proportion](/tools/sample-size-proportion), a [single mean](/tools/sample-size-mean), [two proportions](/tools/sample-size-two-proportions) and [two means](/tools/sample-size-two-means). The [finite population correction](/tools/finite-population-correction), [design effect](/tools/design-effect) and [non-response adjustment](/tools/nonresponse-adjustment) tools apply the adjustments above, and the [power calculator](/tools/statistical-power-calculator) shows the power of a study of a given size. The result can be saved in the sample size section of your protocol.

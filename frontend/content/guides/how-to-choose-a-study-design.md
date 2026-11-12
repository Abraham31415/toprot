---
title: How to choose the appropriate study design
description: Compare cross-sectional, case-control, cohort and randomised designs, see what each can answer, and choose one for your research question.
summary: The design decides what your study can and cannot show. Match it to the question first, then check what is feasible.
category: epidemiology
status: draft
author: ToProt editorial team (AI-assisted draft, not yet reviewed)
updatedOn: 2026-11-12
featured: true
keywords: [study design, cross-sectional, case-control, cohort, randomised controlled trial, odds ratio, relative risk, bias, confounding]
tools: [study-design-assistant, research-question-builder, odds-ratio-calculator, relative-risk-calculator, epidemiology-2x2-table, sample-size-calculator]
related: [how-to-write-a-research-protocol, how-to-calculate-sample-size]
sources:
  - citation: "Mann CJ. Observational research methods. Research design II: cohort, cross sectional, and case-control studies. Emerg Med J. 2003;20(1):54-60."
    doi: 10.1136/emj.20.1.54
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and pages match.
  - citation: "Grimes DA, Schulz KF. Cohort studies: marching towards outcomes. Lancet. 2002;359(9303):341-345."
    doi: 10.1016/S0140-6736(02)07500-1
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and pages match. The issue number is from the journal's usual citation.
  - citation: "Schulz KF, Grimes DA. Case-control studies: research in reverse. Lancet. 2002;359(9304):431-434."
    doi: 10.1016/S0140-6736(02)07605-5
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and pages match. The issue number is from the journal's usual citation.
  - citation: "Setia MS. Methodology series module 3: cross-sectional studies. Indian J Dermatol. 2016;61(3):261-264."
    doi: 10.4103/0019-5154.182410
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year and first page match. The issue and end page are from the journal's usual citation.
  - citation: "Schulz KF, Altman DG, Moher D; CONSORT Group. CONSORT 2010 statement: updated guidelines for reporting parallel group randomised trials. BMJ. 2010;340:c332."
    doi: 10.1136/bmj.c332
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year and article number match.
  - citation: "von Elm E, Altman DG, Egger M, Pocock SJ, Gotzsche PC, Vandenbroucke JP. The Strengthening the Reporting of Observational Studies in Epidemiology (STROBE) statement: guidelines for reporting observational studies. Lancet. 2007;370(9596):1453-1457."
    doi: 10.1016/S0140-6736(07)61602-X
    verified: true
    note: Record found at Crossref on 2026-11-12; title, journal, year, volume and pages match.
  - citation: "Hulley SB, Cummings SR, Browner WS, Grady DG, Newman TB. Designing Clinical Research. 4th ed. Philadelphia: Lippincott Williams & Wilkins; 2013."
    verified: false
    note: Book. Not checked against a copy. Confirm the edition, publisher and the chapters cited before publishing.
---

## Start from the question, not from the design

A study design is the structure that decides who is studied, what is measured and when. The same topic can be studied in several ways, and each answers a different question. Decide what you want to know first.

| If your question is | The design that usually fits |
|---|---|
| How common is a condition or exposure now? | Cross-sectional survey |
| Is an exposure linked to an outcome, and the outcome is rare? | Case-control study |
| Does an exposure change the risk of an outcome over time? | Cohort study |
| Does an intervention cause a benefit or harm? | Randomised controlled trial |
| How well does a test detect a disease? | Diagnostic accuracy study |
| What happened to a few unusual patients? | Case report or case series |

Then check that the design is feasible: how many people you can reach, how long you can follow them, and whether it is ethical to assign or withhold an exposure.

## Descriptive designs

**Case reports and case series** describe one patient or a small group. They are useful for rare events and new ideas, but they have no comparison group, so they cannot show how common something is or whether an exposure caused it.

**Cross-sectional studies** measure exposure and outcome in a sample at one point in time [4]. They estimate **prevalence**, the proportion of people with a condition at that time, and they are quick and relatively cheap. Because exposure and outcome are measured together, a cross-sectional study cannot show which came first, and it captures people who currently have the condition, which over-represents long-lasting disease.

## Analytic observational designs

**Case-control studies** start from the outcome [3]. Investigators select people with the disease (cases) and people without it (controls) and look back at their exposures. They suit rare outcomes and diseases with long latency, and they need fewer participants than a cohort. Their weaknesses are choosing a fair control group and relying on memory of past exposure (recall bias). They cannot give the risk of disease directly, only the odds ratio.

**Cohort studies** start from the exposure [2]. Investigators follow exposed and unexposed people over time and compare how many develop the outcome. They can measure incidence, show that exposure came before outcome and study several outcomes of one exposure. They are slow and costly, they need many participants for rare outcomes, and loss to follow-up can bias the result. A cohort can be prospective (followed forward from now) or retrospective (built from existing records).

## Experimental design

In a **randomised controlled trial** participants are allocated to an intervention or a comparison by chance. Randomisation makes the groups alike in known and unknown characteristics on average, so a difference in outcome can be attributed to the intervention. Trials are the strongest design for testing an intervention, but they are expensive, may be unethical when an intervention is already known to work or an exposure is harmful, and their results apply only to people like those enrolled. They are reported with the CONSORT guideline [5].

## Measures of association, with worked examples

Observational designs report how strongly an exposure is linked to an outcome. For a 2 by 2 table with a, b, c and d defined below:

| | Outcome | No outcome |
|---|---|---|
| Exposed | a | b |
| Unexposed | c | d |

$$
Risk ratio (RR) = [a / (a + b)] / [c / (c + d)]
Risk difference (RD) = a / (a + b) − c / (c + d)
Odds ratio (OR) = (a × d) / (b × c)
$$

The 95% confidence interval of a ratio is calculated on the log scale: exp[ln(estimate) ± 1.96 × SE], where SE(ln RR) = √(1/a − 1/(a+b) + 1/c − 1/(c+d)) and SE(ln OR) = √(1/a + 1/b + 1/c + 1/d).

> **Worked example: cohort study**
>
> A cohort follows 100 exposed and 100 unexposed people (fictional numbers). Outcomes occur in 30 of the exposed and 15 of the unexposed, so a = 30, b = 70, c = 15 and d = 85.
>
> Risk in exposed = 30/100 = 0.30. Risk in unexposed = 15/100 = 0.15. RR = 0.30 / 0.15 = **2.00**, 95% CI 1.15 to 3.48. RD = 0.15, which means 15 extra cases per 100 exposed people. OR = (30 × 85) / (70 × 15) = **2.43**, 95% CI 1.21 to 4.87.
>
> The exposed group has twice the risk. Notice that the OR (2.43) is further from 1 than the RR (2.00): when the outcome is common, the odds ratio overstates the risk ratio, so do not read it as a risk ratio.

> **Worked example: case-control study**
>
> A study enrols 60 cases and 120 controls (fictional). Among cases, 40 were exposed and 20 were not. Among controls, 30 were exposed and 90 were not. So a = 40, b = 20, c = 30 and d = 90.
>
> OR = (40 × 90) / (20 × 30) = **6.0**, 95% CI 3.05 to 11.81. Cases had six times the odds of exposure compared with controls. A case-control study cannot report the risk ratio or risk difference, because the investigators chose how many cases and controls to include.

> **Worked example: cross-sectional study**
>
> A survey of 300 pregnant women finds 120 with anaemia. Prevalence = 120 / 300 = **40%**. The confidence interval for a proportion depends on the sample size; the guide on p-values and confidence intervals shows how to calculate it.

## Bias and confounding

Whatever the design, ask what could make the result wrong.

- **Selection bias:** the people studied differ from those you want to describe, for example because controls are chosen unfairly or many participants are lost to follow-up.
- **Information bias:** exposure or outcome is measured with error, for example recall bias in case-control studies.
- **Confounding:** a third factor is linked to both exposure and outcome and distorts their relationship. Age is a common confounder. Randomisation handles confounding by design; in observational studies you must measure confounders and adjust for them, and unmeasured confounders can remain.

## Strengths and limits compared

| Design | Main strength | Main limit |
|---|---|---|
| Cross-sectional | Fast, cheap, gives prevalence | Cannot show which came first |
| Case-control | Efficient for rare outcomes | Recall and control-selection bias; gives odds ratios only |
| Cohort | Shows time order, gives incidence and risk | Slow, costly, loss to follow-up |
| Randomised trial | Best protection against confounding | Costly, not always ethical or feasible |

## A short way to choose

1. Write the question and name the outcome and the exposure or intervention.
2. If you want to describe frequency now, use a cross-sectional design.
3. If you want to test whether an intervention works and can ethically randomise, use a randomised trial.
4. If you cannot randomise, choose between a cohort (exposure rare or several outcomes wanted, and you can follow people) and a case-control study (outcome rare or slow to develop).
5. Check the number of participants you would need and whether you can reach them. The sample size guide shows how.
6. Write down the biases the design is open to and how you will limit them.

## Reporting guidelines

Choose the design so that you can report it completely. Observational studies are reported with STROBE [6], randomised trials with CONSORT [5]. Reading the checklist while you plan helps you collect what you will need to report.

## Common mistakes

- Choosing the design from habit or convenience instead of from the question.
- Using a cross-sectional design to claim that an exposure caused an outcome.
- Reading an odds ratio as a risk ratio when the outcome is common.
- Picking controls that differ from the cases in ways that matter.
- Not planning for loss to follow-up in a cohort.
- Ignoring confounders in an observational study.

## Limitations of this guide

This guide covers the most common designs. Other designs, such as cluster trials, crossover trials, interrupted time series and qualitative designs, answer different questions and have their own methods. A statistician or experienced supervisor should confirm the choice before you finalise your protocol.

## Use it in ToProt

The [study design assistant](/tools/study-design-assistant) compares candidate designs for a research aim, and the [research question builder](/tools/research-question-builder) helps you state the question. You can check the calculations in the examples above with the [odds ratio calculator](/tools/odds-ratio-calculator), the [relative risk calculator](/tools/relative-risk-calculator) and the [2 by 2 table calculator](/tools/epidemiology-2x2-table). When the design is chosen, the [sample size calculator](/tools/sample-size-calculator) gives the number of participants.

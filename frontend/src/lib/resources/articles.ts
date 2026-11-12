// Research guides for the public resource center.
//
// Nothing here is published automatically. Every guide starts as "in_review". A guide appears on the public site, in the
// sitemap and in search results only when its status is "published" AND it names a reviewer and a review date and lists
// sources (a test enforces this). Drafts can be read by administrators at /resources/preview/<slug>.

export type ArticleCategory =
  | "methodology" | "study-design" | "statistics" | "sample-size" | "literature-review" | "academic-writing" | "reference-management" | "reporting-guidelines";

export const ARTICLE_CATEGORIES: { id: ArticleCategory; name: string; blurb: string }[] = [
  { id: "methodology", name: "Research methodology", blurb: "Plan a study from question to protocol." },
  { id: "study-design", name: "Study design", blurb: "Choose a design that fits the question." },
  { id: "statistics", name: "Statistical interpretation", blurb: "Choose tests and read results correctly." },
  { id: "sample-size", name: "Sample size", blurb: "Work out how many participants you need." },
  { id: "literature-review", name: "Literature review", blurb: "Search, screen and synthesise evidence." },
  { id: "academic-writing", name: "Academic writing", blurb: "Structure and write a scientific paper." },
  { id: "reference-management", name: "Reference management", blurb: "Collect, clean and cite sources." },
  { id: "reporting-guidelines", name: "Reporting guidelines", blurb: "Report your study completely." },
];

export type ArticleSection = { heading: string; paragraphs?: string[]; bullets?: string[] };
export type Source = { citation: string; url?: string };
export type ArticleStatus = "in_review" | "published";

export type Article = {
  slug: string;
  title: string;
  /** Meta description, 160 characters at most. */
  description: string;
  category: ArticleCategory;
  summary: string;
  status: ArticleStatus;
  /** Required before publishing. */
  reviewedBy?: string;
  reviewedOn?: string;
  /** Date the text was last changed (YYYY-MM-DD). */
  updatedOn: string;
  sections: ArticleSection[];
  sources: Source[];
  /** Calculator or tool slugs that this guide links to. */
  tools: string[];
  /** Other guide slugs. */
  related: string[];
};

const UPDATED = "2026-11-12";

export const ARTICLES: Article[] = [
  {
    slug: "how-to-write-a-research-protocol",
    title: "How to write a research protocol",
    description: "A step-by-step guide to the sections of a research protocol, from the research question and objectives to sample size, analysis and ethics.",
    category: "methodology",
    summary: "A protocol is the written plan for a study. This guide lists its parts and what each one needs to say.",
    status: "in_review",
    updatedOn: UPDATED,
    sections: [
      { heading: "What a protocol is for", paragraphs: [
        "A research protocol is the written plan for a study, prepared before data collection starts. It lets supervisors, ethics committees and funders judge whether the study is worth doing and feasible, and it lets the research team carry the study out consistently.",
        "A good protocol also protects the research. Writing down the question, the analysis and the outcome measures in advance makes it harder to change them after seeing the results.",
      ] },
      { heading: "The main sections", bullets: [
        "Title and summary: a short, specific title and a brief summary of the question, design and plan.",
        "Background and rationale: what is already known, what is missing, and why the study matters.",
        "Research question and objectives: one clear question, one primary objective and a few secondary objectives.",
        "Study design: for example cross-sectional, case-control, cohort or randomised trial, with the reason for the choice.",
        "Population, setting and sampling: who can take part (inclusion and exclusion criteria), where, and how participants are selected.",
        "Variables and measurement: each variable, how it is defined and measured, and its unit or categories.",
        "Sample size: the calculation, the inputs you used and where they came from.",
        "Data collection and management: instruments, who collects the data, how it is stored and protected.",
        "Statistical analysis plan: the methods for each objective, set out before the data are seen.",
        "Ethics: approval, consent, risks and benefits, and confidentiality.",
        "Timeline and responsibilities: milestones, who does what, and what could delay the work.",
      ] },
      { heading: "Writing the research question and objectives", paragraphs: [
        "Start with a question that can be answered with data. A useful structure for clinical and health questions is population, intervention or exposure, comparison and outcome.",
        "Write objectives as specific, measurable statements that start with a verb, such as estimate, compare or describe. Keep one primary objective, because the sample size and main analysis should be built around it.",
      ] },
      { heading: "Common mistakes", bullets: [
        "A question that is too broad to answer with the planned design.",
        "Objectives, variables and analysis that do not match one another.",
        "A sample size taken from a convenient number instead of a calculation.",
        "Changing the primary outcome after looking at the data without saying so.",
        "Leaving out how missing data and loss to follow-up will be handled.",
      ] },
      { heading: "Before you submit", paragraphs: [
        "Read the protocol as a reviewer would. Check that every objective has a variable, a measurement and an analysis, and that the ethics section covers consent and confidentiality. Ask your supervisor and, for the analysis plan, a statistician to review it.",
      ] },
    ],
    sources: [
      { citation: "Hulley SB, Cummings SR, Browner WS, Grady DG, Newman TB. Designing Clinical Research. 4th ed. Philadelphia: Lippincott Williams & Wilkins; 2013." },
      { citation: "Chan A-W, Tetzlaff JM, Altman DG, et al. SPIRIT 2013 statement: defining standard protocol items for clinical trials. Ann Intern Med. 2013;158(3):200-207." },
    ],
    tools: ["protocol-builder", "research-question-builder", "study-design-assistant", "statistical-analysis-plan-generator", "sample-size-calculator"],
    related: ["choosing-a-study-design", "how-to-calculate-sample-size"],
  },
  {
    slug: "choosing-a-study-design",
    title: "Choosing a study design",
    description: "How cross-sectional, case-control, cohort and randomised designs differ, what each can answer, and how to choose one for your research question.",
    category: "study-design",
    summary: "The design decides what your study can and cannot show. Match it to the question you are asking.",
    status: "in_review",
    updatedOn: UPDATED,
    sections: [
      { heading: "Start from the question", paragraphs: [
        "A study design is the structure that decides who is studied, what is measured and when. Different questions need different designs. Ask first what you want to know: how common something is, whether an exposure is linked to an outcome, or whether an intervention works.",
      ] },
      { heading: "Descriptive designs", bullets: [
        "Case report and case series: describe one or a few patients. They generate ideas but cannot show how common or how strongly linked something is.",
        "Cross-sectional study: measures exposure and outcome at one point in time in a sample. It gives prevalence and is quick and relatively cheap, but it cannot show which came first.",
      ] },
      { heading: "Analytic observational designs", bullets: [
        "Case-control study: starts with people who have the outcome (cases) and compares them with people who do not (controls). It suits rare outcomes. The measure of association is the odds ratio, and recall bias and the choice of controls are the main concerns.",
        "Cohort study: follows people with and without an exposure over time to see who develops the outcome. It gives incidence and relative risk and shows that exposure came before the outcome, but it can be slow and costly, and loss to follow-up is a concern.",
      ] },
      { heading: "Experimental designs", paragraphs: [
        "In a randomised controlled trial, participants are assigned to groups by chance, which balances known and unknown factors between groups on average. It is the strongest design for testing whether an intervention causes an effect, but it needs more time, resources and ethical oversight, and it is not possible for every question.",
      ] },
      { heading: "Bias and confounding", paragraphs: [
        "Every design has weaknesses. Selection bias arises from who is included. Information bias arises from how exposure and outcome are measured. Confounding arises when a third factor is linked to both exposure and outcome. Plan how you will limit each one, and say what the design cannot show.",
      ] },
      { heading: "A quick guide", bullets: [
        "How common is it? Cross-sectional.",
        "Is an exposure linked to a rare outcome? Case-control.",
        "What happens to people with an exposure over time? Cohort.",
        "Does an intervention work? Randomised trial, if it is ethical and feasible.",
        "What does all the existing evidence show? Systematic review.",
      ] },
    ],
    sources: [
      { citation: "Grimes DA, Schulz KF. An overview of clinical research: the lay of the land. Lancet. 2002;359(9300):57-61." },
      { citation: "Hulley SB, Cummings SR, Browner WS, Grady DG, Newman TB. Designing Clinical Research. 4th ed. Philadelphia: Lippincott Williams & Wilkins; 2013." },
      { citation: "Rothman KJ, Greenland S, Lash TL. Modern Epidemiology. 3rd ed. Philadelphia: Lippincott Williams & Wilkins; 2008." },
    ],
    tools: ["study-design-assistant", "odds-ratio-calculator", "relative-risk-calculator", "prevalence-calculator", "sample-size-calculator"],
    related: ["how-to-write-a-research-protocol", "reporting-guidelines-explained"],
  },
  {
    slug: "interpreting-p-values-and-confidence-intervals",
    title: "Interpreting p-values and confidence intervals",
    description: "What a p-value and a confidence interval do and do not tell you, how to read statistical significance, and why effect size matters.",
    category: "statistics",
    summary: "A p-value is not the probability that your hypothesis is true. Learn to read it, and its companions, correctly.",
    status: "in_review",
    updatedOn: UPDATED,
    sections: [
      { heading: "What a p-value is", paragraphs: [
        "A p-value is the probability of getting a result at least as extreme as the one observed if a specified statistical model, including the null hypothesis, were true. A small p-value means the data would be unusual under that model.",
        "It is not the probability that the null hypothesis is true, and it is not the probability that the result happened by chance alone.",
      ] },
      { heading: "What it does not tell you", bullets: [
        "It does not measure the size or importance of an effect.",
        "A value just under 0.05 is not much stronger evidence than one just over it.",
        "A non-significant result does not show that there is no effect. The study may have been too small to detect one.",
        "It says nothing about bias or confounding in the study.",
      ] },
      { heading: "Confidence intervals", paragraphs: [
        "A confidence interval gives a range of values that are compatible with the data under the model. A 95% interval is built so that, over many repeated studies, about 95% of such intervals would contain the true value, if the assumptions hold. It is not a statement that the true value lies inside this one interval with 95% probability.",
        "Intervals show both the estimated effect and how precisely it was measured. A wide interval means the estimate is imprecise, even when the p-value is small.",
      ] },
      { heading: "Effect size and practical importance", paragraphs: [
        "A large study can make a tiny, unimportant difference statistically significant, and a small study can miss an important one. Report the effect size, such as a mean difference, risk ratio or odds ratio, with its confidence interval, and discuss whether the size matters in practice.",
      ] },
      { heading: "Good practice", bullets: [
        "State your hypothesis and analysis before looking at the data.",
        "Report exact p-values rather than only 'significant' or 'not significant'.",
        "Always give the estimate and its confidence interval.",
        "Be cautious when many tests are run, because some will look significant by chance.",
      ] },
    ],
    sources: [
      { citation: "Wasserstein RL, Lazar NA. The ASA statement on p-values: context, process, and purpose. Am Stat. 2016;70(2):129-133." },
      { citation: "Greenland S, Senn SJ, Rothman KJ, et al. Statistical tests, P values, confidence intervals, and power: a guide to misinterpretations. Eur J Epidemiol. 2016;31(4):337-350." },
      { citation: "Sullivan GM, Feinn R. Using effect size, or why the P value is not enough. J Grad Med Educ. 2012;4(3):279-282." },
    ],
    tools: ["chi-square-calculator", "odds-ratio-calculator", "effect-size", "confidence-interval-mean", "confidence-interval-proportion"],
    related: ["choosing-a-statistical-test", "how-to-calculate-sample-size"],
  },
  {
    slug: "how-to-calculate-sample-size",
    title: "How to calculate sample size",
    description: "A practical guide to sample size: the inputs you need, the common formulas for proportions and group comparisons, and how to allow for dropout.",
    category: "sample-size",
    summary: "Sample size depends on the question, the design and a few inputs you must justify. This guide explains each one.",
    status: "in_review",
    updatedOn: UPDATED,
    sections: [
      { heading: "Why sample size matters", paragraphs: [
        "A study that is too small may miss a real effect or give an estimate so imprecise that it is of little use. A study that is much larger than needed wastes resources and exposes more people to burden. A sample size calculation, written in the protocol, shows that the study is planned to answer its question.",
      ] },
      { heading: "The inputs you need", bullets: [
        "The design and the main outcome. The formula depends on both.",
        "The expected value, such as a proportion, mean difference or odds ratio, from a pilot study or published work.",
        "The confidence level or significance level, most often 95% or a two-sided 5%.",
        "The precision (margin of error) for estimation, or the power for comparison, often 80% or 90%.",
        "The variability of the outcome, for example a standard deviation.",
        "The loss you expect: non-response, dropout, or missing data.",
      ] },
      { heading: "Estimating a single proportion", paragraphs: [
        "For a cross-sectional survey estimating a prevalence, a standard formula is n = Z squared times p times (1 - p), divided by d squared, where Z is the value for the chosen confidence level, p is the expected proportion and d is the margin of error. With no estimate for p, using 0.5 gives the largest and so the safest sample.",
        "Adjust the result for the design effect in clustered samples, for a finite population when the sample is a large share of it, and for non-response.",
      ] },
      { heading: "Comparing groups", paragraphs: [
        "To compare two proportions or two means, the sample size depends on the difference you want to detect, the variability, the significance level and the power. A smaller difference or a higher power needs more participants. Choose a difference that would matter in practice and say where it came from.",
      ] },
      { heading: "Allowing for dropout", paragraphs: [
        "Divide the calculated number by one minus the expected proportion lost. For example, if you expect to lose 15% of participants, divide by 0.85.",
      ] },
      { heading: "Check your work", bullets: [
        "Try several plausible values for the expected effect and report the one you chose and why.",
        "Make sure the calculation matches the main analysis in the protocol.",
        "Keep the formula and references so a reviewer can repeat the calculation.",
        "Ask a statistician to check complex designs.",
      ] },
    ],
    sources: [
      { citation: "Lwanga SK, Lemeshow S. Sample Size Determination in Health Studies: A Practical Manual. Geneva: World Health Organization; 1991." },
      { citation: "Charan J, Biswas T. How to calculate sample size for different study designs in medical research? Indian J Psychol Med. 2013;35(2):121-126." },
      { citation: "Cochran WG. Sampling Techniques. 3rd ed. New York: Wiley; 1977." },
    ],
    tools: ["sample-size-calculator", "statistical-power-calculator", "sample-size-proportion", "design-effect", "nonresponse-adjustment"],
    related: ["how-to-write-a-research-protocol", "interpreting-p-values-and-confidence-intervals"],
  },
  {
    slug: "choosing-a-statistical-test",
    title: "Choosing a statistical test",
    description: "How to choose between common tests by outcome type, number of groups and study design, including t-tests, chi-square, ANOVA and regression.",
    category: "statistics",
    summary: "The right test depends on what you measured, how many groups you have and whether the data are paired.",
    status: "in_review",
    updatedOn: UPDATED,
    sections: [
      { heading: "Ask three questions", bullets: [
        "What type is the outcome? Continuous (a measurement), categorical (groups), or time to an event.",
        "How many groups or measurements are being compared?",
        "Are the observations independent, or paired or repeated in the same people?",
      ] },
      { heading: "Continuous outcomes", bullets: [
        "Two independent groups: the two-sample t-test, or a rank-based test such as the Mann-Whitney test when the data are clearly not normal and the sample is small.",
        "Two paired measurements: the paired t-test, or the Wilcoxon signed-rank test.",
        "More than two independent groups: one-way analysis of variance (ANOVA), followed by a post hoc comparison, or the Kruskal-Wallis test.",
        "Linking two continuous variables: Pearson correlation, or Spearman rank correlation for monotonic or non-normal data, and simple linear regression for prediction.",
      ] },
      { heading: "Categorical outcomes", bullets: [
        "Two categorical variables: the chi-square test when expected counts are large enough, and Fisher's exact test when they are small.",
        "Describing the strength of association: the odds ratio or relative risk with a confidence interval.",
        "A binary outcome with several predictors: logistic regression.",
      ] },
      { heading: "Time to an event", paragraphs: [
        "When the outcome is the time until an event, such as death or relapse, and some participants have not had the event by the end of follow-up, ordinary tests do not use the data properly. Survival methods, such as the Kaplan-Meier estimate with the log-rank test, or Cox regression, are designed for this. Plan these with a statistician.",
      ] },
      { heading: "Worked examples", bullets: [
        "Mean blood pressure in a treated group and a different untreated group: two-sample t-test.",
        "Weight before and after a programme in the same people: paired t-test.",
        "Proportion with an infection on two wards: chi-square test, or Fisher's exact test if counts are small.",
        "Link between age and a laboratory value: Pearson or Spearman correlation.",
        "How smoking is linked to a disease after adjusting for age and sex: logistic regression.",
      ] },
      { heading: "Normal or not", paragraphs: [
        "Normality matters most in small samples. With large samples the t-test is usually robust to moderate departures from normality. With small samples, look at a plot of the data and consider a rank-based test if the distribution is clearly skewed.",
      ] },
      { heading: "Check the assumptions", paragraphs: [
        "Most tests assume independent observations. Many also assume roughly normal data or large enough counts. Look at your data with a plot before choosing, and say in the methods which assumptions you checked and how.",
      ] },
      { heading: "Plan the test before the data", paragraphs: [
        "Choose the test for each objective in the analysis plan before collecting data. Running many tests and reporting only the significant ones inflates false positives. If you do run several comparisons, say so and consider an adjustment.",
      ] },
    ],
    sources: [
      { citation: "Altman DG. Practical Statistics for Medical Research. London: Chapman and Hall; 1991." },
      { citation: "Bland M. An Introduction to Medical Statistics. 4th ed. Oxford: Oxford University Press; 2015." },
      { citation: "Agresti A. Categorical Data Analysis. 3rd ed. Hoboken: Wiley; 2013." },
    ],
    tools: ["chi-square-calculator", "fishers-exact-test", "two-sample-t-test", "paired-t-test", "one-way-anova", "pearson-correlation", "spearman-correlation", "simple-linear-regression", "simple-logistic-regression"],
    related: ["interpreting-p-values-and-confidence-intervals", "how-to-calculate-sample-size"],
  },
  {
    slug: "how-to-do-a-literature-review",
    title: "How to do a literature review",
    description: "A practical guide to searching, screening and synthesising the literature: framing the question, building a search, choosing databases and recording decisions.",
    category: "literature-review",
    summary: "A literature review finds and weighs existing evidence. A clear question and a recorded search make it reliable.",
    status: "in_review",
    updatedOn: UPDATED,
    sections: [
      { heading: "Start with a focused question", paragraphs: [
        "A review is easier and more useful when the question is narrow. For clinical questions, structure it as population, intervention or exposure, comparison and outcome. Decide in advance what kinds of study you will include and the years and languages you will accept.",
      ] },
      { heading: "Build the search", bullets: [
        "List the key concepts in your question and, for each, several synonyms and related terms.",
        "Combine synonyms with OR and different concepts with AND.",
        "Use controlled vocabulary, such as MeSH terms in PubMed, together with free-text words.",
        "Search more than one source. Common choices are PubMed or MEDLINE, Embase, Scopus, Web of Science and open indexes such as OpenAlex and Crossref.",
        "Record the date, the source and the exact search string, so someone else can repeat it.",
      ] },
      { heading: "Screen and select", paragraphs: [
        "Remove duplicates, then screen titles and abstracts against your inclusion and exclusion criteria, and read the full text of what remains. Keep a record of how many records you found and why each excluded full text was left out. A flow diagram, such as the one in the PRISMA statement, shows this clearly.",
      ] },
      { heading: "Extract and appraise", paragraphs: [
        "Pull the same information from each study into a table: design, population, methods, results and limitations. Then judge how reliable each study is, using a checklist suited to its design, and note where bias could affect the result.",
      ] },
      { heading: "Types of review", bullets: [
        "Narrative review: summarises and discusses the literature on a topic without a fixed search method. Useful for background, but more open to selection bias.",
        "Scoping review: maps what research exists on a broad topic and where the gaps are, usually without judging study quality.",
        "Systematic review: answers a focused question with a prespecified, reproducible search and selection method, and may combine results in a meta-analysis.",
      ] },
      { heading: "Synthesise and write", paragraphs: [
        "Organise the findings by theme or by question rather than study by study. Say where studies agree, where they differ, and why. State the gaps that your own study will address. For a systematic review, follow the PRISMA reporting guideline.",
      ] },
      { heading: "Common mistakes", bullets: [
        "Searching only one database or only for papers that agree with your view.",
        "Not recording the search, so it cannot be repeated or updated.",
        "Treating every study as equally reliable.",
        "Copying wording from sources instead of summarising it in your own words and citing it.",
      ] },
    ],
    sources: [
      { citation: "Richardson WS, Wilson MC, Nishikawa J, Hayward RS. The well-built clinical question: a key to evidence-based decisions. ACP J Club. 1995;123(3):A12-A13." },
      { citation: "Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ. 2021;372:n71." },
      { citation: "Higgins JPT, Thomas J, Chandler J, et al., editors. Cochrane Handbook for Systematic Reviews of Interventions. Cochrane; current version.", url: "https://training.cochrane.org/handbook" },
    ],
    tools: ["literature-explorer", "reference-manager", "citation-formatter"],
    related: ["managing-references-and-citations", "reporting-guidelines-explained"],
  },
  {
    slug: "how-to-structure-a-scientific-paper",
    title: "How to structure a scientific paper",
    description: "What belongs in each part of a research paper using the IMRaD structure: introduction, methods, results and discussion, plus the abstract and references.",
    category: "academic-writing",
    summary: "Most health research papers follow the IMRaD structure. Each part has one job.",
    status: "in_review",
    updatedOn: UPDATED,
    sections: [
      { heading: "The IMRaD structure", paragraphs: [
        "Most original research papers in health and the sciences are organised as Introduction, Methods, Results and Discussion. The structure lets readers find what they need: why the study was done, how, what was found and what it means.",
      ] },
      { heading: "Introduction", paragraphs: [
        "Say what is known, what is not known and why that gap matters, then state the aim or question. Keep it short and cite the key sources rather than reviewing everything.",
      ] },
      { heading: "Methods", paragraphs: [
        "Describe the study so that another researcher could repeat it: design, setting, participants and how they were selected, variables and measurements, sample size, statistical analysis and ethical approval. Use the reporting guideline that fits your design.",
      ] },
      { heading: "Results", paragraphs: [
        "Report what you found, without interpretation. Follow the order of your objectives, give the numbers with confidence intervals, and use tables and figures for detail. Give the flow of participants and the amount of missing data.",
      ] },
      { heading: "Discussion", bullets: [
        "Summarise the main finding in a sentence.",
        "Compare it with earlier work and explain differences.",
        "State the strengths and limitations honestly, including bias and confounding.",
        "Say what the findings mean for practice or further research, without going beyond what the data support.",
      ] },
      { heading: "Abstract, title and references", paragraphs: [
        "Write the abstract last, so that it matches the paper. Give the title enough detail to be found in a search. Cite sources accurately and consistently, in the style the journal asks for. Credit authorship according to the criteria of the International Committee of Medical Journal Editors and acknowledge contributors who do not meet them.",
      ] },
      { heading: "Tables and figures", paragraphs: [
        "Each table or figure should make sense on its own, with a number, a clear title, labelled axes or columns and units. Use them to show detail that would be tiresome in the text, and do not repeat every number in both places.",
      ] },
      { heading: "Common problems", bullets: [
        "Aims in the introduction that the conclusions do not answer.",
        "Methods that leave out details needed to repeat the study.",
        "Interpretation mixed into the results section.",
        "Conclusions that go beyond what the data support.",
        "Numbers that differ between the abstract, the text and the tables.",
      ] },
      { heading: "Revise", paragraphs: [
        "Leave time to revise. Cut what does not serve the question, check every number against the analysis output, and ask a colleague who has not seen the work to read it.",
      ] },
    ],
    sources: [
      { citation: "Sollaci LB, Pereira MG. The introduction, methods, results, and discussion (IMRAD) structure: a fifty-year survey. J Med Libr Assoc. 2004;92(3):364-367." },
      { citation: "International Committee of Medical Journal Editors. Recommendations for the Conduct, Reporting, Editing, and Publication of Scholarly Work in Medical Journals.", url: "https://www.icmje.org/recommendations/" },
    ],
    tools: ["academic-editor", "citation-formatter", "reference-manager"],
    related: ["reporting-guidelines-explained", "managing-references-and-citations"],
  },
  {
    slug: "managing-references-and-citations",
    title: "Managing references and citations",
    description: "How to collect, clean and cite references: using DOIs, removing duplicates, choosing a citation style and keeping a consistent library for a thesis or paper.",
    category: "reference-management",
    summary: "A tidy reference library saves hours at submission. Collect carefully, clean early and let software format the citations.",
    status: "in_review",
    updatedOn: UPDATED,
    sections: [
      { heading: "Why use a reference manager", paragraphs: [
        "Typing citations by hand leads to inconsistent styles, missing details and numbering errors when you move a paragraph. A reference manager stores each source once and formats the in-text citations and the bibliography for you, and it can change style when a journal requires a different one.",
      ] },
      { heading: "Collect references well", bullets: [
        "Import from a trustworthy source, such as a database export or a DOI lookup, rather than retyping.",
        "Prefer records that include the DOI. It identifies a work uniquely and lets you check the details.",
        "Keep the PDF with its reference so you can find the passage you cited.",
        "Note in a field or tag why you saved a source and which section it supports.",
      ] },
      { heading: "Clean the library", bullets: [
        "Remove duplicates. They often differ in capitalisation, punctuation or abbreviations, so check matches by DOI and title.",
        "Check the fields: authors, year, journal, volume, pages and DOI. Imported records can contain errors.",
        "Make titles and journal names consistent in style.",
        "Check whether an important source has been corrected or retracted.",
      ] },
      { heading: "Citation styles", paragraphs: [
        "Styles such as APA, Vancouver, Harvard, IEEE, Chicago and MLA differ in the order of details and in how citations appear in the text. Numbered styles, such as Vancouver, are common in medicine. Always follow the style named in the journal's instructions or your institution's guide. Styles are defined in the open Citation Style Language format, which many tools share.",
      ] },
      { heading: "Moving data between tools", paragraphs: [
        "Common exchange formats include RIS, BibTeX and EndNote files. Export from one tool and import into another, then check a sample of records, because field mappings can differ.",
      ] },
      { heading: "Cite accurately", bullets: [
        "Cite the source you actually read, and prefer the original study over a secondary summary of it.",
        "Do not cite a paper from its abstract alone if the claim depends on the full text.",
        "Use the final published version where one exists, not a preprint, unless the preprint is what you mean.",
        "Check page numbers or section numbers when you quote.",
      ] },
      { heading: "Organise a thesis library", paragraphs: [
        "Group references into collections by chapter or topic, and use tags for the study design or the use you have for a source. A reference can belong to more than one group, so you will not have to save it twice.",
      ] },
      { heading: "Before you submit", bullets: [
        "Make sure every in-text citation has an entry and every entry is cited.",
        "Check numbering and the order of references.",
        "Read the journal's reference format once more.",
      ] },
    ],
    sources: [
      { citation: "International Committee of Medical Journal Editors. Recommendations for the Conduct, Reporting, Editing, and Publication of Scholarly Work in Medical Journals: References.", url: "https://www.icmje.org/recommendations/" },
      { citation: "Citation Style Language. An open XML-based language for describing citation and bibliography formatting.", url: "https://citationstyles.org/" },
      { citation: "DOI Foundation. Digital Object Identifier system.", url: "https://www.doi.org/" },
    ],
    tools: ["reference-manager", "citation-formatter", "literature-explorer", "academic-editor"],
    related: ["how-to-do-a-literature-review", "how-to-structure-a-scientific-paper"],
  },
  {
    slug: "reporting-guidelines-explained",
    title: "Reporting guidelines explained",
    description: "What STROBE, CONSORT, PRISMA, STARD and other reporting guidelines are, why journals ask for them and how to choose and use the right checklist.",
    category: "reporting-guidelines",
    summary: "A reporting guideline is a checklist of what a paper should say. Using the right one makes your study easier to judge and to repeat.",
    status: "in_review",
    updatedOn: UPDATED,
    sections: [
      { heading: "What they are", paragraphs: [
        "A reporting guideline is a checklist of the information a particular type of study report should contain. It does not tell you how to do the study. It helps you describe it completely, so that readers can judge its reliability and others can repeat it. Many journals ask authors to submit a completed checklist.",
      ] },
      { heading: "Common guidelines", bullets: [
        "STROBE: observational studies, including cohort, case-control and cross-sectional designs.",
        "CONSORT: randomised controlled trials.",
        "PRISMA: systematic reviews and meta-analyses.",
        "STARD: studies of diagnostic accuracy.",
        "SPIRIT: protocols for clinical trials.",
        "CARE: case reports.",
        "TRIPOD: prediction model studies.",
      ] },
      { heading: "How to choose one", paragraphs: [
        "Pick the guideline that matches your study design, not your topic. The EQUATOR Network keeps a searchable library of reporting guidelines and their checklists. If a design has an extension for your specific situation, use it alongside the main guideline.",
      ] },
      { heading: "How to use it", bullets: [
        "Read the checklist when you write the protocol, not only at the end, so that you plan to collect what you will need to report.",
        "Fill in the checklist with the page or section where each item is reported.",
        "Mention the guideline in your methods and submit the checklist with the paper if the journal asks.",
        "If an item does not apply, say so and explain briefly.",
      ] },
      { heading: "Why they matter", paragraphs: [
        "Incomplete reporting makes it hard to tell how a study was done, whether it was biased and whether its results can be used. Reporting guidelines were developed by expert groups to prevent that. Reviewers and editors use them, so following one before you submit can also save time.",
      ] },
      { heading: "Reporting is not the same as quality", paragraphs: [
        "Following a guideline does not make a weak study strong. It makes the study's methods and limitations visible, so readers can judge it for themselves. Report what you did, including what went wrong.",
      ] },
      { heading: "Common pitfalls", bullets: [
        "Using a checklist as a tick-box exercise after the paper is written.",
        "Choosing the wrong guideline for the design.",
        "Reporting that the guideline was followed when items are missing.",
      ] },
    ],
    sources: [
      { citation: "von Elm E, Altman DG, Egger M, Pocock SJ, Gotzsche PC, Vandenbroucke JP. The Strengthening the Reporting of Observational Studies in Epidemiology (STROBE) statement: guidelines for reporting observational studies. Lancet. 2007;370(9596):1453-1457." },
      { citation: "Schulz KF, Altman DG, Moher D. CONSORT 2010 statement: updated guidelines for reporting parallel group randomised trials. BMJ. 2010;340:c332." },
      { citation: "Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ. 2021;372:n71." },
      { citation: "Bossuyt PM, Reitsma JB, Bruns DE, et al. STARD 2015: an updated list of essential items for reporting diagnostic accuracy studies. BMJ. 2015;351:h5527." },
      { citation: "EQUATOR Network. Enhancing the QUAlity and Transparency Of health Research.", url: "https://www.equator-network.org/" },
    ],
    tools: ["diagnostic-accuracy-calculator", "protocol-builder", "academic-editor"],
    related: ["choosing-a-study-design", "how-to-structure-a-scientific-paper"],
  },
];

const bySlug = new Map(ARTICLES.map((a) => [a.slug, a]));

export const getArticle = (slug: string): Article | undefined => bySlug.get(slug);
export const isPublished = (a: Article): boolean => a.status === "published" && !!a.reviewedBy && !!a.reviewedOn && a.sources.length > 0;
export const publishedArticles = (): Article[] => ARTICLES.filter(isPublished);
/** Published guides that link to a given tool (internal or public slug). */
export const publishedGuidesForTool = (toolSlug: string): Article[] => publishedArticles().filter((a) => a.tools.includes(toolSlug));
export const wordCount = (a: Article): number => a.sections.reduce((n, s) => n + [...(s.paragraphs ?? []), ...(s.bullets ?? [])].join(" ").split(/\s+/).filter(Boolean).length, a.summary.split(/\s+/).length);
export const readingMinutes = (a: Article): number => Math.max(1, Math.round(wordCount(a) / 200));

export type DesignId = "cross-sectional" | "case-control" | "cohort" | "rct" | "diagnostic" | "qualitative" | "mixed" | "review";

export type Design = {
  id: DesignId;
  name: string;
  answers: string;
  strengths: string[];
  limitations: string[];
  biases: string[];
  guideline: string;
  sampleSizeTools: { slug: string; label: string }[];
};

export const DESIGNS: Record<DesignId, Design> = {
  "cross-sectional": {
    id: "cross-sectional", name: "Cross-sectional study", answers: "How common is something, and what is associated with it, at one point in time?",
    strengths: ["Quick and relatively inexpensive.", "Gives prevalence, which planners and policymakers use.", "Can examine many exposures and outcomes at once."],
    limitations: ["Exposure and outcome are measured together, so it cannot show which came first.", "Poor for rare conditions and short-lived illness (prevalence-incidence bias).", "Associations may reflect confounding."],
    biases: ["Selection or non-response bias", "Recall bias for self-reported exposures", "Prevalence-incidence (survivor) bias"],
    guideline: "STROBE (cross-sectional checklist)",
    sampleSizeTools: [{ slug: "sample-size-proportion", label: "Single proportion and prevalence" }, { slug: "design-effect", label: "Design effect" }],
  },
  "case-control": {
    id: "case-control", name: "Case-control study", answers: "What exposures are more common in people with a (rare) outcome than in comparable people without it?",
    strengths: ["Efficient for rare outcomes and for outcomes with long latency.", "Needs fewer participants and less time than a cohort.", "Can look at several exposures for one outcome."],
    limitations: ["Cannot give incidence or risk directly, only odds ratios.", "Choosing comparable controls is difficult.", "Exposure is often measured after the outcome."],
    biases: ["Recall bias", "Control selection bias", "Confounding, and temporal ambiguity"],
    guideline: "STROBE (case-control checklist)",
    sampleSizeTools: [{ slug: "sample-size-case-control", label: "Case-control sample size" }, { slug: "sample-size-matched-case-control", label: "Matched case-control" }],
  },
  cohort: {
    id: "cohort", name: "Cohort study", answers: "Do people with an exposure develop the outcome more often than those without, over time?",
    strengths: ["Exposure is measured before the outcome, which supports temporal order.", "Gives incidence, relative risk and risk difference.", "Can study several outcomes from one exposure."],
    limitations: ["Slow and costly if prospective, especially for rare outcomes.", "Loss to follow-up can bias results.", "Confounding remains unless measured and adjusted for."],
    biases: ["Loss to follow-up (attrition) bias", "Confounding", "Misclassification of exposure over time"],
    guideline: "STROBE (cohort checklist)",
    sampleSizeTools: [{ slug: "sample-size-cohort", label: "Cohort sample size" }, { slug: "sample-size-survival", label: "Survival and time-to-event" }],
  },
  rct: {
    id: "rct", name: "Randomised controlled trial", answers: "Does assigning an intervention change the outcome compared with a control?",
    strengths: ["Randomisation balances known and unknown confounders on average.", "Strongest design for the effect of an intervention.", "Allows blinding."],
    limitations: ["Expensive and slow, with formal ethical and regulatory requirements.", "Not possible for harmful exposures.", "Strict criteria can limit generalisability."],
    biases: ["Allocation bias if concealment fails", "Performance and detection bias without blinding", "Attrition and non-adherence"],
    guideline: "CONSORT 2010 (register the trial before enrolment)",
    sampleSizeTools: [{ slug: "sample-size-two-proportions", label: "Two proportions" }, { slug: "sample-size-two-means", label: "Two means" }, { slug: "sample-size-cluster-trial", label: "Cluster trial" }],
  },
  diagnostic: {
    id: "diagnostic", name: "Diagnostic accuracy study", answers: "How well does a test identify people who do or do not have the condition?",
    strengths: ["Directly measures sensitivity, specificity and predictive values.", "Can be done in a single visit.", "Informs whether a test is fit for use."],
    limitations: ["Needs a reliable reference standard applied to all (or a defined subset).", "Results depend on disease prevalence and spectrum.", "Accuracy does not prove the test improves patient outcomes."],
    biases: ["Verification (work-up) bias", "Spectrum bias", "Incorporation and review bias"],
    guideline: "STARD 2015",
    sampleSizeTools: [{ slug: "sample-size-diagnostic-accuracy", label: "Diagnostic accuracy sample size" }, { slug: "diagnostic-test-calculator", label: "Diagnostic test calculator" }],
  },
  qualitative: {
    id: "qualitative", name: "Qualitative study", answers: "What are people's experiences, meanings, beliefs and reasons?",
    strengths: ["Explains why and how, which numbers cannot.", "Flexible and good for new or sensitive topics.", "Small samples, studied in depth."],
    limitations: ["Findings are not statistically generalisable.", "Analysis is interpretive and time-consuming.", "Needs careful reflexivity and documentation."],
    biases: ["Researcher bias, so keep a reflexive record", "Social desirability", "Selective sampling"],
    guideline: "COREQ for interviews and focus groups; SRQR for qualitative reports",
    sampleSizeTools: [],
  },
  mixed: {
    id: "mixed", name: "Mixed-methods study", answers: "How much, and why? Both measurement and explanation are needed.",
    strengths: ["Combines breadth (numbers) and depth (meaning).", "Each strand can inform or explain the other.", "Useful when one method alone is not enough."],
    limitations: ["Needs skills in both approaches and more time and money.", "Integration is hard to do well and often skipped.", "Two sets of ethics, sampling and analysis."],
    biases: ["The biases of each strand", "Weak integration across strands"],
    guideline: "GRAMMS for reporting mixed-methods research",
    sampleSizeTools: [{ slug: "sample-size-proportion", label: "Quantitative strand: proportion" }],
  },
  review: {
    id: "review", name: "Systematic review", answers: "What does all the existing evidence show about a question?",
    strengths: ["Uses existing studies, so needs no new participants.", "Reduces bias with a pre-specified, reproducible search.", "May include meta-analysis for a pooled estimate."],
    limitations: ["Quality is limited by the studies available.", "Needs a thorough search, duplicate screening and data extraction.", "Publication bias and heterogeneity."],
    biases: ["Publication bias", "Selection bias in screening", "Heterogeneity across studies"],
    guideline: "PRISMA 2020 (register the protocol, for example on PROSPERO)",
    sampleSizeTools: [],
  },
};

export type DesignAnswers = {
  aim: "describe" | "cause" | "risk" | "diagnostic" | "experience" | "both" | "synthesize";
  assign: "yes" | "no";
  outcome: "common" | "rare";
  followup: "short" | "long";
  resources: "limited" | "adequate";
};

export type DesignScore = { id: DesignId; points: number; fit: "Strong fit" | "Possible" | "Weak fit" | "Not suitable"; reasons: string[]; blocked: boolean };

const BASE: Record<DesignAnswers["aim"], Partial<Record<DesignId, number>>> = {
  describe: { "cross-sectional": 5, cohort: 2, mixed: 2 },
  cause: { rct: 5, cohort: 3, "case-control": 1, mixed: 1 },
  risk: { cohort: 4, "case-control": 4, "cross-sectional": 3 },
  diagnostic: { diagnostic: 6, "cross-sectional": 1 },
  experience: { qualitative: 6, mixed: 3 },
  both: { mixed: 6, qualitative: 2, "cross-sectional": 2 },
  synthesize: { review: 6 },
};

const AIM_TEXT: Record<DesignAnswers["aim"], string> = {
  describe: "describe how common something is", cause: "test whether an intervention works", risk: "find what is associated with or causes an outcome",
  diagnostic: "assess a diagnostic test", experience: "understand experiences and meanings", both: "measure and also explain", synthesize: "summarise existing evidence",
};

/** Rank designs with explicit, inspectable rules. Every point added or removed comes with a reason. */
export function recommendDesigns(a: DesignAnswers): DesignScore[] {
  const out: DesignScore[] = (Object.keys(DESIGNS) as DesignId[]).map((id) => {
    const base = BASE[a.aim][id] ?? 0;
    const reasons: string[] = [];
    let points = base;
    let blocked = false;
    if (base > 0) reasons.push(`Suits your aim to ${AIM_TEXT[a.aim]} (+${base}).`);
    else reasons.push(`Not designed to ${AIM_TEXT[a.aim]}.`);
    const adj = (n: number, why: string) => { if (base > 0 || n < 0) { points += n; reasons.push(`${why} (${n > 0 ? "+" : ""}${n}).`); } };
    if (id === "rct" && a.aim === "cause" && a.assign === "no") { blocked = true; reasons.push("You said the intervention cannot be assigned to participants, which a trial requires."); }
    if (base > 0) {
      if (a.outcome === "rare") {
        if (id === "case-control") adj(2, "Efficient when the outcome is rare");
        if (id === "cohort") adj(-2, "A cohort needs very large numbers for a rare outcome");
        if (id === "cross-sectional") adj(-1, "Few cases will be found in a cross-section");
        if (id === "rct") adj(-1, "Needs many participants for a rare outcome");
      } else {
        if (id === "cohort") adj(1, "A common outcome is practical to follow in a cohort");
        if (id === "case-control") adj(-1, "Less efficient when the outcome is common");
      }
      if (a.followup === "short") {
        if (id === "cohort") adj(-1, "Little time for outcomes to develop in a new cohort");
        if (id === "rct") adj(-1, "Short follow-up limits what an trial can show");
      } else if (id === "case-control") adj(1, "Looking backwards avoids a long wait");
      if (a.resources === "limited") {
        if (id === "cross-sectional" || id === "case-control" || id === "qualitative") adj(1, "Practical with limited time and money");
        if (id === "rct") adj(-2, "Trials are costly");
        if (id === "cohort") adj(-1, "Cohorts are costly to maintain");
        if (id === "mixed") adj(-1, "Two strands cost more");
      }
    }
    const fit = blocked ? "Not suitable" : base === 0 ? "Not suitable" : points >= 6 ? "Strong fit" : points >= 3 ? "Possible" : "Weak fit";
    return { id, points: blocked ? 0 : points, fit, reasons, blocked };
  });
  return out.sort((x, y) => y.points - x.points);
}

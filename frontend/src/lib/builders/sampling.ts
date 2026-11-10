export type SamplingAnswers = {
  purpose: "estimate" | "compare" | "explore";
  frame: "yes" | "no";
  groups: "uniform" | "subgroups";
  spread: "compact" | "scattered";
  representative: "yes" | "no";
  population: string;
  sampleSize: number;
};

export type SamplingMethod =
  | "simple" | "systematic" | "stratified" | "cluster" | "multistage" | "consecutive" | "convenience" | "purposive" | "snowball" | "quota";

export type SamplingAdvice = {
  primary: SamplingMethod;
  alternatives: { method: SamplingMethod; why: string }[];
  why: string[];
  steps: string[];
  biases: string[];
  methodsText: string;
  tools: { slug: string; label: string }[];
};

export const METHOD_NAMES: Record<SamplingMethod, string> = {
  simple: "Simple random sampling", systematic: "Systematic sampling", stratified: "Stratified random sampling", cluster: "Cluster sampling",
  multistage: "Multistage cluster sampling", consecutive: "Consecutive sampling", convenience: "Convenience sampling", purposive: "Purposive sampling",
  snowball: "Snowball sampling", quota: "Quota sampling",
};

const STEPS: Record<SamplingMethod, string[]> = {
  simple: ["Obtain a complete list (sampling frame) of everyone eligible.", "Number the list and draw participants with a random number generator.", "Record the seed or method so the draw can be reproduced.", "Plan how to replace people who cannot be reached, without breaking randomness."],
  systematic: ["Obtain an ordered list of everyone eligible.", "Calculate the interval k = N / n.", "Choose a random start between 1 and k, then take every kth person.", "Check the list has no hidden pattern that lines up with k."],
  stratified: ["Choose the strata (for example district, sex or age group) that matter for the outcome.", "List everyone within each stratum.", "Decide on proportional or equal allocation, and the sample in each stratum.", "Draw randomly within each stratum and weight in the analysis if allocation is not proportional."],
  cluster: ["Define the clusters (villages, schools, wards) and list them.", "Randomly select clusters, with probability proportional to size where sizes differ.", "Include everyone eligible in each selected cluster, or a random subset.", "Inflate the sample size by the design effect and analyse with cluster-robust methods."],
  multistage: ["Randomly select large units first (for example districts), then smaller ones (parishes, villages).", "Finally list households and select them randomly or systematically.", "Within the household select the respondent by a fixed rule such as a Kish grid or the most recent birthday.", "Inflate the sample size by the design effect and weight the analysis."],
  consecutive: ["Define the setting and recruitment period.", "Approach every eligible person who attends in that period, in order.", "Record how many were eligible, approached and declined.", "Report the setting clearly, because results apply to attenders, not the community."],
  convenience: ["State why a probability sample is not possible.", "Recruit those who are accessible.", "Record how many were approached and who refused.", "Do not generalise to a wider population."],
  purposive: ["Decide the characteristics that give a range of experiences (for example age, sex, severity, site).", "Recruit participants who fit the framework, chosen deliberately.", "Keep recruiting until no new themes emerge (information power or saturation).", "Record how participants were chosen and why."],
  snowball: ["Identify a few initial participants and diversify them.", "Ask each to introduce others who meet the criteria.", "Track chains and stop when saturation is reached.", "Protect the confidentiality of those introduced."],
  quota: ["Set quotas for key characteristics (for example sex by age band).", "Recruit non-randomly until each quota is filled.", "Record refusals by quota.", "Treat estimates as non-probability and do not report confidence intervals as if randomly sampled."],
};

const BIASES: Record<SamplingMethod, string[]> = {
  simple: ["Non-response if the list is out of date or people cannot be reached"],
  systematic: ["Periodicity if the list has a repeating pattern"],
  stratified: ["Wrong strata choice reduces the benefit", "Needs reliable stratum membership for everyone on the list"],
  cluster: ["Participants in a cluster are alike, so precision falls (design effect)", "Few clusters make estimates unstable"],
  multistage: ["Design effect and weighting complexity", "Errors in household listing"],
  consecutive: ["Applies only to people who attend, not the community", "Seasonal or day-of-week patterns in attendance"],
  convenience: ["Selection bias that cannot be measured", "Results cannot be generalised"],
  purposive: ["Researcher choices shape the sample", "Findings are not statistically generalisable"],
  snowball: ["Participants are connected, so views may cluster", "Hidden members outside the network are missed"],
  quota: ["Selection within quotas is not random", "Hard to estimate sampling error"],
};

export function adviseSampling(a: SamplingAnswers): SamplingAdvice {
  const why: string[] = [];
  let primary: SamplingMethod;
  const alternatives: { method: SamplingMethod; why: string }[] = [];

  if (a.purpose === "explore") {
    primary = "purposive";
    why.push("Exploring experiences calls for choosing people with a range of perspectives, not a random sample.");
    alternatives.push({ method: "snowball", why: "Use when the group is hard to reach and members know each other." });
    alternatives.push({ method: "convenience", why: "Only if access is the main limit, and state this as a limitation." });
  } else if (a.representative === "no") {
    if (a.frame === "no") {
      primary = "consecutive";
      why.push("You do not need results for a whole population and there is no list, so enrol everyone eligible who attends over a set period.");
      alternatives.push({ method: "convenience", why: "Simpler but more open to selection bias." });
    } else {
      primary = a.groups === "subgroups" ? "quota" : "convenience";
      why.push("Representativeness is not required, so a probability sample is optional.");
      alternatives.push({ method: "simple", why: "A random draw is available from your list and would reduce selection bias." });
    }
  } else if (a.frame === "yes" && a.spread === "compact") {
    if (a.groups === "subgroups") {
      primary = "stratified";
      why.push("You have a full list and distinct subgroups, so sampling within each subgroup guarantees representation and improves precision.");
      alternatives.push({ method: "simple", why: "Simpler, but small subgroups may be missed." });
    } else {
      primary = "simple";
      why.push("You have a full list and a fairly uniform, compact population, so a simple random sample is unbiased and easy to analyse.");
      alternatives.push({ method: "systematic", why: "Easier to carry out from a long ordered list, with similar precision if the list has no pattern." });
    }
  } else if (a.frame === "yes" && a.spread === "scattered") {
    primary = a.groups === "subgroups" ? "stratified" : "systematic";
    why.push(a.groups === "subgroups" ? "You have a list and distinct subgroups, so stratify. Travel cost may justify clustering within strata." : "You have a list. Systematic sampling spreads the sample across the whole list at low cost.");
    alternatives.push({ method: "cluster", why: "Cheaper to travel if people live in identifiable groups, at the price of a design effect." });
  } else {
    primary = a.spread === "scattered" ? "multistage" : "cluster";
    why.push(a.spread === "scattered"
      ? "There is no list of individuals and the population is spread over a wide area, so select areas first, then households, then people."
      : "There is no list of individuals but there is a list of groups (villages, schools, wards), so select groups at random.");
    if (primary === "multistage") alternatives.push({ method: "cluster", why: "A single stage is simpler if you can list all clusters and visit everyone in each." });
  }

  const n = a.sampleSize > 0 ? `${a.sampleSize} participants` : "the calculated sample size";
  const pop = a.population.trim() || "the study population";
  const methodsText = `Participants were recruited from ${pop} using ${METHOD_NAMES[primary].toLowerCase()}. ${STEPS[primary][0]} The target sample was ${n}. ${primary === "cluster" || primary === "multistage" ? "The sample size was inflated by the design effect for clustering. " : ""}${a.purpose === "explore" ? "Recruitment continued until no new themes emerged. " : ""}Eligible people who declined were recorded with their reason.`.trim();

  const tools: SamplingAdvice["tools"] = [];
  if (a.purpose !== "explore") {
    tools.push({ slug: "sample-size-proportion", label: "Sample size for a proportion" });
    if (primary === "cluster" || primary === "multistage") tools.push({ slug: "design-effect", label: "Design effect for clustering" });
    if (primary === "stratified") tools.push({ slug: "finite-population-correction", label: "Finite population correction" });
    tools.push({ slug: "nonresponse-adjustment", label: "Nonresponse adjustment" });
  }
  return { primary, alternatives, why, steps: STEPS[primary], biases: BIASES[primary], methodsText, tools };
}

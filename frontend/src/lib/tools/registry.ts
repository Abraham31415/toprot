import { SIZE_CALCULATORS } from "./calculators-size";
import { EPI_CALCULATORS, STAT_CALCULATORS } from "./calculators-stats";
import { DESIGN_BUILDERS } from "./builders-design";
import { METHOD_BUILDERS } from "./builders-method";
import { CATEGORIES, type Calculator, type ToolMeta } from "./types";

export { CATEGORIES };

export const CALCULATORS: Calculator[] = [...SIZE_CALCULATORS, ...STAT_CALCULATORS, ...EPI_CALCULATORS, ...DESIGN_BUILDERS, ...METHOD_BUILDERS];

/** Entries that are not in-page calculators. Status is stated plainly so nothing unbuilt looks available. */
const OTHER: ToolMeta[] = [
  { slug: "study-sample-size-calculator", name: "Study-Linked Sample Size Calculator", category: "sample-size", kind: "external", href: "/calculator", summary: "Nine designs with a dropout and effect-size stress test. Results can be saved into a protocol.", keywords: ["sample size", "stress test", "protocol", "proportion", "mean", "correlation"] },
  { slug: "protocol-builder", name: "Research Protocol Builder", category: "study-design", kind: "workspace", href: "/features#protocol-builder", summary: "Guided sections for objectives, population, variables, statistics and ethics. Needs a free account.", keywords: ["protocol", "study design", "objectives", "variables"] },
  { slug: "methodology-checks", name: "Methodology Checks", category: "study-design", kind: "workspace", href: "/features#methodology-validation", summary: "Rule-based consistency checks on your protocol, plus optional AI reviewer questions. Needs a free account.", keywords: ["validation", "review", "methodology"] },
  { slug: "reference-manager", name: "Reference Manager", category: "literature", kind: "workspace", href: "/features#reference-manager", summary: "Add sources by DOI, PubMed ID or title. Needs a free account.", keywords: ["references", "DOI", "PubMed", "citations"] },
  { slug: "literature-explorer", name: "Literature Explorer", category: "literature", kind: "planned", summary: "Search PubMed, OpenAlex and Crossref from inside a study.", keywords: ["literature", "search", "PubMed"] },
  { slug: "academic-editor", name: "Academic Writing Editor", category: "writing", kind: "planned", summary: "A rich-text editor with citation insertion and a bibliography.", keywords: ["writing", "editor", "citations"] },
  { slug: "document-generation", name: "Data Dictionary and Form Generator", category: "data-collection", kind: "workspace", href: "/features#document-generation", summary: "Data dictionary, KoBo and REDCap forms from your protocol. Needs a free account.", keywords: ["data dictionary", "KoBo", "REDCap", "data collection"] },
  { slug: "deviation-tracking", name: "Milestones and Deviation Report", category: "reporting", kind: "workspace", href: "/features#study-tracking", summary: "Track milestones, log deviations and generate a deviation report. Needs a free account.", keywords: ["milestones", "deviations", "report"] },
];

const meta = (c: Calculator): ToolMeta => ({ slug: c.slug, name: c.name, category: c.category, summary: c.summary, keywords: c.keywords, kind: "calculator" });

export const ALL_TOOLS: ToolMeta[] = [...CALCULATORS.map(meta), ...OTHER];

export const getCalculator = (slug: string): Calculator | undefined => CALCULATORS.find((c) => c.slug === slug);
export const toolHref = (t: ToolMeta): string | null => (t.kind === "calculator" ? `/tools/${t.slug}` : (t.href ?? null));

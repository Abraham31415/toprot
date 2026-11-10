// Single source of truth for the public website: URLs, navigation, and which features are
// actually built. Marketing pages read feature status from here so the site never advertises
// a capability that does not exist.

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://toprot.vercel.app").replace(/\/$/, "");
export const SITE_NAME = "ToProt";
export const SITE_TITLE = "ToProt | Research Protocol & Study Design Platform";
export const SITE_DESCRIPTION =
  "Design research protocols, explore scientific literature, manage citations, and generate research instruments and statistical templates.";

// Optional public contact address. Left unset until the owner chooses one; pages degrade gracefully.
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "";

export const NAV_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/tools", label: "Research Tools" },
  { href: "/literature", label: "Literature" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/examples", label: "Examples" },
  { href: "/pricing", label: "Pricing" },
  { href: "/resources", label: "Resources" },
  { href: "/docs", label: "Documentation" },
] as const;

export type FeatureStatus = "available" | "planned";

export interface Feature {
  slug: string;
  name: string;
  status: FeatureStatus;
  summary: string;
  details: string[];
}

export const FEATURES: Feature[] = [
  {
    slug: "protocol-builder",
    name: "Research Protocol Builder",
    status: "available",
    summary: "Structured sections for identity, objectives, population, variables, statistics, data collection and ethics.",
    details: [
      "Enter study details once in guided sections instead of free-form documents.",
      "Text sections save automatically after you stop typing. Objectives and variables save when you select Save, and unsaved changes are flagged.",
      "A completion tracker shows which sections still need attention.",
      "Lock a protocol version when it is final, with supervisor review built in.",
    ],
  },
  {
    slug: "methodology-validation",
    name: "Methodology Validation",
    status: "available",
    summary: "Deterministic consistency checks across your protocol, plus optional AI reviewer questions.",
    details: [
      "Rule-based checks flag structural problems, such as missing fields and variable roles that do not match the design.",
      "Optional AI reviewer questions are phrased as prompts for your own judgement. They never score or approve a protocol.",
      "AI review uses a limited monthly credit allowance. Everything else works without it.",
    ],
  },
  {
    slug: "sample-size",
    name: "Sample Size Calculator",
    status: "available",
    summary: "Six study designs with a stress test showing how required N moves with dropout and effect size.",
    details: [
      "Single proportion, single mean, two proportions, two means, paired means and correlation.",
      "Free to use without an account at /calculator.",
      "Results can be saved straight into a study protocol.",
    ],
  },
  {
    slug: "reference-manager",
    name: "Reference Manager",
    status: "available",
    summary: "Add references by DOI, PubMed ID or title, with details pulled from CrossRef and PubMed.",
    details: [
      "Keep a reference list per study and reorder it.",
      "Manual entry is available when a source cannot be found online.",
      "Citation insertion inside a writing editor is planned, not yet available.",
    ],
  },
  {
    slug: "document-generation",
    name: "Document Generation",
    status: "available",
    summary: "Generate research instruments and documents from the protocol you already entered.",
    details: [
      "Data dictionary, KoBo form, REDCap form, Stata skeleton, table shells, methods paragraph, ethics package and consent form.",
      "Documents are built from your structured protocol so they stay consistent with each other.",
      "Always review generated documents before use. They are drafts for the researcher to check.",
    ],
  },
  {
    slug: "study-tracking",
    name: "Milestones and Deviation Tracking",
    status: "available",
    summary: "Track study milestones, log protocol deviations and generate a deviation report.",
    details: [
      "A milestone tracker shows where a study is.",
      "Log deviations as they happen and produce a report from the log.",
      "Supervisors can review their students' studies.",
    ],
  },
  {
    slug: "academic-editor",
    name: "Academic Writing Editor",
    status: "planned",
    summary: "A rich-text editor with citation insertion and an automatic bibliography.",
    details: ["Planned. Not available yet."],
  },
  {
    slug: "literature-explorer",
    name: "Literature Explorer",
    status: "available",
    summary: "Search OpenAlex, PubMed and Crossref, open the original paper, and save records to a study.",
    details: [
      "Search by keyword, title, author, journal, DOI and year, with filters for open access (where the source records it), work type and, in PubMed, study type.",
      "Results are bibliographic records and abstracts only. ToProt does not hold full texts. A free-version link appears only when the source reports one.",
      "Export selected records to RIS, BibTeX, EndNote XML or CSV, build an evidence table, or save records to a study. Saved records are fetched again from their source so only verified details are stored.",
    ],
  },
  {
    slug: "pdf-library",
    name: "PDF Research Library",
    status: "planned",
    summary: "Upload, read and annotate PDFs, then ask questions grounded in the document.",
    details: ["Planned. Not available yet."],
  },
];

export const LEGAL_LAST_UPDATED = "9 November 2026";

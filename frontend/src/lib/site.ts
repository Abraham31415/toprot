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
    summary: "Keep a study's references organised: look up, import, tag, group, de-duplicate and export.",
    details: [
      "Add references by DOI or PubMed ID (details come from Crossref and PubMed), by typing them in, from the Literature Explorer, or by importing RIS, BibTeX or EndNote XML files.",
      "Import from your own Zotero library using a read-only key that stays in your browser. Mendeley and EndNote are supported through their file exports. Live Mendeley sync is not available.",
      "Edit details, add tags and notes, group references into collections, search and filter, find and merge duplicates, and export to RIS, BibTeX, EndNote XML or CSV.",
      "Format a bibliography in any style from the official Citation Style Language repository, or use the Citation Formatter to turn [@key] markers in your text into formatted citations. A full word processor with built-in citations is planned, not yet available.",
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
    status: "available",
    summary: "Write manuscripts inside a study, with citations from its references, an automatic bibliography, autosave and version history.",
    details: [
      "A rich-text editor (headings, lists, tables, figures with captions) with starting structures for research proposals, original articles, systematic reviews (PRISMA 2020 headings), case reports (CARE headings), theses, dissertations and conference abstracts. Templates add headings only.",
      "Insert citations from the study's own references. The in-text citations and the reference list update when you change the citation style.",
      "Autosave, named versions and restore. Export to Word (.docx) or to PDF through your browser's print dialog.",
      "Spelling help comes from your browser. There is no AI writing in the editor, and it does not check or improve your reporting.",
    ],
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
    status: "available",
    summary: "Upload PDFs, search inside them, annotate, compare, and ask questions answered from their own text.",
    details: [
      "A private library: up to 20 MB and 400 pages per PDF, 100 PDFs and 100 MB in total. Only you can see your files.",
      "Text and basic metadata are read from each PDF. Scanned PDFs are stored but cannot be searched, because there is no OCR.",
      "Search inside your PDFs, read page by page, highlight passages, add notes, and link a PDF to one of a study's references.",
      "Questions and paper comparisons use AI credits. Answers are drawn only from passages found in your PDFs, and every quote is checked against the PDF text. Verified quotes are shown separately from the AI's own wording, with the PDF page.",
    ],
  },
  {
    slug: "ai-assistant",
    name: "AI Research Assistant",
    status: "available",
    summary: "Ask for help on your own project: brainstorming, protocol and methodology review, literature summaries, writing and analysis planning.",
    details: [
      "Eleven tasks. The assistant reads your protocol, saved references, uploaded PDFs and manuscripts through limited, read-only tools. It cannot change anything in your project.",
      "Every answer is labelled as AI. Sources it points to are checked against your documents, and quotations are verified word for word. Anything citation-shaped that is not one of your saved references is removed, so it cannot invent a reference.",
      "A server-side router picks a lighter or stronger model for each request. Each request has hard limits on input, output, steps, document reads, cost and frequency. It uses AI credits and needs the AI service to be switched on.",
      "It is an aid, not an authority. It does not approve, score or replace your supervisor or ethics committee.",
    ],
  },
];

export const LEGAL_LAST_UPDATED = "11 November 2026";

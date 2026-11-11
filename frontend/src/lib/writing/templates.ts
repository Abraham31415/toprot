import type { Doc, DocNode } from "./doc";

// Starting structures. A template only creates headings: no sample text is inserted, so nothing
// placeholder-like can slip into a submitted manuscript. The one-line hints are shown beside the editor.
// Reporting guidelines are named only where the template follows their published headings; following a
// template is not a claim of compliance, and the guidance text says to check the full checklist.

export type TemplateId = "blank" | "research_proposal" | "original_article" | "systematic_review" | "case_report" | "thesis" | "dissertation" | "conference_abstract";

export type Section = { title: string; level: 1 | 2 | 3; hint?: string; wordLimit?: number };
export type Template = {
  id: TemplateId;
  name: string;
  description: string;
  guideline?: string;
  /** A target for the whole document, shown as a progress guide. Not enforced. */
  wordTarget?: number;
  sections: Section[];
};

const IMRAD: Section[] = [
  { title: "Abstract", level: 1, hint: "Structured: background, methods, results, conclusions. Check the journal's word limit." },
  { title: "Introduction", level: 1, hint: "What is known, the gap, and your objective." },
  { title: "Methods", level: 1 },
  { title: "Study design and setting", level: 2, hint: "Design, site, dates." },
  { title: "Participants", level: 2, hint: "Eligibility criteria and how people were selected." },
  { title: "Variables and measurement", level: 2, hint: "Exposures, outcomes, confounders, how each was measured." },
  { title: "Sample size", level: 2, hint: "How the size was decided." },
  { title: "Statistical analysis", level: 2, hint: "Methods, software, missing data handling." },
  { title: "Ethical considerations", level: 2, hint: "Approval body, reference number, consent." },
  { title: "Results", level: 1, hint: "Report findings without interpretation." },
  { title: "Discussion", level: 1, hint: "Key findings, comparison with other work, strengths and limitations, implications." },
  { title: "Conclusion", level: 1 },
  { title: "Acknowledgements", level: 1 },
  { title: "Funding and conflicts of interest", level: 1 },
];

export const TEMPLATES: Template[] = [
  { id: "blank", name: "Blank document", description: "Start with an empty page.", sections: [] },
  {
    id: "research_proposal",
    name: "Research proposal",
    description: "Background, objectives, methods, ethics, work plan and budget.",
    sections: [
      { title: "Background", level: 1, hint: "The problem, what is already known, and why it matters here." },
      { title: "Problem statement", level: 1 },
      { title: "Justification", level: 1, hint: "Who will use the findings and how." },
      { title: "Research question", level: 1 },
      { title: "Objectives", level: 1, hint: "One general objective and specific objectives." },
      { title: "Methods", level: 1 },
      { title: "Study design", level: 2 },
      { title: "Setting and population", level: 2 },
      { title: "Sample size and sampling", level: 2 },
      { title: "Data collection", level: 2 },
      { title: "Data management and analysis", level: 2 },
      { title: "Ethical considerations", level: 1 },
      { title: "Work plan and timeline", level: 1 },
      { title: "Budget", level: 1 },
      { title: "Dissemination plan", level: 1 },
    ],
  },
  { id: "original_article", name: "Original research article", description: "Introduction, methods, results and discussion (IMRaD).", sections: IMRAD },
  {
    id: "systematic_review",
    name: "Systematic review",
    description: "Headings in the order of the PRISMA 2020 checklist.",
    guideline: "PRISMA 2020. Use the full checklist to confirm every item is reported.",
    sections: [
      { title: "Abstract", level: 1, hint: "See the PRISMA 2020 abstract checklist." },
      { title: "Introduction", level: 1 },
      { title: "Rationale", level: 2 },
      { title: "Objectives", level: 2, hint: "State the question using PICO or an equivalent framework." },
      { title: "Methods", level: 1 },
      { title: "Protocol and registration", level: 2, hint: "Registration number, for example in PROSPERO, and any amendments." },
      { title: "Eligibility criteria", level: 2 },
      { title: "Information sources", level: 2, hint: "Databases, registers, other sources and the date each was last searched." },
      { title: "Search strategy", level: 2, hint: "The full strategy for every database." },
      { title: "Selection process", level: 2 },
      { title: "Data collection and items", level: 2 },
      { title: "Risk of bias assessment", level: 2 },
      { title: "Synthesis methods", level: 2 },
      { title: "Results", level: 1 },
      { title: "Study selection", level: 2, hint: "Include the flow diagram." },
      { title: "Study characteristics", level: 2 },
      { title: "Risk of bias in studies", level: 2 },
      { title: "Results of syntheses", level: 2 },
      { title: "Certainty of evidence", level: 2 },
      { title: "Discussion", level: 1 },
      { title: "Limitations", level: 2 },
      { title: "Conclusions", level: 2 },
      { title: "Other information", level: 1, hint: "Registration, funding, competing interests, data availability." },
    ],
  },
  {
    id: "case_report",
    name: "Case report",
    description: "Headings in the order of the CARE guideline.",
    guideline: "CARE. Use the full checklist to confirm every item is reported.",
    sections: [
      { title: "Abstract", level: 1 },
      { title: "Introduction", level: 1, hint: "Why this case is worth reporting." },
      { title: "Patient information", level: 1, hint: "De-identified demographics, main concerns, relevant history." },
      { title: "Clinical findings", level: 1 },
      { title: "Timeline", level: 1 },
      { title: "Diagnostic assessment", level: 1 },
      { title: "Therapeutic intervention", level: 1 },
      { title: "Follow-up and outcomes", level: 1 },
      { title: "Discussion", level: 1, hint: "Strengths, limitations and the relevant literature." },
      { title: "Patient perspective", level: 1 },
      { title: "Informed consent", level: 1, hint: "State that the patient gave consent. Many journals require it." },
    ],
  },
  {
    id: "thesis",
    name: "Thesis",
    description: "Front matter, introduction, literature review, methods, results, discussion and appendices.",
    sections: [
      { title: "Declaration", level: 1 },
      { title: "Abstract", level: 1 },
      { title: "Acknowledgements", level: 1 },
      { title: "List of abbreviations", level: 1 },
      { title: "Chapter 1: Introduction", level: 1 },
      { title: "Background", level: 2 },
      { title: "Problem statement", level: 2 },
      { title: "Objectives", level: 2 },
      { title: "Chapter 2: Literature review", level: 1 },
      { title: "Chapter 3: Methods", level: 1 },
      { title: "Study design and setting", level: 2 },
      { title: "Population and sampling", level: 2 },
      { title: "Data collection", level: 2 },
      { title: "Data analysis", level: 2 },
      { title: "Ethical considerations", level: 2 },
      { title: "Chapter 4: Results", level: 1 },
      { title: "Chapter 5: Discussion", level: 1 },
      { title: "Chapter 6: Conclusions and recommendations", level: 1 },
      { title: "Appendices", level: 1 },
    ],
  },
  {
    id: "dissertation",
    name: "Dissertation",
    description: "Research questions and hypotheses, a separate theoretical framework, and appendices.",
    sections: [
      { title: "Declaration", level: 1 },
      { title: "Abstract", level: 1 },
      { title: "Acknowledgements", level: 1 },
      { title: "List of abbreviations", level: 1 },
      { title: "Chapter 1: Introduction", level: 1 },
      { title: "Background to the study", level: 2 },
      { title: "Statement of the problem", level: 2 },
      { title: "Research questions and hypotheses", level: 2 },
      { title: "Significance of the study", level: 2 },
      { title: "Scope and delimitations", level: 2 },
      { title: "Chapter 2: Literature review", level: 1 },
      { title: "Theoretical or conceptual framework", level: 2 },
      { title: "Chapter 3: Research methodology", level: 1 },
      { title: "Research design", level: 2 },
      { title: "Study population and sampling", level: 2 },
      { title: "Instruments and data collection", level: 2 },
      { title: "Validity, reliability and rigour", level: 2 },
      { title: "Data analysis", level: 2 },
      { title: "Ethical considerations", level: 2 },
      { title: "Chapter 4: Findings", level: 1 },
      { title: "Chapter 5: Discussion of findings", level: 1 },
      { title: "Chapter 6: Conclusions, implications and recommendations", level: 1 },
      { title: "Limitations and further research", level: 2 },
      { title: "Appendices", level: 1 },
    ],
  },
  {
    id: "conference_abstract",
    name: "Conference abstract",
    description: "A short structured abstract. Check the call for abstracts for the exact word limit.",
    wordTarget: 300,
    sections: [
      { title: "Background", level: 2 },
      { title: "Methods", level: 2 },
      { title: "Results", level: 2 },
      { title: "Conclusions", level: 2 },
    ],
  },
];

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id) as TemplateId[];
export const isTemplateId = (v: unknown): v is TemplateId => typeof v === "string" && (TEMPLATE_IDS as string[]).includes(v);
export const getTemplate = (id: TemplateId): Template => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

export function buildTemplateDoc(id: TemplateId): Doc {
  const t = getTemplate(id);
  if (!t.sections.length) return { type: "doc", content: [{ type: "paragraph" }] };
  const content: DocNode[] = [];
  for (const s of t.sections) {
    content.push({ type: "heading", attrs: { level: s.level }, content: [{ type: "text", text: s.title }] });
    content.push({ type: "paragraph" });
  }
  return { type: "doc", content };
}

/** Hint for a heading, matched by its current text, so it still shows after the user edits the document. */
export function hintFor(id: TemplateId, headingText: string): string | undefined {
  const norm = (s: string) => s.trim().toLowerCase();
  return getTemplate(id).sections.find((s) => norm(s.title) === norm(headingText))?.hint;
}

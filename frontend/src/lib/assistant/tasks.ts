// What the assistant can be asked to do. Each task fixes which read-only tools the agent may use, its starting tier, and
// task-specific guidance. The assistant never writes to a project: it returns suggestions the user applies themselves.

export type ToolName = "get_protocol" | "list_references" | "get_reference" | "search_pdfs" | "list_pdfs" | "get_manuscript";
export type Tier = "light" | "standard" | "deep";

export type TaskId =
  | "brainstorm" | "refine_question" | "protocol_review" | "methodology_critique" | "literature_summary" | "evidence_extraction"
  | "writing_help" | "manuscript_edit" | "analysis_plan" | "explain_with_citations" | "document_review";

export type Task = {
  id: TaskId;
  label: string;
  description: string;
  tier: Tier;
  tools: ToolName[];
  /** The task needs a study (project) to work from. */
  needsStudy: boolean;
  /** The task is about a manuscript. */
  needsManuscript?: boolean;
  guidance: string;
  placeholder: string;
};

export const TASKS: Task[] = [
  {
    id: "brainstorm", label: "Brainstorm", description: "Generate research directions and angles.", tier: "light", needsStudy: false,
    tools: ["get_protocol", "list_references"],
    guidance: "Offer a few distinct, specific directions with the reasoning for each. Prefer questions the user could actually study with the design and setting they have. Do not name specific papers unless a tool returned them.",
    placeholder: "e.g. What other outcomes could I study in this population?",
  },
  {
    id: "refine_question", label: "Refine a research question", description: "Sharpen a question using PICO or similar.", tier: "light", needsStudy: false,
    tools: ["get_protocol", "list_references"],
    guidance: "Work on the user's own question. Show a sharper version, name what changed and why, and list what is still ambiguous. Offer 2 to 3 alternative wordings.",
    placeholder: "e.g. Make my research question more specific and answerable.",
  },
  {
    id: "protocol_review", label: "Review my protocol", description: "Questions a supervisor or ethics committee might ask.", tier: "standard", needsStudy: true,
    tools: ["get_protocol", "list_references", "get_reference"],
    guidance: "Read the protocol with get_protocol. Raise specific questions and gaps a reviewer might probe. Never say a protocol is good, approved, acceptable or sound, and never give a score or verdict. Quote the protocol text you are questioning (source type protocol).",
    placeholder: "e.g. What would an ethics committee ask about my sample size and consent process?",
  },
  {
    id: "methodology_critique", label: "Critique methodology", description: "Design, bias, confounding and analysis choices.", tier: "standard", needsStudy: true,
    tools: ["get_protocol", "get_reference", "list_references", "search_pdfs"],
    guidance: "Identify specific threats to validity (selection, information, confounding, power, multiplicity) that follow from what is actually written. Say what the user could change. Do not judge the work as a whole.",
    placeholder: "e.g. What biases could affect my cross-sectional design?",
  },
  {
    id: "literature_summary", label: "Summarise literature", description: "Summarise saved references and uploaded PDFs.", tier: "standard", needsStudy: true,
    tools: ["list_references", "get_reference", "search_pdfs", "list_pdfs"],
    guidance: "Summarise only what the user's saved references (their abstracts) and uploaded PDFs say. Say clearly when only an abstract was available. Group by theme and note disagreements between sources. Every statement about a paper needs a source.",
    placeholder: "e.g. Summarise what my references say about screening thresholds.",
  },
  {
    id: "evidence_extraction", label: "Extract evidence", description: "Pull design, sample, outcomes and findings from sources.", tier: "standard", needsStudy: true,
    tools: ["list_references", "get_reference", "search_pdfs", "list_pdfs"],
    guidance: "Extract the requested facts (design, population, sample size, outcomes, findings, limitations) per source, with a source and a verbatim quote for each. If a fact is not stated in what you read, say it is not stated. Never infer or fill gaps.",
    placeholder: "e.g. For each uploaded paper, list design, sample size and main finding.",
  },
  {
    id: "writing_help", label: "Academic writing help", description: "Structure, clarity and argument for a manuscript.", tier: "standard", needsStudy: true, needsManuscript: true,
    tools: ["get_manuscript", "list_references", "get_reference"],
    guidance: "Give feedback on structure, argument and clarity of the user's own text, quoting the passage you mean (source type manuscript). Do not add new factual claims, numbers or citations. You may point to saved references the user could cite, by source.",
    placeholder: "e.g. Is the argument in my introduction clear? Where does it lose focus?",
  },
  {
    id: "manuscript_edit", label: "Edit my manuscript", description: "Suggested rewrites of passages you point to.", tier: "standard", needsStudy: true, needsManuscript: true,
    tools: ["get_manuscript"],
    guidance: "Suggest improved wording for the passages the user asks about. For each, use a rewrite block whose source quotes the ORIGINAL passage from the manuscript. Preserve the meaning exactly. Never add facts, numbers, results or citations that are not in the original.",
    placeholder: "e.g. Tighten the Methods section without changing its meaning.",
  },
  {
    id: "analysis_plan", label: "Plan data analysis", description: "Suggest analyses that fit the design and variables.", tier: "standard", needsStudy: true,
    tools: ["get_protocol", "list_references"],
    guidance: "Base the plan on the variables, design and sample in the protocol. Name the analysis, why it fits, its assumptions, and what to check. Do not run numbers or invent results. Say if the protocol is missing information needed to choose.",
    placeholder: "e.g. Suggest a statistical analysis plan for my primary outcome.",
  },
  {
    id: "explain_with_citations", label: "Explain with sources", description: "Answer a question using only your references and PDFs.", tier: "standard", needsStudy: true,
    tools: ["list_references", "get_reference", "search_pdfs", "list_pdfs"],
    guidance: "Answer using only what the user's saved references and uploaded PDFs say. If they do not cover the question, say so and suggest literature searches instead of answering from memory.",
    placeholder: "e.g. According to my references, what is the usual screening schedule?",
  },
  {
    id: "document_review", label: "Review a document", description: "Check a manuscript against your protocol and sources.", tier: "standard", needsStudy: true, needsManuscript: true,
    tools: ["get_manuscript", "get_protocol", "search_pdfs", "list_pdfs"],
    guidance: "Compare the manuscript with the protocol and the uploaded sources. Point out inconsistencies, unsupported claims and missing items, quoting both sides. Do not judge overall quality.",
    placeholder: "e.g. Does my Methods section match my protocol?",
  },
];

export const TASK_IDS = TASKS.map((t) => t.id) as TaskId[];
export const getTask = (id: string): Task | undefined => TASKS.find((t) => t.id === id);

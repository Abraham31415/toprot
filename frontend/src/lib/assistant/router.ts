import { getTask, type TaskId, type Tier, type ToolName } from "./tasks";

// Server-side model routing. A request is classified into a tier from its task, size and the user's choice, with
// deterministic rules (no AI call, so routing itself costs nothing). The tier names an ai_features row, which holds the
// model chain and every hard limit; ai_reserve then picks the first model in that chain that the user's credits and the
// platform budget can afford. Nothing the model or the browser says changes the tier.

export const TIER_ORDER: Tier[] = ["light", "standard", "deep"];
export const FEATURE_FOR_TIER: Record<Tier, string> = { light: "assistant_light", standard: "assistant_standard", deep: "assistant_deep" };

export type RouteInput = {
  task: TaskId;
  messageChars: number;
  /** Characters of project context that will be sent up front. */
  contextChars: number;
  /** PDFs and manuscripts the request is scoped to. */
  documentCount: number;
  /** The user asked for a thorough pass. */
  thorough: boolean;
  /** Whether the user may use the deep tier (setting plus their plan). */
  deepAllowed: boolean;
};

export type Route = { tier: Tier; featureKey: string; tools: ToolName[]; reasons: string[]; downgraded: boolean };

const up = (t: Tier): Tier => TIER_ORDER[Math.min(TIER_ORDER.indexOf(t) + 1, 2)];
const down = (t: Tier): Tier => TIER_ORDER[Math.max(TIER_ORDER.indexOf(t) - 1, 0)];

export function routeRequest(i: RouteInput, hasStudy: boolean, hasDocs: boolean, hasManuscript: boolean): Route {
  const task = getTask(i.task);
  if (!task) throw new Error("unknown task");
  const reasons: string[] = [];
  let tier = task.tier;
  reasons.push(`${task.label} starts at the ${tier} tier.`);

  // Simple, small questions do not need a stronger model.
  if (tier === "standard" && i.messageChars < 160 && i.contextChars < 3000 && i.documentCount === 0 && !i.thorough) {
    tier = "light";
    reasons.push("The question is short and uses little project material, so a lighter model is enough.");
  }
  // Large or multi-document work benefits from a stronger model.
  if (i.contextChars > 18000 || i.documentCount >= 4) {
    tier = up(tier);
    reasons.push("It involves a lot of material or several documents, so a stronger tier is used.");
  }
  if (i.thorough) {
    tier = up(tier);
    reasons.push("You asked for a thorough pass.");
  }
  // Light work stays light unless size or the user's request raised it.
  let downgraded = false;
  if (tier === "deep" && !i.deepAllowed) {
    tier = "standard";
    downgraded = true;
    reasons.push("The deep tier is not available on your plan, so the standard tier is used.");
  }

  // Permitted capabilities: only tools that make sense for what the project has, and none for the light tier beyond
  // reading the project (it has the smallest tool budget).
  const tools = task.tools.filter((t) => {
    if (t === "get_protocol" || t === "list_references" || t === "get_reference") return hasStudy;
    if (t === "search_pdfs" || t === "list_pdfs") return hasDocs;
    if (t === "get_manuscript") return hasManuscript;
    return false;
  });
  return { tier, featureKey: FEATURE_FOR_TIER[tier], tools, reasons, downgraded };
}

export { down as lowerTier };

"use server";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { SECTION_KEYS, type QualityIssue, type QualitySnapshot } from "./quality";

const SYSTEM_PROMPT = `You are helping a research student stress-test their study protocol before it goes to a supervisor or ethics committee. You are NOT a reviewer, approver, or grader: you never say a protocol is "good", "solid", "well-designed", "acceptable", "correct", or use any other approval/disapproval language, and you never assign a score or verdict of any kind.

Your only output is a short list of open questions a skeptical reviewer or thesis committee member might actually raise about this specific protocol -- prompts for the student's own judgement, not conclusions. Each question must be specific to what is actually written below, never generic textbook advice.

Focus especially on:
- Whether the stated analysis actually answers the stated research question
- Whether the outcome definition is specific and measurable enough to be assessed reliably
- Confounding the covariate/exposure list may be missing, given the population and design described
- Whether the study design is well suited to the research question being asked

Do not repeat purely mechanical issues (missing fields, variable type mismatches, statistical formula thresholds) -- those are already checked elsewhere and are not your job. Focus only on judgement calls a human reviewer would probe.

If the protocol is too sparse to raise a specific, well-founded question in one of the areas above, omit that area entirely rather than inventing a generic one. Return at most 8 considerations.`;

const ConsiderationSchema = z.object({
  section: z
    .enum(SECTION_KEYS)
    .describe("The protocol section this consideration relates to most closely."),
  question: z
    .string()
    .describe(
      "A question a reviewer or committee member might raise. Must be phrased as a question or 'consider whether...' prompt, never a statement of approval, disapproval, or quality verdict.",
    ),
});

const ResponseSchema = z.object({
  considerations: z.array(ConsiderationSchema).max(8),
});

function snapshotToPromptText(s: QualitySnapshot): string {
  const lines: string[] = [];
  lines.push(`Study title: ${s.study_title || "(not provided)"}`);
  lines.push(`Study design: ${s.study_design || "(not provided)"}`);
  lines.push(`Research question: ${s.research_question || "(not provided)"}`);
  lines.push("Objectives:");
  if (s.objectives.length) {
    for (const o of s.objectives) lines.push(`  - [${o.objective_type}] ${o.description}`);
  } else {
    lines.push("  (none provided)");
  }
  lines.push(`Target population: ${s.target_population || "(not provided)"}`);
  lines.push(`Setting: ${s.setting || "(not provided)"}`);
  if (s.inclusion_criteria.length) lines.push(`Inclusion criteria: ${s.inclusion_criteria.join("; ")}`);
  if (s.exclusion_criteria.length) lines.push(`Exclusion criteria: ${s.exclusion_criteria.join("; ")}`);
  lines.push("Variables:");
  if (s.variables.length) {
    for (const v of s.variables) lines.push(`  - ${v.variable_name} (${v.variable_type}, role: ${v.role})`);
  } else {
    lines.push("  (none provided)");
  }
  lines.push(`Statistical methods: ${s.statistical_methods || "(not provided)"}`);
  lines.push(`Primary analysis: ${s.primary_analysis || "(not provided)"}`);
  if (s.sample_size_inputs?.design_type) lines.push(`Sample size design: ${s.sample_size_inputs.design_type}`);
  if (s.calculated_sample_size != null) lines.push(`Calculated sample size: ${s.calculated_sample_size}`);
  lines.push(`Data collection methods: ${s.data_collection_methods || "(not provided)"}`);
  lines.push(`Ethical approval body: ${s.ethical_approval_body || "(not provided)"}`);
  lines.push(`Consent process: ${s.consent_process || "(not provided)"}`);
  return lines.join("\n");
}

export type Tier3Result = { error?: string; issues?: QualityIssue[] };

export async function runTier3Review(snapshot: QualitySnapshot): Promise<Tier3Result> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "AI review isn't configured yet (the ANTHROPIC_API_KEY environment variable is missing)." };
  }

  if (!snapshot.research_question.trim() && !snapshot.study_design.trim()) {
    return { error: "Fill in at least the study design or research question before requesting a review." };
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: snapshotToPromptText(snapshot) }],
      output_config: { format: zodOutputFormat(ResponseSchema) },
    });

    if (!response.parsed_output) {
      return { error: "The model's response could not be parsed into a structured list." };
    }

    const issues: QualityIssue[] = response.parsed_output.considerations.map((c, i) => ({
      id: `tier3-${i}`,
      section: c.section,
      tier: 3,
      message: c.question,
    }));

    return { issues };
  } catch (err) {
    return { error: `AI review failed: ${(err as Error).message}` };
  }
}

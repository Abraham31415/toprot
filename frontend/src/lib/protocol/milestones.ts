export const MILESTONE_TYPES = [
  "protocol_written",
  "ethics_submitted",
  "ethics_approved",
  "enrollment_started",
  "enrollment_completed",
  "data_collection_complete",
  "analysis_complete",
  "manuscript_drafted",
  "submitted_for_publication",
  "defended",
  "published",
] as const;

export type MilestoneType = (typeof MILESTONE_TYPES)[number];
export type MilestoneStatus = "pending" | "in_progress" | "complete";

export const MILESTONE_LABELS: Record<MilestoneType, string> = {
  protocol_written: "Protocol written",
  ethics_submitted: "Ethics submitted",
  ethics_approved: "Ethics approved",
  enrollment_started: "Enrollment started",
  enrollment_completed: "Enrollment completed",
  data_collection_complete: "Data collection complete",
  analysis_complete: "Analysis complete",
  manuscript_drafted: "Manuscript drafted",
  submitted_for_publication: "Submitted for publication",
  defended: "Defended",
  published: "Published",
};

export type MilestoneRow = {
  id: string;
  study_id: string;
  milestone_type: MilestoneType;
  status: MilestoneStatus;
  target_date: string | null;
  completed_at: string | null;
  notes: string | null;
  updated_at: string;
};

/** The furthest-along milestone that isn't still 'pending', or null if none has started. */
export function currentStage(milestones: Pick<MilestoneRow, "milestone_type" | "status">[]): string | null {
  const byType = new Map(milestones.map((m) => [m.milestone_type, m.status]));
  let latest: MilestoneType | null = null;
  for (const type of MILESTONE_TYPES) {
    if (byType.get(type) && byType.get(type) !== "pending") latest = type;
  }
  return latest ? MILESTONE_LABELS[latest] : null;
}

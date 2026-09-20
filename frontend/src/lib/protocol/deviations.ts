export const DEVIATION_CATEGORIES = [
  "eligibility",
  "intervention",
  "data_collection",
  "consent",
  "sample_size",
  "timeline",
  "analysis",
  "other",
] as const;

export type DeviationCategory = (typeof DEVIATION_CATEGORIES)[number];

export type DeviationRow = {
  id: string;
  category: DeviationCategory;
  description: string;
  occurred_at: string;
  impact_assessment: string | null;
  created_at: string;
};

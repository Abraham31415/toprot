/** Old guide addresses that now point somewhere else. Used by next.config.ts, so a link to an old address keeps working. Kept free of imports so the config can load it. */
export const RENAMED_GUIDES: Record<string, string> = {
  "choosing-a-study-design": "how-to-choose-a-study-design",
  "interpreting-p-values-and-confidence-intervals": "understanding-p-values-and-confidence-intervals",
  "how-to-do-a-literature-review": "how-to-conduct-a-literature-review",
};

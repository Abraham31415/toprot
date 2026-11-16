import { collabErrorMessage } from "./errors";
import { isUuid } from "./roles";
import type { DbLike } from "./service";

// Supervision review workflow: types, labels and thin server wrappers over the database functions.
// This is an INTERNAL ToProt workflow. It is not ethics committee approval, institutional approval or journal peer review.

export const REVIEW_DISCLAIMER =
  "This is ToProt's internal supervision workflow. An approval here records that a supervisor reviewed a submitted version. It is not ethics committee approval, institutional approval or journal peer review.";

export type ReviewStatus = "draft" | "submitted" | "under_review" | "changes_requested" | "resubmitted" | "approved";

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  changes_requested: "Changes requested",
  resubmitted: "Resubmitted",
  approved: "Approved",
};

export const STATUS_TONE: Record<ReviewStatus, "neutral" | "info" | "warning" | "success"> = {
  draft: "neutral", submitted: "info", under_review: "info", changes_requested: "warning", resubmitted: "info", approved: "success",
};

/** Comment sections a reviewer can attach a thread to. Section level only: the manuscript editor has no reliable anchor API. */
export const PROTOCOL_SECTIONS: { key: string; label: string }[] = [
  { key: "research_question", label: "Research question" },
  { key: "study_design", label: "Study design" },
  { key: "target_population", label: "Population and eligibility" },
  { key: "setting", label: "Setting" },
  { key: "statistical_methods", label: "Statistical methods" },
  { key: "primary_analysis", label: "Primary analysis" },
  { key: "sample_size_method", label: "Sample size" },
  { key: "data_collection_methods", label: "Data collection" },
  { key: "data_management_plan", label: "Data management" },
  { key: "consent_process", label: "Consent process" },
  { key: "risks_and_benefits", label: "Risks and benefits" },
  { key: "confidentiality_plan", label: "Confidentiality" },
];

export function sectionLabel(section: string, manuscripts: { id: string; title: string }[] = []): string {
  if (section === "general") return "General";
  if (section.startsWith("protocol:")) return PROTOCOL_SECTIONS.find((s) => `protocol:${s.key}` === section)?.label ?? section.slice(9).replace(/_/g, " ");
  if (section.startsWith("manuscript:")) return manuscripts.find((m) => `manuscript:${m.id}` === section)?.title ?? "Manuscript";
  return section;
}

export function isSection(v: unknown): v is string {
  return typeof v === "string" && /^(general|protocol:[a-z_]{1,60}|manuscript:[0-9a-f-]{36})$/.test(v);
}

export type ReviewOverview = {
  your_role: "owner" | "editor" | "reviewer" | "viewer";
  latest_submission: null | { id: string; number: number; note: string | null; created_at: string; submitted_by: string | null; content_hash: string; manuscripts: { id: string; title: string; revision: number }[] };
  submissions: { id: string; number: number; created_at: string; note: string | null; submitted_by: string | null }[];
  reviewers: {
    user_id: string; full_name: string; title_label: string | null; status: ReviewStatus; on_latest: boolean | null; updated_at: string | null;
    history: { from: string | null; to: string; note: string | null; at: string; submission: number | null }[];
    approvals: { number: number; at: string; statement: string | null; submission: number; content_hash: string; current: boolean }[];
  }[];
  threads: { id: string; section: string; status: "open" | "resolved"; created_at: string; submission: number | null; resolved_at: string | null; comments: { id: string; author: string | null; author_id: string | null; body: string; at: string }[] }[];
};

export type ReviewResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const MESSAGES: Record<string, string> = {
  no_reviewers: "Invite at least one supervisor (reviewer) before submitting for review.",
  review_in_progress: "A supervisor is part-way through a review. Ask them to finish, or to request changes, before submitting again.",
  nothing_to_review: "Nothing has been submitted to you for review yet.",
  invalid_transition: "That step is not available right now.",
  note_required: "Add a note explaining what needs to change.",
  confirmation_required: "Confirm that you have reviewed the submitted version.",
  submission_superseded: "A newer version was submitted. Start the review again on the latest version.",
  not_reviewer: "Only a supervisor on this project can do that.",
  not_allowed: "You do not have permission to do that on this project.",
  invalid_comment: "A comment needs between 1 and 4000 characters.",
  invalid_section: "Choose a section to comment on.",
  thread_not_found: "That comment thread no longer exists.",
  rate_limited: "You are commenting very quickly. Wait a moment and try again.",
};

export function reviewError(message: string | undefined | null): string {
  if (message) for (const [code, text] of Object.entries(MESSAGES)) if (message.includes(code)) return text;
  return collabErrorMessage(message, "That did not work. Try again in a moment.");
}

async function run<T>(db: DbLike, fn: string, args: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await db.rpc(fn, args);
  return error ? { error: reviewError(error.message) } : { data: data as T };
}

export async function getOverview(db: DbLike, actor: string, studyId: string): Promise<ReviewResult<{ overview: ReviewOverview }>> {
  if (!isUuid(studyId)) return { ok: false, error: "Unknown project." };
  const r = await run<ReviewOverview>(db, "collab_review_overview", { p_actor: actor, p_study: studyId });
  return r.data ? { ok: true, overview: r.data } : { ok: false, error: r.error ?? "Could not load the review." };
}

export async function submitForReview(db: DbLike, actor: string, studyId: string, note: string | null): Promise<ReviewResult<{ number: number; reviewers: number }>> {
  if (!isUuid(studyId)) return { ok: false, error: "Unknown project." };
  const r = await run<{ submission_number: number; reviewers: number }>(db, "collab_review_submit", { p_actor: actor, p_study: studyId, p_note: note?.slice(0, 2000) ?? null });
  return r.data ? { ok: true, number: r.data.submission_number, reviewers: r.data.reviewers } : { ok: false, error: r.error ?? "Could not submit." };
}

export type Decision = "under_review" | "changes_requested" | "approved";
export async function decide(db: DbLike, actor: string, studyId: string, to: Decision, opts: { note?: string; statement?: string; confirm?: boolean } = {}): Promise<ReviewResult> {
  if (!isUuid(studyId)) return { ok: false, error: "Unknown project." };
  if (!["under_review", "changes_requested", "approved"].includes(to)) return { ok: false, error: "That step is not available." };
  const r = await run<unknown>(db, "collab_review_transition", {
    p_actor: actor, p_study: studyId, p_to: to, p_note: opts.note?.slice(0, 4000) ?? null, p_statement: opts.statement?.slice(0, 2000) ?? null, p_confirm: opts.confirm === true,
  });
  return r.error ? { ok: false, error: r.error } : { ok: true };
}

export async function addComment(db: DbLike, actor: string, studyId: string, section: string, body: string, threadId: string | null): Promise<ReviewResult> {
  if (!isUuid(studyId) || (threadId !== null && !isUuid(threadId))) return { ok: false, error: "Unknown project." };
  if (threadId === null && !isSection(section)) return { ok: false, error: reviewError("invalid_section") };
  const r = await run<unknown>(db, "collab_comment_add", { p_actor: actor, p_study: studyId, p_section: section, p_body: body, p_thread: threadId });
  return r.error ? { ok: false, error: r.error } : { ok: true };
}

export async function resolveThread(db: DbLike, actor: string, studyId: string, threadId: string, resolved: boolean): Promise<ReviewResult> {
  if (!isUuid(studyId) || !isUuid(threadId)) return { ok: false, error: "Unknown thread." };
  const r = await run<unknown>(db, "collab_thread_resolve", { p_actor: actor, p_study: studyId, p_thread: threadId, p_resolved: resolved });
  return r.error ? { ok: false, error: r.error } : { ok: true };
}

export type NotificationItem = { id: string; kind: string; study_id: string | null; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };

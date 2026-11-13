"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProject } from "@/lib/collab/access";
import { dispatchNotificationEmails } from "@/lib/collab/notify-email";
import { addComment, decide, resolveThread, submitForReview, type Decision, type ReviewResult } from "@/lib/collab/review";

// Every action here re-checks the project role on the server AND the database function checks it again, so the screen is only a convenience.

type Out = { error?: string; message?: string };
const done = async (studyId: string, message: string): Promise<Out> => {
  revalidatePath(`/studies/${studyId}/review`); revalidatePath("/supervisor");
  await dispatchNotificationEmails(createAdminClient(), undefined, 10).catch(() => undefined); // best effort; a daily job retries
  return { message };
};
const fail = (r: Extract<ReviewResult, { ok: false }>): Out => ({ error: r.error });

export async function submitReview(studyId: string, note: string): Promise<Out> {
  const a = await requireProject(studyId, "write");
  if (!a.ok) return { error: a.error };
  const r = await submitForReview(createAdminClient(), a.userId, studyId, note.trim() || null);
  return r.ok ? await done(studyId, `Submitted as version ${r.number} to ${r.reviewers} supervisor${r.reviewers === 1 ? "" : "s"}. They have been notified in the app.`) : fail(r);
}

export async function reviewDecision(studyId: string, to: Decision, input: { note?: string; statement?: string; confirm?: boolean }): Promise<Out> {
  const a = await requireProject(studyId, "review");
  if (!a.ok) return { error: a.error };
  const r = await decide(createAdminClient(), a.userId, studyId, to, input);
  if (!r.ok) return fail(r);
  return await done(studyId, to === "under_review" ? "You are now reviewing the latest submission." : to === "changes_requested" ? "Changes requested. The researcher has been notified." : "Approved. This is recorded as an internal ToProt approval.");
}

export async function postComment(studyId: string, section: string, body: string, threadId: string | null): Promise<Out> {
  const a = await requireProject(studyId, "comment");
  if (!a.ok) return { error: a.error };
  const r = await addComment(createAdminClient(), a.userId, studyId, section, body, threadId);
  return r.ok ? await done(studyId, "Comment posted.") : fail(r);
}

export async function setThreadResolved(studyId: string, threadId: string, resolved: boolean): Promise<Out> {
  const a = await requireProject(studyId, "comment");
  if (!a.ok) return { error: a.error };
  const r = await resolveThread(createAdminClient(), a.userId, studyId, threadId, resolved);
  return r.ok ? await done(studyId, resolved ? "Thread resolved." : "Thread reopened.") : fail(r);
}

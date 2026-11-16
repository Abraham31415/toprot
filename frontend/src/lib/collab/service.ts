import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailConfigured, type EmailResult } from "@/lib/email/send";
import { collabErrorMessage } from "./errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { isEmail, isMemberRole, isTitleLabel, isUuid, type MemberRole } from "./roles";
import { SITE_URL } from "@/lib/site";

// Server-only wrappers around the collaboration database functions. Each call names the acting user, and the database function
// verifies that user's role again, so a mistake here cannot widen access.

export type CollabResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export type DbLike = Pick<ReturnType<typeof createAdminClient>, "rpc">;

async function call<T>(db: DbLike, fn: string, args: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await db.rpc(fn, args);
  if (error) return { error: collabErrorMessage(error.message, "That did not work. Try again in a moment.") };
  return { data: data as T };
}

export function inviteLink(token: string): string {
  return `${SITE_URL}/invite/${token}`;
}

const ROLE_PHRASE: Record<MemberRole, string> = { reviewer: "a reviewer", editor: "an editor", viewer: "a viewer" };

export function inviteEmailText(args: { inviterName: string; projectTitle: string; role: MemberRole; link: string; expiresAt: string }): { subject: string; text: string } {
  const when = new Date(args.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return {
    subject: `${args.inviterName} invited you to a research project on ToProt`,
    text:
      `${args.inviterName} invited you to the project "${args.projectTitle}" on ToProt as ${ROLE_PHRASE[args.role]}.\n\n` +
      `Open this link and sign in (or create an account) with this email address to accept:\n${args.link}\n\n` +
      `The link works only for this email address and expires on ${when}. If you were not expecting this, you can ignore the email.`,
  };
}

type Delivered = { ok: true; invitationId: string; link: string; delivery: EmailResult["status"]; deliveryError?: string };
type Actor = { id: string; name: string };
type Deps = { send?: typeof sendEmail };

/**
 * Create an invitation and try to email it. `delivery` is what actually happened: the invitation is only described as emailed when the
 * provider accepted the message. `link` is returned so the owner can share it by hand when email is not set up or failed.
 */
export async function createInvitation(
  db: DbLike, actor: Actor,
  input: { studyId: string; projectTitle: string; email: string; role: string; label?: string | null },
  deps: Deps = {},
): Promise<Delivered | { ok: false; error: string }> {
  if (!isUuid(input.studyId)) return { ok: false, error: "Unknown project." };
  const email = input.email.trim().toLowerCase();
  if (!isEmail(email)) return { ok: false, error: "Enter a valid email address." };
  if (!isMemberRole(input.role)) return { ok: false, error: "Choose a role." };
  const label = isTitleLabel(input.label) ? input.label : null;
  const gate = checkRateLimit(`invite:${actor.id}`, { limit: 30, windowMs: 3600_000 });
  if (!gate.ok) return { ok: false, error: "Too many invitation attempts. Try again later." };

  const made = await call<{ invitation_id: string; token: string; expires_at: string }>(db, "collab_invite", {
    p_actor: actor.id, p_study: input.studyId, p_email: email, p_role: input.role, p_label: label,
  });
  if (!made.data) return { ok: false, error: made.error ?? "Could not create the invitation." };
  return deliver(db, actor, { ...made.data, email, role: input.role, projectTitle: input.projectTitle }, deps);
}

async function deliver(
  db: DbLike, actor: Actor,
  inv: { invitation_id: string; token: string; expires_at: string; email: string; role: MemberRole; projectTitle: string },
  deps: Deps,
): Promise<Delivered> {
  const link = inviteLink(inv.token);
  const mail = inviteEmailText({ inviterName: actor.name || "A ToProt user", projectTitle: inv.projectTitle, role: inv.role, link, expiresAt: inv.expires_at });
  const result = await (deps.send ?? sendEmail)({ to: inv.email, ...mail });
  const accepted = result.status === "provider_accepted";
  await db.rpc("collab_set_delivery", {
    p_invitation: inv.invitation_id, p_status: result.status,
    p_error: accepted ? null : result.error, p_message_id: accepted ? result.id : null,
  });
  if (accepted) await db.rpc("collab_usage_bump", { p_metric: "invitation_emails", p_n: 1 });
  return { ok: true, invitationId: inv.invitation_id, link, delivery: result.status, deliveryError: accepted ? undefined : result.error };
}

export async function resendInvitation(db: DbLike, actor: Actor, invitationId: string, projectTitle: string, deps: Deps = {}): Promise<Delivered | { ok: false; error: string }> {
  if (!isUuid(invitationId)) return { ok: false, error: "Unknown invitation." };
  const r = await call<{ invitation_id: string; token: string; expires_at: string; email: string; role: MemberRole }>(db, "collab_resend", { p_actor: actor.id, p_invitation: invitationId });
  if (!r.data) return { ok: false, error: r.error ?? "Could not resend." };
  return deliver(db, actor, { ...r.data, projectTitle }, deps);
}

export async function revokeInvitation(db: DbLike, actorId: string, invitationId: string): Promise<CollabResult> {
  if (!isUuid(invitationId)) return { ok: false, error: "Unknown invitation." };
  const r = await call<null>(db, "collab_revoke", { p_actor: actorId, p_invitation: invitationId });
  return r.error ? { ok: false, error: r.error } : { ok: true };
}

export async function removeMember(db: DbLike, actorId: string, studyId: string, userId: string): Promise<CollabResult> {
  if (!isUuid(studyId) || !isUuid(userId)) return { ok: false, error: "Unknown person." };
  const r = await call<null>(db, "collab_remove_member", { p_actor: actorId, p_study: studyId, p_user: userId });
  return r.error ? { ok: false, error: r.error } : { ok: true };
}

export async function changeMemberRole(db: DbLike, actorId: string, studyId: string, userId: string, role: string): Promise<CollabResult> {
  if (!isUuid(studyId) || !isUuid(userId) || !isMemberRole(role)) return { ok: false, error: "Choose a role." };
  const r = await call<null>(db, "collab_change_role", { p_actor: actorId, p_study: studyId, p_user: userId, p_role: role, p_label: null });
  return r.error ? { ok: false, error: r.error } : { ok: true };
}

type Accepted = { study_id?: string; team_id?: string; kind?: "project" | "team" };
/** Where an accepted invitation leads: a project (protocol page) or a team. */
export const acceptedPath = (a: Accepted): string => (a.kind === "team" && a.team_id ? `/teams/${a.team_id}` : a.study_id ? `/studies/${a.study_id}/protocol` : "/shared");

export async function acceptInvitationByToken(db: DbLike, actorId: string, token: string): Promise<CollabResult<{ path: string }>> {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return { ok: false, error: collabErrorMessage("invitation_invalid") };
  const r = await call<Accepted>(db, "collab_accept", { p_actor: actorId, p_token: token });
  return r.data ? { ok: true, path: acceptedPath(r.data) } : { ok: false, error: r.error ?? collabErrorMessage("invitation_invalid") };
}

export async function acceptInvitationById(db: DbLike, actorId: string, invitationId: string): Promise<CollabResult<{ path: string }>> {
  if (!isUuid(invitationId)) return { ok: false, error: "Unknown invitation." };
  const r = await call<Accepted>(db, "collab_accept_by_id", { p_actor: actorId, p_invitation: invitationId });
  return r.data ? { ok: true, path: acceptedPath(r.data) } : { ok: false, error: r.error ?? "Could not accept." };
}

export async function declineInvitation(db: DbLike, actorId: string, invitationId: string): Promise<CollabResult> {
  if (!isUuid(invitationId)) return { ok: false, error: "Unknown invitation." };
  const r = await call<null>(db, "collab_decline", { p_actor: actorId, p_invitation: invitationId });
  return r.error ? { ok: false, error: r.error } : { ok: true };
}

export { emailConfigured };

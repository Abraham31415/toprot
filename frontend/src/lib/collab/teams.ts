import { collabErrorMessage } from "./errors";
import { isEmail, isUuid, type ProjectRole } from "./roles";
import { sendEmail, type EmailResult } from "@/lib/email/send";
import { SITE_URL } from "@/lib/site";
import { checkRateLimit } from "@/lib/rate-limit";
import type { DbLike } from "./service";

// Teams: roles, seats and thin server wrappers over the team_* database functions.
// Team membership never grants access to a project's content; see supabase/migrations/20261122090000_collab_teams.sql.

export type TeamRole = "owner" | "administrator" | "member" | "guest";
export type TeamInviteRole = Exclude<TeamRole, "owner">;
export type TeamCapability = "view_dashboard" | "create_project" | "invite" | "appoint_admin" | "manage_members" | "upload_documents" | "share_references" | "rename";

const CAPS: Record<TeamRole, readonly TeamCapability[]> = {
  owner: ["view_dashboard", "create_project", "invite", "appoint_admin", "manage_members", "upload_documents", "share_references", "rename"],
  administrator: ["view_dashboard", "create_project", "invite", "manage_members", "upload_documents", "share_references"],
  member: ["view_dashboard", "create_project", "upload_documents", "share_references"],
  guest: [],
};
export const teamCan = (role: TeamRole | null | undefined, cap: TeamCapability) => !!role && CAPS[role].includes(cap);

export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { owner: "Owner", administrator: "Administrator", member: "Member", guest: "Guest reviewer" };
export const TEAM_ROLE_SUMMARY: Record<TeamRole, string> = {
  owner: "Manages the team, its members and its plan.",
  administrator: "Invites and removes members and guests. Cannot appoint administrators.",
  member: "Takes a paid seat. Creates team projects and shares files and references with the team.",
  guest: "A free guest seat for an outside reviewer. Sees only the projects they are added to.",
};
export const TEAM_INVITE_ROLES: readonly TeamInviteRole[] = ["member", "guest", "administrator"];
export const isTeamInviteRole = (v: unknown): v is TeamInviteRole => typeof v === "string" && (TEAM_INVITE_ROLES as readonly string[]).includes(v);

export type TeamOverview = {
  team: { id: string; name: string; created_at: string };
  your_role: TeamRole;
  entitlements: { state: string; max_paid_seats: number; max_guests: number; max_projects: number; max_storage_mb: number };
  seats: { paid_used: number; paid_invited: number; guests_used: number; guests_invited: number };
  members: { user_id: string; full_name: string; institution: string | null; role: TeamRole; seat_type: "paid" | "guest"; joined_at: string; projects: number }[];
  invitations: { id: string; email: string; role: TeamInviteRole; created_at: string; expires_at: string; delivery_status: string; delivery_error: string | null; expired: boolean }[];
  stats: { projects: number; active_projects: number; documents: number; storage_bytes: number; shared_references: number; submissions: number; approvals: number };
  projects: { id: string; title: string; status: string; owner: string; owner_id: string; last_activity_at: string; people: number; your_role: ProjectRole | null }[];
};
export type TeamSummary = { id: string; name: string; role: TeamRole; seat_type: "paid" | "guest"; members: number; projects: number };
export type ActivityItem = { at: string; action: string; actor: string | null; target: string | null; meta: Record<string, unknown>; project: string | null };
export type LibraryItem = { id: string; shared_by: string | null; shared_by_id: string | null; shared_at: string; source_title: string; title: string; authors: string[] | null; journal: string | null; year: number | null; doi: string | null; pmid: string | null; linked_projects: number };
export type TeamDocument = { id: string; name: string; mime: string; size_bytes: number; uploaded_by: string | null; uploaded_by_id: string | null; created_at: string; project: string | null; study_id: string | null };

export const ACTIVITY_TEXT: Record<string, string> = {
  team_created: "created the team",
  team_renamed: "renamed the team",
  team_invitation_created: "invited someone to the team",
  team_invitation_revoked: "withdrew a team invitation",
  team_member_joined: "joined the team",
  team_member_left: "left the team",
  team_member_removed: "removed a member",
  team_role_changed: "changed a member's role",
  project_transferred: "transferred a project",
  project_member_added: "added a member to a project",
  member_added_from_team: "added a team member to a project",
  reference_shared: "shared a reference with the team",
  document_uploaded: "uploaded a document",
  document_deleted: "deleted a document",
  invitation_created: "invited someone to a project",
  invitation_revoked: "withdrew a project invitation",
  invitation_resent: "resent a project invitation",
  member_joined: "joined a project",
  member_removed: "removed someone from a project",
  member_left: "left a project",
  member_role_changed: "changed a project role",
  review_submitted: "submitted a project for review",
  review_approved: "approved a project (internal review)",
  review_changes_requested: "requested changes on a project",
  review_under_review: "started reviewing a project",
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

const MESSAGES: Record<string, string> = {
  not_team_admin: "Only a team owner or administrator can do that.",
  not_team_member: "You need a paid seat on this team to do that.",
  no_paid_seat: "This team has no free paid seat. Add seats in billing or remove a member.",
  no_guest_seat: "This team has no free guest seat.",
  owner_cannot_leave: "The team owner cannot be removed.",
  owns_team_projects: "That person owns team projects. Transfer them to another member first.",
  too_many_teams: "You have reached the limit for teams you can own.",
  invalid_name: "A team name needs 2 to 80 characters.",
  team_project_limit: "This team has reached its project limit.",
  team_seat_required: "Only members with a paid team seat can be editors or viewers on a team project. Outside people can be reviewers.",
  guest_reviewer_only: "Guests can only be reviewers.",
  not_team_project: "That project is not a team project.",
  storage_full: "The team has used all of its document storage.",
  unsupported_type: "That file type is not allowed. Use PDF, Word, Excel, CSV, text, PNG or JPEG.",
  invalid_document: "The file is empty, too large, or has an invalid name.",
  upload_missing: "The upload did not arrive. Try again.",
  not_allowed: "You do not have permission to do that.",
  forbidden: "You do not have access to this team.",
  rate_limited: "Too many uploads. Try again later.",
};
export function teamError(message: string | undefined | null): string {
  if (message) for (const [code, text] of Object.entries(MESSAGES)) if (message.includes(code)) return text;
  return collabErrorMessage(message, "That did not work. Try again in a moment.");
}

type Res<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
async function run<T>(db: DbLike, fn: string, args: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await db.rpc(fn, args);
  return error ? { error: teamError(error.message) } : { data: data as T };
}

export const listTeams = async (db: DbLike, actor: string) => ((await run<TeamSummary[]>(db, "team_list", { p_actor: actor })).data ?? []);
export async function getTeam(db: DbLike, actor: string, teamId: string): Promise<Res<{ overview: TeamOverview }>> {
  if (!isUuid(teamId)) return { ok: false, error: "Unknown team." };
  const r = await run<TeamOverview>(db, "team_overview", { p_actor: actor, p_team: teamId });
  return r.data ? { ok: true, overview: r.data } : { ok: false, error: r.error ?? "Could not load the team." };
}
export async function createTeam(db: DbLike, actor: string, name: string): Promise<Res<{ teamId: string }>> {
  const r = await run<string>(db, "team_create", { p_actor: actor, p_name: name });
  return r.data ? { ok: true, teamId: r.data } : { ok: false, error: r.error ?? "Could not create the team." };
}
export async function getActivity(db: DbLike, actor: string, teamId: string, limit = 40): Promise<ActivityItem[]> {
  return isUuid(teamId) ? ((await run<ActivityItem[]>(db, "team_activity", { p_actor: actor, p_team: teamId, p_limit: limit })).data ?? []) : [];
}
export async function getLibrary(db: DbLike, actor: string, teamId: string): Promise<LibraryItem[]> {
  return isUuid(teamId) ? ((await run<LibraryItem[]>(db, "team_library", { p_actor: actor, p_team: teamId })).data ?? []) : [];
}
export async function getDocuments(db: DbLike, actor: string, teamId: string): Promise<TeamDocument[]> {
  return isUuid(teamId) ? ((await run<TeamDocument[]>(db, "team_documents_list", { p_actor: actor, p_team: teamId })).data ?? []) : [];
}

export function teamInviteText(args: { inviterName: string; teamName: string; role: TeamInviteRole; link: string; expiresAt: string }): { subject: string; text: string } {
  const when = new Date(args.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const as = args.role === "guest" ? "a guest reviewer" : args.role === "administrator" ? "an administrator" : "a member";
  return {
    subject: `${args.inviterName} invited you to join a team on ToProt`,
    text: `${args.inviterName} invited you to the team "${args.teamName}" on ToProt as ${as}.\n\nOpen this link and sign in (or create an account) with this email address to accept:\n${args.link}\n\n` +
      `The link works only for this email address and expires on ${when}. Joining a team does not give you access to any project until its owner adds you. If you were not expecting this, ignore the email.`,
  };
}

export type TeamInviteOutcome = { ok: true; invitationId: string; link: string; delivery: EmailResult["status"]; deliveryError?: string } | { ok: false; error: string };

async function deliverTeam(db: DbLike, actorName: string, teamName: string, inv: { invitation_id: string; token: string; expires_at: string; email: string; role: TeamInviteRole }, send: typeof sendEmail): Promise<TeamInviteOutcome> {
  const link = `${SITE_URL}/invite/${inv.token}`;
  const result = await send({ to: inv.email, ...teamInviteText({ inviterName: actorName || "A ToProt user", teamName, role: inv.role, link, expiresAt: inv.expires_at }) });
  const accepted = result.status === "provider_accepted";
  await db.rpc("team_set_delivery", { p_invitation: inv.invitation_id, p_status: result.status, p_error: accepted ? null : result.error, p_message_id: accepted ? result.id : null });
  return { ok: true, invitationId: inv.invitation_id, link, delivery: result.status, deliveryError: accepted ? undefined : result.error };
}

export async function inviteToTeam(db: DbLike, actor: { id: string; name: string }, teamId: string, teamName: string, email: string, role: string, send: typeof sendEmail = sendEmail): Promise<TeamInviteOutcome> {
  if (!isUuid(teamId)) return { ok: false, error: "Unknown team." };
  const e = email.trim().toLowerCase();
  if (!isEmail(e)) return { ok: false, error: "Enter a valid email address." };
  if (!isTeamInviteRole(role)) return { ok: false, error: "Choose a role." };
  if (!checkRateLimit(`invite:${actor.id}`, { limit: 30, windowMs: 3600_000 }).ok) return { ok: false, error: "Too many invitation attempts. Try again later." };
  const r = await run<{ invitation_id: string; token: string; expires_at: string; email: string; role: TeamInviteRole }>(db, "team_invite", { p_actor: actor.id, p_team: teamId, p_email: e, p_role: role });
  if (!r.data) return { ok: false, error: r.error ?? "Could not create the invitation." };
  return deliverTeam(db, actor.name, teamName, r.data, send);
}

export async function resendTeamInvite(db: DbLike, actor: { id: string; name: string }, teamName: string, invitationId: string, send: typeof sendEmail = sendEmail): Promise<TeamInviteOutcome> {
  if (!isUuid(invitationId)) return { ok: false, error: "Unknown invitation." };
  const r = await run<{ invitation_id: string; token: string; expires_at: string; email: string; role: TeamInviteRole }>(db, "team_resend", { p_actor: actor.id, p_invitation: invitationId });
  if (!r.data) return { ok: false, error: r.error ?? "Could not resend." };
  return deliverTeam(db, actor.name, teamName, r.data, send);
}

export async function simple(db: DbLike, fn: string, args: Record<string, unknown>): Promise<Res> {
  for (const v of Object.values(args)) if (typeof v === "string" && v.length === 36 && !isUuid(v)) return { ok: false, error: "Unknown item." };
  const r = await run<unknown>(db, fn, args);
  return r.error ? { ok: false, error: r.error } : { ok: true };
}
export { run as teamRpc };

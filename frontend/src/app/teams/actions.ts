"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProject } from "@/lib/collab/access";
import { isMemberRole, isUuid } from "@/lib/collab/roles";
import { createTeam, getTeam, inviteToTeam, resendTeamInvite, simple, teamCan, teamError, type TeamInviteOutcome, type TeamCapability } from "@/lib/collab/teams";

// Every action checks the team role on the server, and the database function checks it again.

export type TeamResult = { error?: string; message?: string; link?: string; teamId?: string };

async function who() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: p } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  return { id: user.id, name: p?.full_name?.trim() || "A ToProt user", supabase };
}

/** Loads the team for the signed-in user and checks they hold `cap`. */
async function gate(teamId: string, cap?: TeamCapability) {
  const me = await who();
  if (!me) return { error: "Sign in to continue." } as const;
  const t = await getTeam(createAdminClient(), me.id, teamId);
  if (!t.ok) return { error: t.error } as const;
  if (cap && !teamCan(t.overview.your_role, cap)) return { error: "You do not have permission to do that in this team." } as const;
  return { me, overview: t.overview } as const;
}

const out = (teamId: string, message: string): TeamResult => { revalidatePath(`/teams/${teamId}`, "layout"); return { message }; };

export async function createTeamAction(name: string): Promise<TeamResult> {
  const me = await who();
  if (!me) return { error: "Sign in to continue." };
  const r = await createTeam(createAdminClient(), me.id, name);
  if (!r.ok) return { error: r.error };
  revalidatePath("/teams");
  return { teamId: r.teamId, message: "Team created." };
}

function delivery(r: TeamInviteOutcome, to: string): TeamResult {
  if (!r.ok) return { error: r.error };
  if (r.delivery === "provider_accepted") return { message: `Invitation emailed to ${to}. The email provider accepted it; it can still take a few minutes to arrive.`, link: r.link };
  if (r.delivery === "not_configured") return { message: "The invitation is created, but email sending is not set up on this server, so nothing was emailed. Copy the link and send it yourself. It works only for the invited email address.", link: r.link };
  return { message: "The invitation is created, but the email could not be sent. Copy the link and send it yourself, or resend later.", link: r.link };
}

export async function inviteMember(teamId: string, email: string, role: string): Promise<TeamResult> {
  const g = await gate(teamId, "invite");
  if ("error" in g) return { error: g.error };
  const r = await inviteToTeam(createAdminClient(), g.me, teamId, g.overview.team.name, email, role);
  if (r.ok) revalidatePath(`/teams/${teamId}`, "layout");
  return delivery(r, email.trim().toLowerCase());
}

export async function resendInvite(teamId: string, invitationId: string): Promise<TeamResult> {
  const g = await gate(teamId, "invite");
  if ("error" in g) return { error: g.error };
  const r = await resendTeamInvite(createAdminClient(), g.me, g.overview.team.name, invitationId);
  return delivery(r, "the invitee");
}

export async function revokeInvite(teamId: string, invitationId: string): Promise<TeamResult> {
  const g = await gate(teamId, "invite");
  if ("error" in g) return { error: g.error };
  const r = await simple(createAdminClient(), "team_revoke", { p_actor: g.me.id, p_invitation: invitationId });
  return r.ok ? out(teamId, "Invitation withdrawn.") : { error: r.error };
}

export async function removeMember(teamId: string, userId: string): Promise<TeamResult> {
  const g = await gate(teamId, "manage_members");
  if ("error" in g) return { error: g.error };
  const r = await simple(createAdminClient(), "team_remove_member", { p_actor: g.me.id, p_team: teamId, p_user: userId });
  return r.ok ? out(teamId, "Removed. They no longer have access to anything in this team.") : { error: r.error };
}

export async function leaveTeam(teamId: string): Promise<TeamResult> {
  const me = await who();
  if (!me) return { error: "Sign in to continue." };
  const r = await simple(createAdminClient(), "team_remove_member", { p_actor: me.id, p_team: teamId, p_user: me.id });
  if (r.ok) revalidatePath("/teams");
  return r.ok ? { message: "You left the team." } : { error: r.error };
}

export async function changeMemberRole(teamId: string, userId: string, role: string): Promise<TeamResult> {
  const g = await gate(teamId, "appoint_admin");
  if ("error" in g) return { error: g.error };
  const r = await simple(createAdminClient(), "team_change_role", { p_actor: g.me.id, p_team: teamId, p_user: userId, p_role: role });
  return r.ok ? out(teamId, "Role updated.") : { error: r.error };
}

export async function addMemberToProject(teamId: string, studyId: string, userId: string, role: string): Promise<TeamResult> {
  const a = await requireProject(studyId, "invite");
  if (!a.ok) return { error: a.error };
  if (!isUuid(teamId) || !isMemberRole(role)) return { error: "Choose a role." };
  const r = await simple(createAdminClient(), "team_project_add_member", { p_actor: a.userId, p_study: studyId, p_user: userId, p_role: role });
  return r.ok ? out(teamId, "Added to the project.") : { error: r.error };
}

export async function transferProject(teamId: string, studyId: string, newOwner: string): Promise<TeamResult> {
  const me = await who();
  if (!me) return { error: "Sign in to continue." };
  const r = await simple(createAdminClient(), "team_project_transfer", { p_actor: me.id, p_study: studyId, p_new_owner: newOwner });
  return r.ok ? out(teamId, "Project transferred. The new owner has full control; you no longer have access unless they add you.") : { error: r.error };
}

// ---- Shared references (associations, never copies) ----

export async function listProjectReferencesForSharing(teamId: string, studyId: string): Promise<{ error?: string; refs?: { id: string; title: string; year: number | null }[] }> {
  const g = await gate(teamId, "share_references");
  if ("error" in g) return { error: g.error };
  const a = await requireProject(studyId, "write");
  if (!a.ok) return { error: a.error };
  const { data } = await a.supabase.from("study_references").select("id, title, year").eq("study_id", studyId).order("title").limit(500);
  return { refs: data ?? [] };
}

export async function shareReference(teamId: string, referenceId: string): Promise<TeamResult> {
  const g = await gate(teamId, "share_references");
  if ("error" in g) return { error: g.error };
  const r = await simple(createAdminClient(), "team_share_reference", { p_actor: g.me.id, p_team: teamId, p_reference: referenceId });
  return r.ok ? out(teamId, "Shared with the team. Your private notes and tags are not shared.") : { error: r.error };
}

export async function unshareReference(teamId: string, teamReferenceId: string): Promise<TeamResult> {
  const me = await who();
  if (!me) return { error: "Sign in to continue." };
  const r = await simple(createAdminClient(), "team_unshare_reference", { p_actor: me.id, p_team_reference: teamReferenceId });
  return r.ok ? out(teamId, "No longer shared.") : { error: r.error };
}

export async function linkReference(teamId: string, studyId: string, teamReferenceId: string): Promise<TeamResult> {
  const me = await who();
  if (!me) return { error: "Sign in to continue." };
  const r = await simple(createAdminClient(), "study_link_reference", { p_actor: me.id, p_study: studyId, p_team_reference: teamReferenceId });
  if (r.ok) { revalidatePath(`/studies/${studyId}/references`); revalidatePath(`/teams/${teamId}/references`); }
  return r.ok ? { message: "Linked into the project. It is not copied: edits by the original owner show everywhere." } : { error: r.error };
}

export async function unlinkReference(studyId: string, teamReferenceId: string): Promise<TeamResult> {
  const me = await who();
  if (!me) return { error: "Sign in to continue." };
  const r = await simple(createAdminClient(), "study_unlink_reference", { p_actor: me.id, p_study: studyId, p_team_reference: teamReferenceId });
  if (r.ok) revalidatePath(`/studies/${studyId}/references`);
  return r.ok ? { message: "Removed from this project." } : { error: r.error };
}

// ---- Documents on a private bucket ----

export async function registerDocument(teamId: string, name: string, mime: string, size: number, studyId: string | null): Promise<{ error?: string; id?: string; path?: string }> {
  const g = await gate(teamId, "upload_documents");
  if ("error" in g) return { error: g.error };
  const { data, error } = await createAdminClient().rpc("team_doc_register", { p_actor: g.me.id, p_team: teamId, p_name: name, p_mime: mime, p_size: Math.floor(size), p_study: studyId });
  if (error) return { error: teamError(error.message) };
  return { id: (data as { id: string }).id, path: (data as { path: string }).path };
}

export async function finalizeDocument(teamId: string, docId: string): Promise<TeamResult> {
  const me = await who();
  if (!me) return { error: "Sign in to continue." };
  const r = await simple(createAdminClient(), "team_doc_finalize", { p_actor: me.id, p_doc: docId });
  return r.ok ? out(teamId, "Uploaded.") : { error: r.error };
}

export async function deleteDocument(teamId: string, docId: string): Promise<TeamResult> {
  const me = await who();
  if (!me) return { error: "Sign in to continue." };
  if (!isUuid(docId)) return { error: "Unknown document." };
  const db = createAdminClient();
  const { data, error } = await db.rpc("team_doc_delete", { p_actor: me.id, p_doc: docId });
  if (error) return { error: teamError(error.message) };
  // The record is already marked deleted (so nobody can read it); removing the stored file is housekeeping.
  if (typeof data === "string") await db.storage.from("team-documents").remove([data]).catch(() => undefined);
  return out(teamId, "Deleted.");
}

/** A short-lived link to one file. Permission is checked by row level security on the signed-in user's own session first. */
export async function documentDownloadUrl(docId: string): Promise<{ error?: string; url?: string }> {
  const me = await who();
  if (!me) return { error: "Sign in to continue." };
  if (!isUuid(docId)) return { error: "Unknown document." };
  const { data: visible } = await me.supabase.from("team_documents").select("id, name").eq("id", docId).maybeSingle();
  if (!visible) return { error: "You do not have access to that document." };
  const db = createAdminClient();
  const { data: row } = await db.from("team_documents").select("storage_path, name").eq("id", docId).eq("status", "ready").is("deleted_at", null).maybeSingle();
  if (!row) return { error: "That document is no longer available." };
  const { data, error } = await db.storage.from("team-documents").createSignedUrl(row.storage_path, 60, { download: row.name });
  if (error || !data) return { error: "Could not prepare the download. Try again." };
  return { url: data.signedUrl };
}

// ---- Team projects ----

/** A normal project owned by the signed-in member, flagged as a team project. The database checks the seat and the team project limit. */
export async function createTeamProject(teamId: string, title: string): Promise<TeamResult & { studyId?: string }> {
  const g = await gate(teamId, "create_project");
  if ("error" in g) return { error: g.error };
  const t = title.trim();
  if (t.length < 1 || t.length > 200) return { error: "Give the project a title (up to 200 characters)." };
  const { supabase, id } = g.me;
  const { data: study, error } = await supabase.from("studies").insert({ owner_id: id, title: t, team_id: teamId }).select("id").single();
  if (error || !study) return { error: teamError(error?.message) };
  const v = await supabase.from("protocol_versions").insert({ study_id: study.id, version_number: 1, status: "draft", study_title: t });
  if (v.error) return { error: v.error.message };
  const { MILESTONE_TYPES } = await import("@/lib/protocol/milestones");
  await supabase.from("milestones").insert(MILESTONE_TYPES.map((milestone_type) => ({ study_id: study.id, milestone_type })));
  revalidatePath(`/teams/${teamId}`, "layout");
  return { message: "Project created.", studyId: study.id };
}

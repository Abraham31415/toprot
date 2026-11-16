"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProject } from "@/lib/collab/access";
import { collabErrorMessage } from "@/lib/collab/errors";
import { changeMemberRole, createInvitation, removeMember, resendInvitation, revokeInvitation } from "@/lib/collab/service";
import { isUuid } from "@/lib/collab/roles";

export type PeopleView = {
  your_role: "owner" | "editor" | "reviewer" | "viewer";
  plan: string;
  owner: { user_id: string; full_name: string; institution: string | null };
  members: { user_id: string; full_name: string; institution: string | null; role: "editor" | "reviewer" | "viewer"; title_label: string | null; joined_at: string; active: boolean }[];
  invitations: { id: string; email: string; role: "editor" | "reviewer" | "viewer"; title_label: string | null; created_at: string; expires_at: string; send_count: number; delivery_status: string; delivery_error: string | null; expired: boolean }[];
  limits: Record<string, { max: number; used: number }>;
  emailConfigured: boolean;
};

export type ShareResult = { error?: string; message?: string; link?: string };

async function actor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: p } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  return { id: user.id, name: p?.full_name?.trim() || "A ToProt user" };
}

export async function loadPeople(studyId: string): Promise<{ error?: string; view?: PeopleView }> {
  const a = await requireProject(studyId, "read");
  if (!a.ok) return { error: a.error };
  const { data, error } = await createAdminClient().rpc("collab_project_people", { p_actor: a.userId, p_study: studyId });
  if (error) return { error: collabErrorMessage(error.message, "Could not load people.") };
  const { emailConfigured } = await import("@/lib/email/send");
  return { view: { ...(data as Omit<PeopleView, "emailConfigured">), emailConfigured: emailConfigured() } };
}

export async function inviteToProject(studyId: string, email: string, role: string, label: string | null): Promise<ShareResult> {
  const a = await requireProject(studyId, "invite");
  if (!a.ok) return { error: a.error };
  const who = await actor();
  if (!who) return { error: "Sign in to continue." };
  const { data: study } = await a.supabase.from("studies").select("title").eq("id", studyId).single();
  const r = await createInvitation(createAdminClient(), who, { studyId, projectTitle: study?.title ?? "Untitled project", email, role, label });
  if (!r.ok) return { error: r.error };
  revalidatePath(`/studies/${studyId}`, "layout");
  return deliveryResult(email, r);
}

export async function resendInvite(studyId: string, invitationId: string): Promise<ShareResult> {
  const a = await requireProject(studyId, "invite");
  if (!a.ok) return { error: a.error };
  const who = await actor();
  if (!who) return { error: "Sign in to continue." };
  const { data: study } = await a.supabase.from("studies").select("title").eq("id", studyId).single();
  const r = await resendInvitation(createAdminClient(), who, invitationId, study?.title ?? "Untitled project");
  if (!r.ok) return { error: r.error };
  return deliveryResult("the invitee", r);
}

function deliveryResult(to: string, r: { delivery: string; link: string; deliveryError?: string }): ShareResult {
  if (r.delivery === "provider_accepted") return { message: `Invitation emailed to ${to}. The email provider accepted it; it can still take a few minutes to arrive.`, link: r.link };
  if (r.delivery === "not_configured") return { message: "The invitation is created, but email sending is not set up on this server, so nothing was emailed. Copy the link below and send it yourself. It works only for the invited email address.", link: r.link };
  return { message: "The invitation is created, but the email could not be sent. Copy the link below and send it yourself, or use Resend later.", link: r.link };
}

export async function revokeInvite(studyId: string, invitationId: string): Promise<ShareResult> {
  const a = await requireProject(studyId, "invite");
  if (!a.ok) return { error: a.error };
  const r = await revokeInvitation(createAdminClient(), a.userId, invitationId);
  if (!r.ok) return { error: r.error };
  return { message: "Invitation withdrawn." };
}

export async function removeFromProject(studyId: string, userId: string): Promise<ShareResult> {
  const a = await requireProject(studyId, "manage_members");
  if (!a.ok) return { error: a.error };
  const r = await removeMember(createAdminClient(), a.userId, studyId, userId);
  if (!r.ok) return { error: r.error };
  revalidatePath(`/studies/${studyId}`, "layout");
  return { message: "Removed. They no longer have access to this project." };
}

export async function changeRole(studyId: string, userId: string, role: string): Promise<ShareResult> {
  const a = await requireProject(studyId, "manage_members");
  if (!a.ok) return { error: a.error };
  const r = await changeMemberRole(createAdminClient(), a.userId, studyId, userId, role);
  if (!r.ok) return { error: r.error };
  return { message: "Role updated." };
}

export async function leaveProject(studyId: string): Promise<ShareResult> {
  if (!isUuid(studyId)) return { error: "Unknown project." };
  const a = await requireProject(studyId, "read");
  if (!a.ok) return { error: a.error };
  if (a.isOwner) return { error: "The owner cannot leave their own project." };
  const r = await removeMember(createAdminClient(), a.userId, studyId, a.userId);
  if (!r.ok) return { error: r.error };
  revalidatePath("/shared");
  return { message: "You left the project." };
}

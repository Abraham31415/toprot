import { createClient } from "@/lib/supabase/server";
import { can, isUuid, type Capability, type ProjectRole } from "./roles";

// The one server-side gate for project access. Server actions and pages call this instead of looking at profile labels or
// comparing owner ids. The answer comes from the database function public.study_role, the same function the row level security
// policies use, so the application check and the database check can never disagree.

type Client = Awaited<ReturnType<typeof createClient>>;

export type Access =
  | { ok: true; supabase: Client; userId: string; role: ProjectRole; canWrite: boolean; isOwner: boolean }
  | { ok: false; error: string; status: 401 | 403 | 404 };

export async function roleOf(supabase: Client, studyId: string): Promise<ProjectRole | null> {
  if (!isUuid(studyId)) return null;
  const { data, error } = await supabase.rpc("study_role", { p_study: studyId });
  if (error || typeof data !== "string") return null;
  return data as ProjectRole;
}

const DENIED: Record<Capability, string> = {
  read: "You do not have access to this project.",
  comment: "You do not have permission to comment on this project.",
  write: "You have read-only access to this project.",
  review: "Only a reviewer can do that.",
  invite: "Only the project owner can invite people.",
  manage_members: "Only the project owner can manage people.",
  lock_protocol: "Only the project owner can lock a protocol.",
  delete_project: "Only the project owner can delete a project.",
};

/** Requires a signed-in user who holds `capability` on the project. */
export async function requireProject(studyId: string, capability: Capability = "read"): Promise<Access> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to continue.", status: 401 };
  const role = await roleOf(supabase, studyId);
  if (!role) return { ok: false, error: "This project does not exist or you do not have access to it.", status: 404 };
  if (!can(role, capability)) return { ok: false, error: DENIED[capability], status: 403 };
  return { ok: true, supabase, userId: user.id, role, canWrite: can(role, "write"), isOwner: role === "owner" };
}

/** Projects the signed-in user may edit (owned, or shared with an editor role), for "save to a project" pickers. */
export async function listWritableStudies(): Promise<{ id: string; title: string }[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  // Row level security already limits studies to those the user can read; keep only the ones they can write.
  const { data } = await supabase.from("studies").select("id, title, owner_id").order("last_activity_at", { ascending: false });
  const out: { id: string; title: string }[] = [];
  for (const s of data ?? []) {
    if (s.owner_id === user.id) { out.push({ id: s.id, title: s.title }); continue; }
    if (can(await roleOf(supabase, s.id), "write")) out.push({ id: s.id, title: s.title });
  }
  return out;
}

import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminErrorMessage } from "./format";

// Server-side access control for the admin console.
//
// Who is an administrator is decided only by the app_admins table, which no browser role can read or write. Every admin page and
// every admin action calls requireAdmin() itself; the layout does not stand in for it, because a layout is not re-checked on every
// navigation. The database functions check the administrator again (admin_assert), so a mistake here still cannot expose data.
// Signed-out visitors are sent to the login page. A signed-in account that is not an administrator gets a plain 404.

export type AdminRole = "owner" | "admin" | "viewer";
export type AdminSession = {
  userId: string;
  email: string;
  role: AdminRole;
  /** Service-role client. Server only; this module is never imported by client components. */
  db: SupabaseClient;
  mfaRequired: boolean;
  /** Authenticator assurance level of this session ("aal2" means a one-time code was entered). */
  aal: string | null;
};

/** MFA is on unless ADMIN_MFA_REQUIRED=false is set deliberately (for example while the project has MFA switched off). */
export const mfaRequired = (): boolean => process.env.ADMIN_MFA_REQUIRED?.trim().toLowerCase() !== "false";

/** The signed-in administrator, without insisting on MFA. Used only by the security page, where the code is entered. */
export async function getAdminSession(): Promise<AdminSession> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const db = createAdminClient();
  const { data } = await db.from("app_admins").select("role").eq("user_id", user.id).maybeSingle();
  if (!data) notFound();
  let aal: string | null = null;
  if (mfaRequired()) {
    const { data: a } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    aal = a?.currentLevel ?? null;
  }
  return { userId: user.id, email: user.email ?? "", role: data.role as AdminRole, db, mfaRequired: mfaRequired(), aal };
}

/** An administrator who has also passed MFA (when it is required). Call this at the top of every admin page and action. */
export async function requireAdmin(): Promise<AdminSession> {
  const s = await getAdminSession();
  if (s.mfaRequired && s.aal !== "aal2") redirect("/admin/security");
  return s;
}

export class AdminActionError extends Error {}

/** For actions that change something: also refuses read-only administrators, before the database is asked. */
export async function requireAdminWrite(): Promise<AdminSession> {
  const s = await requireAdmin();
  if (s.role === "viewer") throw new AdminActionError("Your administrator role is read-only, so you cannot make changes.");
  return s;
}

export async function requestIp(): Promise<string | null> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null)?.slice(0, 64) ?? null;
}

/** Calls an admin database function as this administrator. The database re-checks who is asking. */
export async function adminRpc<T = unknown>(s: AdminSession, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await s.db.rpc(fn, { p_actor: s.userId, ...args });
  if (error) throw new AdminActionError(adminErrorMessage(error.message));
  return data as T;
}

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Runs a change and turns any failure into a message for the form. Redirects and 404s from the auth checks pass through. */
export async function runAdminAction(fn: () => Promise<string>): Promise<ActionResult> {
  try {
    return { ok: true, message: await fn() };
  } catch (e) {
    if (e instanceof AdminActionError) return { ok: false, error: e.message };
    const digest = (e as { digest?: string })?.digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND")) throw e;
    console.error(JSON.stringify({ evt: "admin_action_failed", err: e instanceof Error ? e.name : "unknown" }));
    return { ok: false, error: "The change could not be made. Nothing was changed." };
  }
}

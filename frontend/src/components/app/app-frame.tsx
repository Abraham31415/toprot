import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppShell } from "./app-shell";

/** Server wrapper for signed-in routes: resolves the profile and renders the shared shell. */
export async function AppFrame({ children }: { children: ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.role) redirect("/onboarding");
  // Unread count for the Notifications badge. A failure here must never break the page, so it falls back to no badge.
  const unread = await Promise.resolve(createAdminClient().rpc("collab_unread_count", { p_actor: profile.id })).then((r) => (typeof r.data === "number" ? r.data : 0)).catch(() => 0);
  return (
    <AppShell fullName={profile.full_name} role={profile.role} unread={unread}>
      {children}
    </AppShell>
  );
}

import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { AppShell } from "./app-shell";

/** Server wrapper for signed-in routes: resolves the profile and renders the shared shell. */
export async function AppFrame({ children }: { children: ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.role) redirect("/onboarding");
  return (
    <AppShell fullName={profile.full_name} role={profile.role}>
      {children}
    </AppShell>
  );
}

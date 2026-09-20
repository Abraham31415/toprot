"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { redirect } from "next/navigation";

export type OnboardingState = { error?: string } | undefined;

export async function chooseRole(
  _prevState: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const role = formData.get("role") as string;
  if (role !== "student" && role !== "supervisor") {
    return { error: "Invalid role." };
  }

  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role) redirect(profile.role === "supervisor" ? "/supervisor" : "/dashboard");

  const supabase = await createClient();

  const { error } = await supabase.from("profiles").update({ role }).eq("id", profile.id);
  if (error) return { error: error.message };

  if (role === "supervisor") {
    const { error: workspaceError } = await supabase
      .from("workspaces")
      .insert({ supervisor_id: profile.id, name: `${profile.full_name || "My"}'s workspace` });
    if (workspaceError) return { error: workspaceError.message };
  }

  redirect(role === "supervisor" ? "/supervisor" : "/dashboard");
}

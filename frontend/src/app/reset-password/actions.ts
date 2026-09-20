"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { redirect } from "next/navigation";

export type ResetPasswordState = { error?: string } | undefined;

export async function updatePassword(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const password = formData.get("password") as string;
  if (!password || password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) return { error: error.message };

  const profile = await getCurrentProfile();
  if (!profile?.role) redirect("/onboarding");
  redirect(profile.role === "supervisor" ? "/supervisor" : "/dashboard");
}

"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { friendlyAuthError } from "@/lib/auth-errors";
import { redirect } from "next/navigation";

export type LoginState = { error?: string } | undefined;

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: friendlyAuthError(error.message) };
  } catch {
    return { error: "We could not reach the server. Check your connection and try again." };
  }

  const profile = await getCurrentProfile();
  if (!profile?.role) redirect("/onboarding");
  redirect(profile.role === "supervisor" ? "/supervisor" : "/dashboard");
}

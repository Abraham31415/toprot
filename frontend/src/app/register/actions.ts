"use server";

import { createClient } from "@/lib/supabase/server";
import { friendlyAuthError } from "@/lib/auth-errors";
import { recordSignupAttribution } from "@/lib/analytics/attribution";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export type RegisterState = { error?: string } | undefined;

export async function registerUser(
  _prevState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const role = formData.get("role") as string;
  const fullName = (formData.get("full_name") as string)?.trim();
  const institution = (formData.get("institution") as string)?.trim() || null;
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  // The stored role values are unchanged: "student" is shown to people as "Researcher".
  if (role !== "student" && role !== "supervisor") {
    return { error: "Choose Researcher or Supervisor." };
  }
  if (!fullName || !email || !password) {
    return { error: "Name, email, and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const origin = (await headers()).get("origin");

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { role, full_name: fullName, institution },
        emailRedirectTo: `${origin}/auth/callback`,
      },
    });

    if (error) return { error: friendlyAuthError(error.message) };

    // With email confirmation on, signing up an address that already has an account returns a user with no identities and no error.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { error: friendlyAuthError("User already registered") };
    }
    if (data.user?.id) await recordSignupAttribution(data.user.id);
  } catch {
    return { error: "We could not reach the server. Check your connection and try again." };
  }

  redirect("/register/check-email");
}

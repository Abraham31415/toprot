"use server";

import { createClient } from "@/lib/supabase/server";
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

  if (role !== "student" && role !== "supervisor") {
    return { error: "Invalid role." };
  }
  if (!fullName || !email || !password) {
    return { error: "Name, email, and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const origin = (await headers()).get("origin");
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { role, full_name: fullName, institution },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/register/check-email");
}

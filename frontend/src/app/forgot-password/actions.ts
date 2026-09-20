"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

export type ForgotPasswordState = { error?: string; sent?: boolean } | undefined;

export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = (formData.get("email") as string)?.trim();
  if (!email) return { error: "Email is required." };

  const origin = (await headers()).get("origin");
  const supabase = await createClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  if (error) return { error: error.message };
  return { sent: true };
}

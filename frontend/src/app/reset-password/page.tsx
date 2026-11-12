import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { ResetPasswordForm } from "./reset-password-form";
import { AuthLayout } from "@/components/auth/auth-layout";

export default async function ResetPasswordPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/forgot-password");

  return (
    <AuthLayout title="Set a new password" subtitle=<>{profile.full_name}, choose a new password for your account.</>>
      <ResetPasswordForm />
    </AuthLayout>
  );
}

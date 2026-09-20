import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/forgot-password");

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Set a new password
        </h1>
        <p className="mt-1 mb-8 text-sm text-zinc-500 dark:text-zinc-400">
          {profile.full_name}, choose a new password for your account.
        </p>
        <ResetPasswordForm />
      </div>
    </div>
  );
}

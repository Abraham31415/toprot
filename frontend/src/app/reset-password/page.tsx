import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { ResetPasswordForm } from "./reset-password-form";
import { PageShell } from "@/components/marketing/ui";

export default async function ResetPasswordPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/forgot-password");

  return (
    <PageShell>
    <div className="flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-navy">
          Set a new password
        </h1>
        <p className="mt-1 mb-8 text-sm text-navy/65">
          {profile.full_name}, choose a new password for your account.
        </p>
        <ResetPasswordForm />
      </div>
    </div>
    </PageShell>
  );
}

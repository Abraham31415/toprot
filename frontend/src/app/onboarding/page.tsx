import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { OnboardingForm } from "./onboarding-form";
import { PageShell } from "@/components/marketing/ui";

export default async function OnboardingPage() {
  const profile = await getCurrentProfile();

  if (!profile) redirect("/login");
  if (profile.role) redirect(profile.role === "supervisor" ? "/supervisor" : "/dashboard");

  return (
    <PageShell>
    <div className="flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-navy">
          Which are you?
        </h1>
        <p className="mt-1 mb-8 text-sm text-navy/65">
          One more step before you start. This can&apos;t be changed later.
        </p>
        <OnboardingForm />
      </div>
    </div>
    </PageShell>
  );
}

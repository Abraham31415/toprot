import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const profile = await getCurrentProfile();

  if (!profile) redirect("/login");
  if (profile.role) redirect(profile.role === "supervisor" ? "/supervisor" : "/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Which are you?
        </h1>
        <p className="mt-1 mb-8 text-sm text-zinc-500 dark:text-zinc-400">
          One more step before you start. This can&apos;t be changed later.
        </p>
        <OnboardingForm />
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { OnboardingForm } from "./onboarding-form";
import { AuthLayout } from "@/components/auth/auth-layout";

export const metadata: Metadata = { title: "Choose your account type", robots: { index: false } };

export default async function OnboardingPage() {
  const profile = await getCurrentProfile();

  if (!profile) redirect("/login");
  if (profile.role) redirect(profile.role === "supervisor" ? "/supervisor" : "/dashboard");

  return (
    <AuthLayout title="One more step" subtitle="Choose how you will use ToProt. This cannot be changed later.">
      <OnboardingForm />
    </AuthLayout>
  );
}

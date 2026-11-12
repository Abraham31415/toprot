import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";
import { AuthLayout } from "@/components/auth/auth-layout";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We will email you a link to set a new one."
      switchLink={{ prompt: "Remembered it?", label: "Log in", href: "/login" }}
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}

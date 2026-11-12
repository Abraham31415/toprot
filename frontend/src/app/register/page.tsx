import type { Metadata } from "next";
import { RegisterForm } from "./register-form";
import { AuthLayout } from "@/components/auth/auth-layout";

export const metadata: Metadata = { title: "Create your account", robots: { index: false } };

export default function RegisterPage() {
  return (
    <AuthLayout
      title="Create your account"
      subtitle="Free to start. No card needed."
      switchLink={{ prompt: "Already have an account?", label: "Log in", href: "/login" }}
    >
      <RegisterForm />
    </AuthLayout>
  );
}

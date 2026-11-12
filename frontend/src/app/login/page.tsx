import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { AuthLayout } from "@/components/auth/auth-layout";
import { FormError, OrDivider } from "@/components/auth/fields";
import { callbackError } from "@/lib/auth-errors";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthLayout
      title="Log in"
      subtitle="Welcome back to ToProt."
      switchLink={{ prompt: "New to ToProt?", label: "Create an account", href: "/register" }}
    >
      <div className="flex flex-col gap-4">
        <FormError>{callbackError(error)}</FormError>
        <GoogleSignInButton />
        <OrDivider />
        <LoginForm />
      </div>
    </AuthLayout>
  );
}

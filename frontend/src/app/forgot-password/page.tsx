import { ForgotPasswordForm } from "./forgot-password-form";
import { AuthLayout } from "@/components/auth/auth-layout";

export default function ForgotPasswordPage() {
  return (
    <AuthLayout title="Reset your password" subtitle=<>We&apos;ll email you a link to set a new one.</>>
      <ForgotPasswordForm />
    </AuthLayout>
  );
}

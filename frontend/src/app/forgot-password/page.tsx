import { ForgotPasswordForm } from "./forgot-password-form";
import { PageShell } from "@/components/marketing/ui";

export default function ForgotPasswordPage() {
  return (
    <PageShell>
    <div className="flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-navy">
          Reset your password
        </h1>
        <p className="mt-1 mb-8 text-sm text-navy/65">
          We&apos;ll email you a link to set a new one.
        </p>
        <ForgotPasswordForm />
      </div>
    </div>
    </PageShell>
  );
}

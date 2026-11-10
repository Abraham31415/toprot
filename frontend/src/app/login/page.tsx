import { LoginForm } from "./login-form";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { PageShell } from "@/components/marketing/ui";

export default function LoginPage() {
  return (
    <PageShell>
    <div className="flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-navy">
          Log in
        </h1>
        <p className="mt-1 mb-8 text-sm text-navy/65">
          Welcome back to ToProt.
        </p>
        <GoogleSignInButton />
        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-navy/10" />
          <span className="text-xs text-navy/55">or</span>
          <div className="h-px flex-1 bg-navy/10" />
        </div>
        <LoginForm />
      </div>
    </div>
    </PageShell>
  );
}

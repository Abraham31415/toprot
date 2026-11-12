import { LoginForm } from "./login-form";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { AuthLayout } from "@/components/auth/auth-layout";

export default function LoginPage() {
  return (
    <AuthLayout title="Log in" subtitle={"Welcome back to ToProt."}>
      <GoogleSignInButton />
        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-navy/10" />
          <span className="text-xs text-ink-muted">or</span>
          <div className="h-px flex-1 bg-navy/10" />
        </div>
        <LoginForm />
    </AuthLayout>
  );
}

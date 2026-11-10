import { RegisterForm } from "./register-form";
import { PageShell } from "@/components/marketing/ui";

export default function RegisterPage() {
  return (
    <PageShell>
    <div className="flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-navy">
          Create your account
        </h1>
        <p className="mt-1 mb-8 text-sm text-navy/65">
          Plan. Run. Prove.
        </p>
        <RegisterForm />
      </div>
    </div>
    </PageShell>
  );
}

import { PageShell } from "@/components/marketing/ui";

export default function CheckEmailPage() {
  return (
    <PageShell>
    <div className="flex items-center justify-center px-6 py-16 text-center">
      <div className="max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-navy">
          Check your email
        </h1>
        <p className="mt-2 text-sm text-navy/65">
          We sent a confirmation link to finish creating your account. Click it to log in.
        </p>
      </div>
    </div>
    </PageShell>
  );
}

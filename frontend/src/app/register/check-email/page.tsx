import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";

export const metadata: Metadata = { title: "Check your email", robots: { index: false } };

export default function CheckEmailPage() {
  return (
    <AuthLayout title="Check your email" subtitle="We sent a confirmation link to finish creating your account." switchLink={{ prompt: "Already confirmed?", label: "Log in", href: "/login" }}>
      <div role="status" className="flex items-start gap-3 rounded-card border border-line bg-surface p-4">
        <MailCheck className="mt-0.5 h-5 w-5 flex-none text-primary" aria-hidden="true" />
        <div className="type-body">
          <p>Open the link in the email, then log in. If it does not arrive within a few minutes, check your spam folder.</p>
          <p className="mt-3">
            Wrong address? <Link href="/register" className="font-medium text-primary hover:underline">Start again</Link>.
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}

"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";
import { FormError, SubmitButton, TextField } from "@/components/auth/fields";

const initialState: ForgotPasswordState = undefined;

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);
  const [email, setEmail] = useState("");

  if (state?.sent) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <p className="flex items-start gap-2 rounded-control border border-success-line bg-success-bg px-3 py-2 text-sm text-success-ink">
          <CircleCheck className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          <span>If an account exists for <span className="font-medium">{email}</span>, we have sent a link to reset your password. Check your inbox.</span>
        </p>
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">Back to log in</Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <TextField label="Email" name="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <FormError>{state?.error}</FormError>
      <SubmitButton pending={pending} pendingLabel="Sending...">Send reset link</SubmitButton>
    </form>
  );
}

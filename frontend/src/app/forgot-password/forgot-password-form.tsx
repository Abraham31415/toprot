"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = undefined;

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);
  const [email, setEmail] = useState("");

  if (state?.sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          If an account exists for <span className="font-medium">{email}</span>, we&apos;ve sent
          a link to reset your password. Check your inbox.
        </p>
        <Link href="/login" className="text-sm font-medium text-ink">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-ink-soft">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-control border border-line-strong bg-surface px-3 py-2 text-ink outline-none focus:border-line-strong"
        />
      </label>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {pending ? "Sending..." : "Send reset link"}
      </button>

      <p className="text-center text-sm text-ink-muted">
        <Link href="/login" className="font-medium text-ink">
          Back to log in
        </Link>
      </p>
    </form>
  );
}

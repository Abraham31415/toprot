"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { EmailOtpType } from "@supabase/supabase-js";

const LABELS: Partial<Record<EmailOtpType, { title: string; button: string; onSuccess: string }>> = {
  recovery: {
    title: "Confirm it's you, then choose a new password.",
    button: "Confirm password reset",
    onSuccess: "/reset-password",
  },
  signup: {
    title: "Confirm your email to finish creating your account.",
    button: "Confirm email",
    onSuccess: "/",
  },
};

export function ConfirmForm({ tokenHash, type }: { tokenHash: string; type: EmailOtpType }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = LABELS[type] ?? { title: "Confirm to continue.", button: "Confirm", onSuccess: "/" };

  async function handleClick() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      setError(error.message);
      setPending(false);
    } else {
      router.push(copy.onSuccess);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{copy.title}</p>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "Confirming..." : copy.button}
      </button>
      {error && (
        <p className="text-sm text-red-600">
          {error} — this link may have already been used or expired.{" "}
          {type === "recovery" ? (
            <>
              Request a new one from the{" "}
              <a href="/forgot-password" className="font-medium underline">
                forgot password
              </a>{" "}
              page.
            </>
          ) : (
            <>
              Try{" "}
              <a href="/register" className="font-medium underline">
                registering
              </a>{" "}
              again.
            </>
          )}
        </p>
      )}
    </div>
  );
}

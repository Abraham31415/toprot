"use client";

import { useActionState } from "react";
import { updatePassword, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = undefined;

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-navy/85">New password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="rounded-lg border border-line bg-white px-3 py-2 text-navy outline-none focus:border-navy/35"
        />
      </label>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-navy py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal disabled:opacity-50"
      >
        {pending ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}

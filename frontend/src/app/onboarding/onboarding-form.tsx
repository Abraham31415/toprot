"use client";

import { useActionState, useState } from "react";
import { chooseRole, type OnboardingState } from "./actions";

const initialState: OnboardingState = undefined;

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(chooseRole, initialState);
  const [role, setRole] = useState<"student" | "supervisor">("student");

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
        {(["student", "supervisor"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors ${
              role === r
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <input type="hidden" name="role" value={role} />

      {role === "student" ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Start your study in minutes.
        </p>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Creates a workspace for reviewing studies students invite you to.
        </p>
      )}

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "Saving..." : `Continue as ${role}`}
      </button>
    </form>
  );
}

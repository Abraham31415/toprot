"use client";

import { useActionState, useState } from "react";
import { chooseRole, type OnboardingState } from "./actions";

const initialState: OnboardingState = undefined;

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(chooseRole, initialState);
  const [role, setRole] = useState<"student" | "supervisor">("student");

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex rounded-lg border border-line p-1">
        {(["student", "supervisor"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors ${
              role === r
                ? "bg-cobalt text-white"
                : "text-navy/65 hover:text-navy"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <input type="hidden" name="role" value={role} />

      {role === "student" ? (
        <p className="text-sm text-navy/65">
          Start your study in minutes.
        </p>
      ) : (
        <p className="text-sm text-navy/65">
          Creates a workspace for reviewing studies students invite you to.
        </p>
      )}

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-cobalt py-2.5 text-sm font-medium text-white transition-colors hover:bg-cobalt-dark disabled:opacity-50"
      >
        {pending ? "Saving..." : `Continue as ${role}`}
      </button>
    </form>
  );
}

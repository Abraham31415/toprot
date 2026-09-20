"use client";

import { useActionState } from "react";
import { createStudy, type CreateStudyState } from "@/app/studies/actions";

const initialState: CreateStudyState = undefined;

export function NewStudyForm() {
  const [state, formAction, pending] = useActionState(createStudy, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex-1">
        <input
          name="title"
          placeholder="Study title, e.g. Incidence of ROP among preterm infants at Mulago"
          required
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
        />
        {state?.error && <p className="mt-1.5 text-sm text-red-600">{state.error}</p>}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "Creating..." : "New study"}
      </button>
    </form>
  );
}

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
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-navy outline-none focus:border-navy/35"
        />
        {state?.error && <p className="mt-1.5 text-sm text-red-600">{state.error}</p>}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-cobalt px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cobalt-dark disabled:opacity-50"
      >
        {pending ? "Creating..." : "New study"}
      </button>
    </form>
  );
}

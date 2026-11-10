"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteSavedCalculation } from "@/app/tools/actions";

export function DeleteCalculationButton({ studyId, id }: { studyId: string; id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Delete saved calculation"
        className="rounded-md p-1.5 text-navy/50 hover:bg-navy/5 hover:text-red-700"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      {error && <span className="text-red-700">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await deleteSavedCalculation(studyId, id);
            if (res.error) setError(res.error);
          })
        }
        className="rounded-md bg-red-700 px-2 py-1 font-medium text-white disabled:opacity-50"
      >
        {pending ? "Deleting..." : "Delete"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-navy/65 hover:text-navy">
        Cancel
      </button>
    </span>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewAmendment } from "@/app/studies/[id]/actions";

export function AmendmentCard({
  amendmentId,
  studyId,
  studyTitle,
  reason,
}: {
  amendmentId: string;
  studyId: string;
  studyTitle: string;
  reason: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function respond(decision: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      const result = await reviewAmendment(amendmentId, studyId, decision);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="font-medium text-zinc-900 dark:text-zinc-100">{studyTitle}</p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{reason}</p>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => respond("approved")}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Acknowledge
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => respond("rejected")}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          Flag concern
        </button>
      </div>
    </div>
  );
}

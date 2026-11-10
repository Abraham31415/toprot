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
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="font-medium text-navy">{studyTitle}</p>
      <p className="mt-1 text-sm text-navy/75">{reason}</p>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => respond("approved")}
          className="rounded-lg bg-cobalt px-3 py-1.5 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50"
        >
          Acknowledge
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => respond("rejected")}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy/75 hover:bg-navy/5 disabled:opacity-50"
        >
          Flag concern
        </button>
      </div>
    </div>
  );
}

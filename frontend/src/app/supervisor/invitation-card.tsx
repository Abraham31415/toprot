"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvitation, declineInvitation } from "@/app/studies/[id]/actions";

export function InvitationCard({
  invitationId,
  studyTitle,
}: {
  invitationId: string;
  studyTitle: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function respond(action: (id: string) => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action(invitationId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-line bg-white p-4">
      <div>
        <p className="font-medium text-navy">{studyTitle}</p>
        <p className="text-sm text-navy/65">Invited you to supervise this study</p>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => respond(acceptInvitation)}
          className="rounded-lg bg-cobalt px-3 py-1.5 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => respond(declineInvitation)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy/75 hover:bg-navy/5 disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

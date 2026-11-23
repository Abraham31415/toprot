"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds";
import { acceptInvite, declineInvite } from "@/app/shared/actions";

export function AcceptForm({ token, invitationId }: { token: string; invitationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-5">
      {error && <p role="alert" className="mb-3 rounded-control border border-danger-line bg-danger-bg p-3 text-sm text-danger-ink">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <Button loading={pending} onClick={() => start(async () => { const r = await acceptInvite({ token }); if (r.error) setError(r.error); else router.push(r.path ?? "/shared"); })}>Accept invitation</Button>
        <Button variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await declineInvite(invitationId); if (r.error) setError(r.error); else router.push("/shared"); })}>Decline</Button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds";
import { ROLE_LABEL, TITLE_TEXT, type MemberRole, type TitleLabel } from "@/lib/collab/roles";
import { acceptInvite, declineInvite } from "./actions";

export type PendingInvitation = { invitation_id: string; study_title: string; role: MemberRole; title_label: TitleLabel | null; invited_by: string | null; expires_at: string };

export function InvitationRow({ inv }: { inv: PendingInvitation }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="font-medium text-ink">{inv.study_title}</p>
        <p className="text-sm text-ink-soft">
          {inv.invited_by ? `${inv.invited_by} invited you` : "Invited"} as {ROLE_LABEL[inv.role].toLowerCase()}{inv.title_label ? ` (${TITLE_TEXT[inv.title_label].toLowerCase()})` : ""}. Expires {new Date(inv.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
        </p>
        {error && <p role="alert" className="mt-1 text-sm text-danger-ink">{error}</p>}
      </div>
      <div className="flex gap-2">
        <Button size="sm" loading={pending} onClick={() => start(async () => { const r = await acceptInvite({ invitationId: inv.invitation_id }); if (r.error) setError(r.error); else router.push(`/studies/${r.studyId}/protocol`); })}>Accept</Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await declineInvite(inv.invitation_id); if (r.error) setError(r.error); else router.refresh(); })}>Decline</Button>
      </div>
    </li>
  );
}

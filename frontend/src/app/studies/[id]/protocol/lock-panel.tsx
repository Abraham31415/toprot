"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProtocolVersionRow } from "@/lib/protocol/types";
import {
  registerProtocolVersion,
  requestSupervisorApproval,
  approveAndLockProtocol,
  createAmendment,
  inviteSupervisor,
} from "../actions";

type SupervisorInfo = { id: string; full_name: string } | null;
type PendingInvitation = { id: string; invited_email: string } | null;
type AmendmentReview = { status: string; reason: string } | null;

const AMENDMENT_STATUS_NOTE: Record<string, string> = {
  proposed: "Waiting for your supervisor to review this amendment.",
  rejected: "Your supervisor flagged a concern with this amendment — check with them before registering.",
};

export function LockPanel({
  studyId,
  version,
  isOwner,
  isAttachedSupervisor,
  supervisor,
  pendingInvitation,
  amendmentReview,
}: {
  studyId: string;
  version: ProtocolVersionRow;
  isOwner: boolean;
  isAttachedSupervisor: boolean;
  supervisor: SupervisorInfo;
  pendingInvitation: PendingInvitation;
  amendmentReview?: AmendmentReview;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amendReason, setAmendReason] = useState("");
  const [showAmendForm, setShowAmendForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");

  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  if (version.status === "registered") {
    return (
      <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-medium text-green-900">
          Registered {version.registration_method === "self" ? "(self-registered)" : "(supervisor-approved)"} on{" "}
          {version.registered_at && new Date(version.registered_at).toLocaleDateString()}
        </p>
        <p className="mt-1 text-sm text-green-800">
          This version is locked and immutable. To change anything, start an amendment.
        </p>
        {isOwner && !showAmendForm && (
          <button
            type="button"
            onClick={() => setShowAmendForm(true)}
            className="mt-3 rounded-lg border border-green-300 bg-white px-3 py-1.5 text-sm font-medium text-green-900 hover:bg-green-100"
          >
            Start amendment
          </button>
        )}
        {isOwner && showAmendForm && (
          <div className="mt-3 flex flex-col gap-2">
            <textarea
              value={amendReason}
              onChange={(e) => setAmendReason(e.target.value)}
              placeholder="Reason for this amendment"
              rows={2}
              className="rounded-lg border border-green-300 bg-white px-3 py-2 text-sm text-navy outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const res = await createAmendment(studyId, version.id, amendReason);
                    return res;
                  })
                }
                className="rounded-lg bg-navy px-3 py-1.5 text-sm font-medium text-white hover:bg-teal disabled:opacity-50"
              >
                {pending ? "Creating..." : "Create amendment"}
              </button>
              <button
                type="button"
                onClick={() => setShowAmendForm(false)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-navy/75"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  // status === 'draft'
  return (
    <div className="mb-6 rounded-xl border border-line bg-white p-4">
      <p className="text-sm font-medium text-navy">
        Draft {version.version_number > 1 ? `(amendment, v${version.version_number})` : ""}
      </p>
      {amendmentReview && AMENDMENT_STATUS_NOTE[amendmentReview.status] && (
        <p
          className={`mt-1 text-sm ${
            amendmentReview.status === "rejected"
              ? "text-amber-700"
              : "text-navy/65"
          }`}
        >
          {AMENDMENT_STATUS_NOTE[amendmentReview.status]}
        </p>
      )}

      {isOwner && (
        <div className="mt-3 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => registerProtocolVersion(version.id, studyId))}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-teal disabled:opacity-50"
            >
              Register this version
            </button>
            <span className="text-xs text-navy/65">
              Timestamps and locks this version.
            </span>
          </div>

          <div className="border-t border-line pt-3">
            <p className="mb-2 text-sm font-medium text-navy/85">Supervisor</p>
            {supervisor && (
              <div className="flex items-center gap-3">
                <p className="text-sm text-navy/75">
                  {supervisor.full_name} is attached to this study.
                </p>
                {version.approval_requested_at ? (
                  <span className="text-sm text-navy/65">
                    Approval requested {new Date(version.approval_requested_at).toLocaleDateString()}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => requestSupervisorApproval(version.id, studyId))}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy/85 hover:bg-navy/5 disabled:opacity-50"
                  >
                    Request approval instead
                  </button>
                )}
              </div>
            )}
            {!supervisor && pendingInvitation && (
              <p className="text-sm text-navy/65">
                Invitation sent to {pendingInvitation.invited_email}, pending.
              </p>
            )}
            {!supervisor && !pendingInvitation && (
              <div className="flex gap-2">
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="supervisor@example.com"
                  className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm text-navy outline-none"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => inviteSupervisor(studyId, inviteEmail))}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy/85 hover:bg-navy/5 disabled:opacity-50"
                >
                  Invite
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {isAttachedSupervisor && version.approval_requested_at && (
        <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
          <p className="text-sm text-navy/75">
            The student requested your approval on{" "}
            {new Date(version.approval_requested_at).toLocaleDateString()}.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => approveAndLockProtocol(version.id, studyId))}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-teal disabled:opacity-50"
          >
            Approve and lock
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

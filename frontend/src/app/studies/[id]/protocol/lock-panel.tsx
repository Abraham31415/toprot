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
      <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
        <p className="text-sm font-medium text-green-900 dark:text-green-300">
          Registered {version.registration_method === "self" ? "(self-registered)" : "(supervisor-approved)"} on{" "}
          {version.registered_at && new Date(version.registered_at).toLocaleDateString()}
        </p>
        <p className="mt-1 text-sm text-green-800 dark:text-green-400">
          This version is locked and immutable. To change anything, start an amendment.
        </p>
        {isOwner && !showAmendForm && (
          <button
            type="button"
            onClick={() => setShowAmendForm(true)}
            className="mt-3 rounded-lg border border-green-300 bg-white px-3 py-1.5 text-sm font-medium text-green-900 hover:bg-green-100 dark:border-green-800 dark:bg-transparent dark:text-green-300 dark:hover:bg-green-950"
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
              className="rounded-lg border border-green-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none dark:border-green-800 dark:bg-zinc-950 dark:text-zinc-100"
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
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {pending ? "Creating..." : "Create amendment"}
              </button>
              <button
                type="button"
                onClick={() => setShowAmendForm(false)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
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
    <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Draft {version.version_number > 1 ? `(amendment, v${version.version_number})` : ""}
      </p>
      {amendmentReview && AMENDMENT_STATUS_NOTE[amendmentReview.status] && (
        <p
          className={`mt-1 text-sm ${
            amendmentReview.status === "rejected"
              ? "text-amber-700 dark:text-amber-400"
              : "text-zinc-500 dark:text-zinc-400"
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
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Register this version
            </button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Timestamps and locks it. No supervisor required.
            </span>
          </div>

          <div className="border-t border-zinc-100 pt-3 dark:border-zinc-900">
            <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Supervisor</p>
            {supervisor && (
              <div className="flex items-center gap-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {supervisor.full_name} is attached to this study.
                </p>
                {version.approval_requested_at ? (
                  <span className="text-sm text-zinc-500 dark:text-zinc-500">
                    Approval requested {new Date(version.approval_requested_at).toLocaleDateString()}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => requestSupervisorApproval(version.id, studyId))}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Request approval instead
                  </button>
                )}
              </div>
            )}
            {!supervisor && pendingInvitation && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Invitation sent to {pendingInvitation.invited_email}, pending.
              </p>
            )}
            {!supervisor && !pendingInvitation && (
              <div className="flex gap-2">
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="supervisor@example.com"
                  className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => inviteSupervisor(studyId, inviteEmail))}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  Invite
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {isAttachedSupervisor && version.approval_requested_at && (
        <div className="mt-3 flex items-center gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            The student requested your approval on{" "}
            {new Date(version.approval_requested_at).toLocaleDateString()}.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => approveAndLockProtocol(version.id, studyId))}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Approve and lock
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

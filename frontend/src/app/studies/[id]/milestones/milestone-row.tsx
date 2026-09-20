"use client";

import { useState, useTransition } from "react";
import { MILESTONE_LABELS, type MilestoneRow as MilestoneRowType, type MilestoneStatus } from "@/lib/protocol/milestones";
import { updateMilestone } from "./actions";

const STATUS_OPTIONS: MilestoneStatus[] = ["pending", "in_progress", "complete"];

const STATUS_STYLES: Record<MilestoneStatus, string> = {
  pending: "text-zinc-400 dark:text-zinc-600",
  in_progress: "text-amber-600 dark:text-amber-400",
  complete: "text-green-600 dark:text-green-400",
};

export function MilestoneRow({
  studyId,
  milestone,
  readOnly,
}: {
  studyId: string;
  milestone: MilestoneRowType;
  readOnly: boolean;
}) {
  const [status, setStatus] = useState<MilestoneStatus>(milestone.status);
  const [targetDate, setTargetDate] = useState(milestone.target_date ?? "");
  const [notes, setNotes] = useState(milestone.notes ?? "");
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateMilestone(studyId, milestone.id, { status, target_date: targetDate, notes });
      if (result.error) setError(result.error);
      else setSavedAt(Date.now());
    });
  }

  return (
    <div className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-200 p-3 sm:grid-cols-[1.3fr_auto_auto_1.5fr_auto] sm:items-center dark:border-zinc-800">
      <p className={`text-sm font-medium ${STATUS_STYLES[status]}`}>{MILESTONE_LABELS[milestone.milestone_type]}</p>
      <select
        value={status}
        disabled={readOnly}
        onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s.replace("_", " ")}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={targetDate}
        disabled={readOnly}
        onChange={(e) => setTargetDate(e.target.value)}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
      />
      <input
        value={notes}
        disabled={readOnly}
        placeholder="Notes"
        onChange={(e) => setNotes(e.target.value)}
        className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
      />
      {!readOnly ? (
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "..." : "Save"}
        </button>
      ) : (
        <span />
      )}
      {error && <p className="col-span-full text-sm text-red-600">{error}</p>}
      {!error && savedAt && <p className="col-span-full text-sm text-green-600">Saved</p>}
    </div>
  );
}

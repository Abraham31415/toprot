"use client";

import { useMemo } from "react";
import {
  SECTION_KEYS,
  SECTION_LABELS,
  runTier1Checks,
  sectionStatus,
  type QualitySnapshot,
  type SectionKey,
  type SectionStatus,
} from "@/lib/protocol/quality";

export function QualityPanel({
  snapshot,
  onNavigate,
}: {
  snapshot: QualitySnapshot;
  onNavigate: (section: SectionKey) => void;
}) {
  const issues = useMemo(() => runTier1Checks(snapshot), [snapshot]);
  const warningCount = issues.length;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Protocol quality</h3>
        {warningCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-400">
            {warningCount} to review
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Structural consistency checks between sections. Updates as you type.
      </p>

      <div className="mt-4 flex flex-col gap-1">
        {SECTION_KEYS.map((key) => {
          const status = sectionStatus(key, snapshot, issues);
          const sectionIssues = issues.filter((i) => i.section === key);
          return (
            <div key={key} className="border-b border-zinc-100 pb-2 last:border-b-0 dark:border-zinc-900">
              <button
                type="button"
                onClick={() => onNavigate(key)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{SECTION_LABELS[key]}</span>
                <StatusBadge status={status} />
              </button>
              {sectionIssues.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1 pl-2">
                  {sectionIssues.map((issue) => (
                    <li key={issue.id}>
                      <button
                        type="button"
                        onClick={() => onNavigate(issue.section)}
                        className="text-left text-xs text-amber-700 hover:underline dark:text-amber-500"
                        title={issue.detail}
                      >
                        {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: SectionStatus }) {
  if (status === "incomplete") {
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        Not yet complete
      </span>
    );
  }
  if (status === "warnings") {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-400">
        Warnings
      </span>
    );
  }
  return (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-400">
      Consistent
    </span>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import {
  SECTION_KEYS,
  SECTION_LABELS,
  runTier1Checks,
  runTier2Checks,
  sectionStatus,
  type QualityIssue,
  type QualitySnapshot,
  type SectionKey,
  type SectionStatus,
} from "@/lib/protocol/quality";
import { runTier3Review } from "@/lib/protocol/tier3";

export function QualityPanel({
  snapshot,
  onNavigate,
}: {
  snapshot: QualitySnapshot;
  onNavigate: (section: SectionKey) => void;
}) {
  const issues = useMemo(
    () => [...runTier1Checks(snapshot), ...runTier2Checks(snapshot)],
    [snapshot],
  );
  const warningCount = issues.length;

  const [considerations, setConsiderations] = useState<QualityIssue[] | null>(null);
  const [tier3Error, setTier3Error] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function requestReview() {
    setTier3Error(null);
    startTransition(async () => {
      const res = await runTier3Review(snapshot, crypto.randomUUID());
      if (res.error) setTier3Error(res.error);
      else setConsiderations(res.issues ?? []);
    });
  }

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy">Protocol quality</h3>
        {warningCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {warningCount} to review
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-navy/65">
        Structural consistency and statistical rules of thumb. Updates as you type.
      </p>

      <div className="mt-4 flex flex-col gap-1">
        {SECTION_KEYS.map((key) => {
          const status = sectionStatus(key, snapshot, issues);
          const sectionIssues = issues.filter((i) => i.section === key);
          return (
            <div key={key} className="border-b border-line pb-2 last:border-b-0">
              <button
                type="button"
                onClick={() => onNavigate(key)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-paper"
              >
                <span className="font-medium text-navy/85">{SECTION_LABELS[key]}</span>
                <StatusBadge status={status} />
              </button>
              {sectionIssues.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1 pl-2">
                  {sectionIssues.map((issue) => (
                    <li key={issue.id}>
                      <button
                        type="button"
                        onClick={() => onNavigate(issue.section)}
                        className="text-left text-xs text-amber-700 hover:underline"
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

      <div className="mt-4 border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-navy/85">Reviewer questions (AI)</p>
          <button
            type="button"
            onClick={requestReview}
            disabled={pending}
            className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-800 hover:bg-purple-100 disabled:opacity-50"
          >
            {pending ? "Thinking..." : considerations ? "Ask again" : "Get reviewer questions"}
          </button>
        </div>
        <p className="mt-1 text-xs text-navy/65">
          Questions a reviewer or committee member might raise, for your own judgement. Not a
          verdict, and not a substitute for your supervisor's read.
        </p>

        {tier3Error && <p className="mt-2 text-xs text-red-600">{tier3Error}</p>}

        {considerations && considerations.length === 0 && !tier3Error && (
          <p className="mt-2 text-xs text-navy/65">
            No specific considerations raised for what's filled in so far.
          </p>
        )}

        {considerations && considerations.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {considerations.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-purple-100 bg-purple-50/60 p-2"
              >
                <button
                  type="button"
                  onClick={() => onNavigate(c.section)}
                  className="text-left text-xs text-purple-900 hover:underline"
                >
                  <span className="mr-1 font-medium">{SECTION_LABELS[c.section]}:</span>
                  {c.message}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: SectionStatus }) {
  if (status === "incomplete") {
    return (
      <span className="rounded-full bg-navy/5 px-2 py-0.5 text-xs font-medium text-navy/65">
        Not yet complete
      </span>
    );
  }
  if (status === "warnings") {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        Warnings
      </span>
    );
  }
  return (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      Consistent
    </span>
  );
}

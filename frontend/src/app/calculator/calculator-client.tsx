"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { SampleSizeInput, SampleSizeResult } from "@/lib/protocol/sample-size";
import { SampleSizeForm } from "@/components/sample-size-form";
import { calculateStandalone, saveSampleSizeToStudy } from "./actions";

type Study = { id: string; title: string };

export function CalculatorClient({
  isSignedIn,
  studies,
}: {
  isSignedIn: boolean;
  studies: Study[];
}) {
  return (
    <SampleSizeForm
      runCalculation={calculateStandalone}
      footer={(result, input) => (
        <SaveToStudyPanel isSignedIn={isSignedIn} studies={studies} result={result} input={input} />
      )}
    />
  );
}

function SaveToStudyPanel({
  isSignedIn,
  studies,
  result,
  input,
}: {
  isSignedIn: boolean;
  studies: Study[];
  result: SampleSizeResult;
  input: SampleSizeInput;
}) {
  const [selectedStudy, setSelectedStudy] = useState(studies[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSignedIn) {
    return (
      <div className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        Want to keep this? <Link href="/register" className="font-medium text-zinc-900 underline dark:text-zinc-100">Create a free account</Link>{" "}
        to save it to a study, or{" "}
        <Link href="/login" className="font-medium text-zinc-900 underline dark:text-zinc-100">log in</Link> if you already have one.
      </div>
    );
  }

  if (!studies.length) {
    return (
      <div className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        You don't have a study to save this into yet.{" "}
        <Link href="/dashboard" className="font-medium text-zinc-900 underline dark:text-zinc-100">Start one</Link>, then come back.
      </div>
    );
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await saveSampleSizeToStudy(selectedStudy, input, result);
      if (res.error) setError(res.error);
      else setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Save to a study</p>
      <div className="flex gap-2">
        <select
          value={selectedStudy}
          onChange={(e) => setSelectedStudy(e.target.value)}
          className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
        >
          {studies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
      {saved && <p className="text-sm text-green-600">Saved to Section 6 of that study's protocol.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

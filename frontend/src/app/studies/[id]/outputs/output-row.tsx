"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OUTPUT_LABELS, IMPLEMENTED_OUTPUTS, type OutputType } from "@/lib/protocol/outputs";
import { generateOutput, getDownloadUrl } from "./actions";

type ExistingOutput = {
  id: string;
  output_type: string;
  file_path: string;
  file_format: string;
  generated_at: string;
} | null;

export function OutputRow({
  outputType,
  studyId,
  versionId,
  existing,
  canGenerate,
}: {
  outputType: OutputType;
  studyId: string;
  versionId: string;
  existing: ExistingOutput;
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const implemented = IMPLEMENTED_OUTPUTS.includes(outputType);

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await generateOutput(studyId, versionId, outputType);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function download() {
    if (!existing) return;
    setError(null);
    startTransition(async () => {
      const result = await getDownloadUrl(existing.file_path);
      if (result.error) setError(result.error);
      else if (result.url) window.open(result.url, "_blank");
    });
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div>
        <p className="font-medium text-zinc-900 dark:text-zinc-100">{OUTPUT_LABELS[outputType]}</p>
        {!implemented && (
          <p className="text-sm text-zinc-400 dark:text-zinc-600">Coming in a later checkpoint</p>
        )}
        {implemented && existing && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Generated {new Date(existing.generated_at).toLocaleString()}
          </p>
        )}
        {implemented && !existing && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Not generated yet</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {implemented && (
        <div className="flex gap-2">
          {existing && (
            <button
              type="button"
              disabled={pending}
              onClick={download}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Download
            </button>
          )}
          {canGenerate && (
            <button
              type="button"
              disabled={pending}
              onClick={generate}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? "Working..." : existing ? "Regenerate" : "Generate"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

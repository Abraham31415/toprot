"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OUTPUT_INFO, OUTPUT_LABELS, IMPLEMENTED_OUTPUTS, type OutputType } from "@/lib/protocol/outputs";
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4">
      <div>
        <p className="font-medium text-navy">
          {OUTPUT_LABELS[outputType]}
          <span className="ml-2 rounded-full bg-navy/5 px-2 py-0.5 text-xs font-normal text-navy/75">
            {OUTPUT_INFO[outputType].format}
          </span>
        </p>
        <p className="mt-0.5 max-w-md text-sm text-navy/75">{OUTPUT_INFO[outputType].description}</p>
        {!implemented && (
          <p className="text-sm text-navy/55">Coming in a later checkpoint</p>
        )}
        {implemented && existing && (
          <p className="text-sm text-navy/65">
            Generated {new Date(existing.generated_at).toLocaleString()}
          </p>
        )}
        {implemented && !existing && (
          <p className="text-sm text-navy/65">Not generated yet</p>
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
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy/85 hover:bg-navy/5 disabled:opacity-50"
            >
              Download
            </button>
          )}
          {canGenerate && (
            <button
              type="button"
              disabled={pending}
              onClick={generate}
              className="rounded-lg bg-cobalt px-3 py-1.5 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50"
            >
              {pending ? "Working..." : existing ? "Regenerate" : "Generate"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

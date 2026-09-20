"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadFinalAnalysis, generateDeviationReport, getReportDownloadUrl } from "./actions";

type PastReport = { id: string; generated_at: string; export_docx_path: string | null };

export function ReportPanel({
  studyId,
  hasRegisteredProtocol,
  initialUploadedFileName,
  initialUploadedPath,
  pastReports,
}: {
  studyId: string;
  hasRegisteredProtocol: boolean;
  initialUploadedFileName: string | null;
  initialUploadedPath: string | null;
  pastReports: PastReport[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedPath, setUploadedPath] = useState(initialUploadedPath);
  const [uploadedFileName, setUploadedFileName] = useState(initialUploadedFileName);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function upload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadFinalAnalysis(studyId, formData);
      if (result.error) {
        setError(result.error);
      } else {
        setUploadedPath(`${studyId}/final-analysis/${file.name}`);
        setUploadedFileName(file.name);
        router.refresh();
      }
    });
  }

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await generateDeviationReport(studyId, uploadedPath);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function download(path: string) {
    setError(null);
    startTransition(async () => {
      const result = await getReportDownloadUrl(path);
      if (result.error) setError(result.error);
      else if (result.url) window.open(result.url, "_blank");
    });
  }

  if (!hasRegisteredProtocol) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        This study has no registered protocol yet. Register a version before generating an
        end-of-study deviation report — there's nothing to compare against otherwise.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          1. Upload your final analysis output
        </p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {uploadedFileName ? `Uploaded: ${uploadedFileName}` : "No file uploaded yet."}
        </p>
        <div className="mt-3 flex gap-2">
          <input ref={fileInputRef} type="file" className="text-sm text-zinc-700 dark:text-zinc-300" />
          <button
            type="button"
            disabled={pending}
            onClick={upload}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Upload
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          2. Generate the deviation report
        </p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Compiles logged deviations, protocol amendments, and planned-vs-actual sample size
          against the registered protocol into a downloadable Word document.
        </p>
        <button
          type="button"
          disabled={pending || !uploadedPath}
          onClick={generate}
          className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Working..." : "Generate report"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Past reports</p>
        {!pastReports.length ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">None generated yet.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {pastReports.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {new Date(r.generated_at).toLocaleString()}
                </span>
                {r.export_docx_path && (
                  <button
                    type="button"
                    onClick={() => download(r.export_docx_path!)}
                    className="rounded-lg border border-zinc-200 px-3 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Download
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

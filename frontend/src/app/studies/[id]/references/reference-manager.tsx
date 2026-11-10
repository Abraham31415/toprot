"use client";

import { useState, useTransition } from "react";
import {
  formatVancouver,
  referencesToRIS,
  referencesToBibTeX,
  type StudyReference,
  type ReferenceMetadata,
} from "@/lib/protocol/references";
import { lookupReference, addReference, deleteReference } from "./actions";

function toMetadata(ref: StudyReference): ReferenceMetadata {
  return {
    identifier_type: ref.identifier_type,
    doi: ref.doi,
    pmid: ref.pmid,
    authors: ref.authors,
    title: ref.title,
    journal: ref.journal,
    year: ref.year,
    volume: ref.volume,
    issue: ref.issue,
    pages: ref.pages,
  };
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReferenceManager({
  studyId,
  initialReferences,
  readOnly,
}: {
  studyId: string;
  initialReferences: StudyReference[];
  readOnly: boolean;
}) {
  const [references, setReferences] = useState(initialReferences);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ReferenceMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  function handleLookup() {
    setError(null);
    setNotFound(false);
    setPreview(null);
    startTransition(async () => {
      const result = await lookupReference(query);
      if (!result.found) {
        setNotFound(true);
        if (result.error) setError(result.error);
        return;
      }
      setPreview(result.metadata);
    });
  }

  function handleAdd() {
    if (!preview) return;
    startTransition(async () => {
      const result = await addReference(studyId, preview);
      if (result.error) {
        setError(result.error);
        return;
      }
      setReferences((prev) => [
        ...prev,
        {
          id: `pending-${Date.now()}`,
          study_id: studyId,
          display_order: prev.length,
          ...preview,
        },
      ]);
      setPreview(null);
      setQuery("");
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteReference(studyId, id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setReferences((prev) => prev.filter((r) => r.id !== id));
    });
  }

  const metadataList = references.map(toMetadata);

  return (
    <div className="flex flex-col gap-6">
      {!readOnly && (
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-sm font-medium text-navy/85">Add a reference</p>
          <p className="mt-1 text-xs text-navy/65">
            Enter a DOI, a PubMed ID, or a title. We'll pull the details from CrossRef or PubMed
            &mdash; never generated.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. 10.1001/jama.2020.1585, 32167524, or a title"
              className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm text-navy outline-none focus:border-navy/35"
            />
            <button
              type="button"
              onClick={handleLookup}
              disabled={pending || !query.trim()}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal disabled:opacity-50"
            >
              {pending ? "Looking up..." : "Look up"}
            </button>
          </div>

          {notFound && (
            <p className="mt-3 text-sm text-amber-700">
              Not found. Double-check the DOI/PMID, or try the exact article title.
            </p>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          {preview && (
            <div className="mt-3 rounded-lg border border-line p-3">
              <p className="text-sm text-navy/85">{formatVancouver(preview, references.length + 1)}</p>
              <button
                type="button"
                onClick={handleAdd}
                disabled={pending}
                className="mt-2 rounded-lg bg-navy px-3 py-1.5 text-sm font-medium text-white hover:bg-teal disabled:opacity-50"
              >
                Add to references
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {!references.length && (
          <p className="text-sm text-navy/65">No references yet.</p>
        )}
        {references.map((ref, i) => (
          <div
            key={ref.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-line bg-white p-3"
          >
            <p className="text-sm text-navy/85">{formatVancouver(toMetadata(ref), i + 1)}</p>
            {!readOnly && (
              <button
                type="button"
                onClick={() => handleDelete(ref.id)}
                disabled={pending}
                className="shrink-0 rounded-lg border border-line px-2.5 text-navy/65 hover:bg-navy/5 disabled:opacity-50"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {references.length > 0 && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => download("references.ris", referencesToRIS(metadataList))}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy/85 hover:bg-navy/5"
          >
            Export RIS
          </button>
          <button
            type="button"
            onClick={() => download("references.bib", referencesToBibTeX(metadataList))}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy/85 hover:bg-navy/5"
          >
            Export BibTeX
          </button>
        </div>
      )}
    </div>
  );
}

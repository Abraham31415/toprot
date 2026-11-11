"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteManuscript } from "./actions";

export function DeleteManuscriptButton({ studyId, id, title }: { studyId: string; id: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="shrink-0">
      <button
        type="button"
        disabled={pending}
        aria-label={`Delete ${title}`}
        onClick={() => {
          if (!window.confirm(`Delete "${title}", its figures and its whole version history? This cannot be undone.`)) return;
          start(async () => { const r = await deleteManuscript(studyId, id); if (r.error) setError(r.error); else router.refresh(); });
        }}
        className="rounded p-2 text-navy/50 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
      {error && <span role="alert" className="ml-1 text-xs text-red-700">{error}</span>}
    </span>
  );
}

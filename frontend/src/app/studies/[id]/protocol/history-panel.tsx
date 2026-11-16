"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { Button } from "@/components/ds";
import { restoreProtocolSnapshot, saveProtocolSnapshot } from "../history-actions";

export type SnapshotRow = { id: string; kind: "auto" | "manual" | "restore"; label: string | null; created_at: string; author: string | null };
const KIND = { auto: "Automatic", manual: "Saved by hand", restore: "Before a restore" } as const;

export function HistoryPanel({ studyId, versionId, snapshots, canEdit }: { studyId: string; versionId: string; snapshots: SnapshotRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [note, setNote] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ error?: string; message?: string }>) => start(async () => { const r = await fn(); setNote(r); if (!r.error) router.refresh(); });
  return (
    <details className="mb-6 rounded-xl border border-line bg-white p-4">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-navy"><History className="h-4 w-4" aria-hidden="true" />Version history ({snapshots.length})</summary>
      <p className="mt-2 text-sm text-navy/65">ToProt keeps a snapshot of the text before changes, at most one every ten minutes. Restoring a snapshot first saves the current text, so a restore can be undone. Objectives and variables are not part of snapshots.</p>
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="snap-label">Name for this snapshot</label>
          <input id="snap-label" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="Name this snapshot (optional)" className="min-h-10 w-72 rounded-control border border-line-strong bg-surface px-3 text-sm" />
          <Button size="sm" variant="secondary" loading={pending} onClick={() => act(async () => { const r = await saveProtocolSnapshot(studyId, versionId, label); if (!r.error) setLabel(""); return r; })}>Save snapshot now</Button>
        </div>
      )}
      <div role="status" aria-live="polite" className="mt-2 text-sm empty:hidden">{note?.error ? <span className="text-red-600">{note.error}</span> : note?.message}</div>
      {snapshots.length === 0 ? <p className="mt-3 text-sm text-navy/65">No snapshots yet. The first appears after the first edit.</p> : (
        <ul className="mt-3 divide-y divide-line">
          {snapshots.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span><strong className="font-medium text-navy">{s.label ?? KIND[s.kind]}</strong> <span className="text-navy/65">{new Date(s.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{s.author ? `, ${s.author}` : ""}</span></span>
              {canEdit && <Button size="sm" variant="secondary" disabled={pending} onClick={() => { if (confirm("Restore this snapshot? Your current text is saved first.")) act(() => restoreProtocolSnapshot(studyId, s.id)); }}>Restore</Button>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

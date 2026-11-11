"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Doc } from "@/lib/writing/doc";
import type { CslItem } from "@/lib/refs/convert";
import type { LoadedStyle } from "@/lib/csl/client";
import { formatManuscript } from "@/lib/writing/format";
import { renderBody } from "@/lib/writing/html";
import { getVersion, listVersions, restoreVersion, type VersionRow } from "@/app/studies/[id]/writing/actions";
import { signedFigureUrls } from "./figure-url";

const KIND: Record<VersionRow["kind"], string> = { auto: "Automatic", manual: "Saved version", restore: "Before a restore" };

export function HistoryPanel({ studyId, manuscriptId, readOnly, items, style, getRevision, flush, onRestored, onClose }: {
  studyId: string; manuscriptId: string; readOnly: boolean; items: CslItem[]; style: LoadedStyle | null;
  getRevision: () => number; flush: () => Promise<boolean>;
  onRestored: (r: { revision: number; title: string; content: Doc }) => void; onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<VersionRow | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await listVersions(manuscriptId);
    if ("error" in r) setError(r.error); else setVersions(r.versions);
  }, [manuscriptId]);
  useEffect(() => { load(); }, [load]);

  const open = async (v: VersionRow) => {
    setSelected(v); setPreview(null); setError(null);
    const r = await getVersion(v.id);
    if ("error" in r) { setError(r.error); return; }
    let fmt = null;
    try { fmt = style ? formatManuscript(r.content, items, style) : null; } catch { fmt = null; }
    const paths: string[] = [];
    const find = (n: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }) => { if (n.type === "figure") paths.push(String(n.attrs?.path)); (n.content as (typeof n)[] | undefined)?.forEach(find); };
    find(r.content as never);
    const figureUrls = await signedFigureUrls(paths);
    setPreview(renderBody(r.content, fmt, { title: r.title, figureUrls }));
  };

  const restore = async () => {
    if (!selected) return;
    if (!window.confirm("Restore this version? Your current text is kept as a restore point, so you can undo this.")) return;
    setBusy(true); setError(null);
    if (!(await flush())) { setBusy(false); setError("Your latest changes could not be saved first, so nothing was restored."); return; }
    const r = await restoreVersion(studyId, selected.id, getRevision());
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onRestored({ revision: r.revision, title: r.title, content: r.content });
    setSelected(null); setPreview(null);
    load();
  };

  return (
    <section aria-label="Version history" className="rounded-md border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold text-navy">Version history</h2>
        <button type="button" onClick={onClose} aria-label="Close version history" className="rounded p-1 text-navy/70 hover:bg-soft"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      {error && <p role="alert" className="px-3 pt-2 text-sm text-red-700">{error}</p>}
      <div className="grid gap-0 md:grid-cols-[16rem_1fr]">
        <ul className="max-h-96 overflow-y-auto border-b border-line md:border-b-0 md:border-r" aria-label="Saved versions">
          {versions === null && <li className="p-3 text-sm text-navy/60">Loading...</li>}
          {versions?.length === 0 && <li className="p-3 text-sm text-navy/60">No versions yet. One is saved automatically as you write, at most every 10 minutes.</li>}
          {versions?.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => open(v)} aria-current={selected?.id === v.id} className={`block w-full px-3 py-2 text-left text-sm hover:bg-soft/50 ${selected?.id === v.id ? "bg-soft" : ""}`}>
                <span className="block font-medium text-navy">{v.label ?? KIND[v.kind]}</span>
                <span className="block text-xs text-navy/60">{new Date(v.created_at).toLocaleString()} · {v.word_count.toLocaleString()} words</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 p-3">
          {!selected && <p className="text-sm text-navy/60">Select a version to preview it.</p>}
          {selected && (
            <>
              {!readOnly && <button type="button" disabled={busy || !preview} onClick={restore} className="mb-3 rounded-md bg-cobalt px-3 py-1.5 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50">{busy ? "Restoring..." : "Restore this version"}</button>}
              {preview === null ? <p className="text-sm text-navy/60">Loading preview...</p> : <div className="manuscript-body max-h-80 overflow-y-auto rounded border border-line p-3 text-sm" dangerouslySetInnerHTML={{ __html: preview }} />}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CitationRef } from "@/lib/writing/doc";

export type PickRef = { id: string; title: string; authorsText: string; year: number | null };

const field = "w-full min-w-0 rounded-md border border-navy/25 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20";

/** Choose one or more of the study's own references to cite, with an optional page. Uses the native dialog for focus handling and Esc. */
export function CitationDialog({ refs, initial, studyId, onSubmit, onRemove, onClose }: {
  refs: PickRef[]; initial: CitationRef[]; studyId: string;
  onSubmit: (items: CitationRef[]) => void; onRemove?: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<CitationRef[]>(initial);

  useEffect(() => { ref.current?.showModal(); }, []);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? refs.filter((r) => `${r.title} ${r.authorsText} ${r.year ?? ""}`.toLowerCase().includes(n)) : refs;
  }, [refs, q]);
  const byId = new Map(refs.map((r) => [r.id, r]));
  const toggle = (id: string) => setChosen((c) => (c.some((x) => x.id === id) ? c.filter((x) => x.id !== id) : [...c, { id }]));
  const setLocator = (id: string, locator: string) => setChosen((c) => c.map((x) => (x.id === id ? (locator ? { id, locator } : { id }) : x)));

  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} aria-labelledby="cite-title" className="w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-line p-0 shadow-xl backdrop:bg-navy/40">
      <div className="p-4">
        <h2 id="cite-title" className="text-base font-semibold text-navy">{initial.length ? "Edit citation" : "Insert citation"}</h2>
        {refs.length === 0 ? (
          <p className="mt-3 text-sm text-navy/70">
            This study has no references yet. Add some from the <Link className="text-cobalt underline" href={`/studies/${studyId}/references`}>References tab</Link>, or find papers in the <Link className="text-cobalt underline" href="/literature">Literature Explorer</Link>. Citations only use references you have saved.
          </p>
        ) : (
          <>
            <label htmlFor="cite-q" className="mt-3 block text-xs font-medium text-navy">Search your references</label>
            <input id="cite-q" className={`${field} mt-1`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, author or year" autoFocus />
            <ul className="mt-2 max-h-64 overflow-y-auto rounded-md border border-line" aria-label="References">
              {shown.length === 0 && <li className="p-3 text-sm text-navy/60">No matches.</li>}
              {shown.map((r) => {
                const on = chosen.some((c) => c.id === r.id);
                return (
                  <li key={r.id} className="border-b border-line last:border-b-0">
                    <label className={`flex cursor-pointer items-start gap-2 p-2 text-sm hover:bg-soft/40 ${on ? "bg-soft/60" : ""}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(r.id)} className="mt-1" />
                      <span className="min-w-0"><span className="block font-medium text-navy">{r.title}</span><span className="block text-xs text-navy/65">{r.authorsText || "No authors"}{r.year ? ` (${r.year})` : ""}</span></span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {chosen.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-navy">Selected ({chosen.length}). Add a page if you are citing a specific part.</p>
                <ul className="mt-1 space-y-1">
                  {chosen.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-navy">{byId.get(c.id)?.title ?? "Reference no longer in library"}</span>
                      <label className="sr-only" htmlFor={`loc-${c.id}`}>Page for {byId.get(c.id)?.title}</label>
                      <input id={`loc-${c.id}`} className="w-24 rounded border border-navy/25 px-2 py-1 text-xs" placeholder="Page, e.g. 12" maxLength={60} value={c.locator ?? ""} onChange={(e) => setLocator(c.id, e.target.value)} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div>{onRemove && <button type="button" onClick={onRemove} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Remove citation</button>}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-navy/25 px-3 py-1.5 text-sm text-navy hover:border-cobalt">Cancel</button>
            <button type="button" disabled={!chosen.length} onClick={() => onSubmit(chosen)} className="rounded-md bg-cobalt px-4 py-1.5 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50">{initial.length ? "Update" : "Insert"}</button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

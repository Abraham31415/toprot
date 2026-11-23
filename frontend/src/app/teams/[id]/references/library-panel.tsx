"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds";
import type { LibraryItem } from "@/lib/collab/teams";
import { linkReference, listProjectReferencesForSharing, shareReference, unshareReference, type TeamResult } from "@/app/teams/actions";

const sel = "min-h-10 rounded-control border border-line-strong bg-surface px-3 text-sm";

export function LibraryPanel({ teamId, userId, isAdmin, library, projects }: { teamId: string; userId: string; isAdmin: boolean; library: LibraryItem[]; projects: { id: string; title: string }[] }) {
  const router = useRouter();
  const ids = { src: useId(), ref: useId() };
  const [src, setSrc] = useState("");
  const [refs, setRefs] = useState<{ id: string; title: string; year: number | null }[]>([]);
  const [ref, setRef] = useState("");
  const [target, setTarget] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<TeamResult | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<TeamResult>) => start(async () => { const r = await fn(); setNotice(r); if (!r.error) router.refresh(); });

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-ink-soft">A shared reference is linked, not copied: the team sees the one original. Your private notes, tags and collections are never shared. Linked references appear read-only in a project&apos;s References page and can be cited in its manuscripts.</p>
      <div role="status" aria-live="polite" className="empty:hidden">{notice?.error ? <p className="rounded-control border border-danger-line bg-danger-bg p-3 text-sm text-danger-ink">{notice.error}</p> : notice?.message ? <p className="rounded-control border border-line bg-surface-soft p-3 text-sm">{notice.message}</p> : null}</div>

      <section className="rounded-card border border-line bg-surface p-4" aria-labelledby="share-h">
        <h2 id="share-h" className="text-base font-semibold text-ink">Share a reference with the team</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div><label htmlFor={ids.src} className="mb-1 block text-sm font-medium">From project</label>
            <select id={ids.src} value={src} className={sel} onChange={(e) => { const v = e.target.value; setSrc(v); setRef(""); setRefs([]); if (v) start(async () => { const r = await listProjectReferencesForSharing(teamId, v); if (r.error) setNotice({ error: r.error }); else setRefs(r.refs ?? []); }); }}>
              <option value="">Choose a project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
          <div><label htmlFor={ids.ref} className="mb-1 block text-sm font-medium">Reference</label>
            <select id={ids.ref} value={ref} disabled={!refs.length} className={`${sel} max-w-xs`} onChange={(e) => setRef(e.target.value)}><option value="">{refs.length ? "Choose a reference" : "No references"}</option>{refs.map((r) => <option key={r.id} value={r.id}>{r.title.slice(0, 80)}{r.year ? ` (${r.year})` : ""}</option>)}</select></div>
          <Button loading={pending} disabled={!ref} onClick={() => act(() => shareReference(teamId, ref))}>Share</Button>
        </div>
      </section>

      <section aria-labelledby="lib-h">
        <h2 id="lib-h" className="type-eyebrow mb-2">Team library ({library.length})</h2>
        {library.length === 0 ? <p className="text-sm text-ink-soft">Nothing shared yet.</p> : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {library.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 p-4">
                <div><p className="text-sm font-medium text-ink">{r.title}</p>
                  <p className="text-xs text-ink-soft">{(r.authors ?? []).slice(0, 3).join(", ")}{(r.authors?.length ?? 0) > 3 ? " et al." : ""} {r.journal ? `${r.journal}. ` : ""}{r.year ?? ""}{r.doi ? ` DOI ${r.doi}` : ""}. Shared by {r.shared_by ?? "a former member"}. Linked in {r.linked_projects} project{r.linked_projects === 1 ? "" : "s"}.</p></div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`t-${r.id}`}>Project to add {r.title} to</label>
                  <select id={`t-${r.id}`} className={sel} value={target[r.id] ?? ""} onChange={(e) => setTarget({ ...target, [r.id]: e.target.value })}><option value="">Add to project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
                  <Button size="sm" variant="secondary" disabled={pending || !target[r.id]} onClick={() => act(() => linkReference(teamId, target[r.id], r.id))}>Add</Button>
                  {(isAdmin || r.shared_by_id === userId) && <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => unshareReference(teamId, r.id))}>Stop sharing</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

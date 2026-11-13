"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds";
import { unlinkReference } from "@/app/teams/actions";

export type LinkedRef = { link_id: string; title: string; authors: string[] | null; journal: string | null; year: number | null; doi: string | null };

/** References a team shared into this project. They are links to the originals, so they are read-only here. */
export function LinkedReferences({ studyId, refs, canEdit }: { studyId: string; refs: LinkedRef[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!refs.length) return null;
  return (
    <section aria-labelledby="linked-h" className="mt-8">
      <h2 id="linked-h" className="text-base font-semibold text-navy">From the team library ({refs.length})</h2>
      <p className="mt-1 text-sm text-navy/65">Linked from the team, not copied. You can cite them in manuscripts. Their owner edits them.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">
        {refs.map((r) => (
          <li key={r.link_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div><p className="text-sm font-medium text-navy">{r.title}</p><p className="text-xs text-navy/65">{(r.authors ?? []).slice(0, 3).join(", ")} {r.journal ?? ""} {r.year ?? ""}{r.doi ? ` DOI ${r.doi}` : ""}</p></div>
            {canEdit && <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { const x = await unlinkReference(studyId, r.link_id); if (x.error) setError(x.error); else router.refresh(); })}>Remove from project</Button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

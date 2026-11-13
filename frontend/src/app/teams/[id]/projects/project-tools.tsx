"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds";
import { addMemberToProject, createTeamProject, transferProject, type TeamResult } from "@/app/teams/actions";

const field = "min-h-10 rounded-control border border-line-strong bg-surface px-3 text-sm";

export function NewTeamProject({ teamId }: { teamId: string }) {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="rounded-card border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await createTeamProject(teamId, title); if (r.error) setError(r.error); else router.push(`/studies/${r.studyId}/protocol`); }); }}>
      <label htmlFor={id} className="block text-sm font-medium">New team project</label>
      <div className="mt-1 flex flex-wrap gap-2">
        <input id={id} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={`${field} w-full sm:w-96`} placeholder="Project title" />
        <Button type="submit" loading={pending} disabled={!title.trim()}>Create</Button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger-ink">{error}</p>}
    </form>
  );
}

export function ProjectPeople({ teamId, studyId, isProjectOwner, candidates }: { teamId: string; studyId: string; isProjectOwner: boolean; candidates: { id: string; name: string; seat: "paid" | "guest" }[] }) {
  const router = useRouter();
  const ids = { who: useId(), role: useId() };
  const [who, setWho] = useState("");
  const [role, setRole] = useState("editor");
  const [notice, setNotice] = useState<TeamResult | null>(null);
  const [pending, start] = useTransition();
  const picked = candidates.find((c) => c.id === who);
  const effectiveRole = picked?.seat === "guest" ? "reviewer" : role;
  const act = (fn: () => Promise<TeamResult>) => start(async () => { const r = await fn(); setNotice(r); if (!r.error) router.refresh(); });
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink">Manage who can open this project</summary>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div><label htmlFor={ids.who} className="mb-1 block text-xs font-medium">Team member</label>
          <select id={ids.who} value={who} onChange={(e) => setWho(e.target.value)} className={field}><option value="">Choose</option>{candidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.seat === "guest" ? " (guest)" : ""}</option>)}</select></div>
        <div><label htmlFor={ids.role} className="mb-1 block text-xs font-medium">Role</label>
          <select id={ids.role} value={effectiveRole} disabled={picked?.seat === "guest"} onChange={(e) => setRole(e.target.value)} className={field}><option value="editor">Editor</option><option value="reviewer">Reviewer</option><option value="viewer">Viewer</option></select></div>
        {isProjectOwner && <Button size="sm" loading={pending} disabled={!who} onClick={() => act(() => addMemberToProject(teamId, studyId, who, effectiveRole))}>Add to project</Button>}
        {isProjectOwner && <Button size="sm" variant="secondary" loading={pending} disabled={!who || picked?.seat === "guest"} onClick={() => { if (confirm("Transfer this project? You will lose access unless the new owner adds you.")) act(() => transferProject(teamId, studyId, who)); }}>Transfer ownership</Button>}
      </div>
      {!isProjectOwner && <p className="mt-2 text-xs text-ink-soft">Only the project owner can add people. As team owner you can transfer a project to another member.</p>}
      {!isProjectOwner && <div className="mt-2"><Button size="sm" variant="secondary" loading={pending} disabled={!who || picked?.seat === "guest"} onClick={() => { if (confirm("Transfer this project to the selected member?")) act(() => transferProject(teamId, studyId, who)); }}>Transfer to selected member</Button></div>}
      <div role="status" aria-live="polite" className="mt-2 empty:hidden">{notice?.error ? <p className="text-danger-ink">{notice.error}</p> : notice?.message ? <p className="text-ink-soft">{notice.message}</p> : null}</div>
    </details>
  );
}

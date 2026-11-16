"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds";
import { createTeamAction } from "./actions";

export function CreateTeamForm() {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="rounded-card border border-line bg-surface p-5" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await createTeamAction(name); if (r.error) setError(r.error); else router.push(`/teams/${r.teamId}`); }); }}>
      <h2 className="text-base font-semibold text-ink">Create a team</h2>
      <label htmlFor={id} className="mt-3 block text-sm font-medium">Team name</label>
      <input id={id} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="mt-1 min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-sm sm:max-w-sm" placeholder="Neonatal Research Group" />
      {error && <p role="alert" className="mt-2 text-sm text-danger-ink">{error}</p>}
      <div className="mt-3"><Button type="submit" loading={pending} disabled={name.trim().length < 2}>Create team</Button></div>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ds";
import { savePreferences } from "./actions";

const ROWS = [
  { key: "review", label: "Reviews", help: "Review requests, decisions and approvals." },
  { key: "comment", label: "Comments", help: "New comments on your projects." },
  { key: "team", label: "Teams", help: "Team membership and project access changes." },
];

export function PreferencesForm({ prefs, emailReady }: { prefs: Record<string, boolean>; emailReady: boolean }) {
  const [v, setV] = useState(prefs);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="mt-8 rounded-card border border-line bg-surface p-5" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await savePreferences(v); setNote(r.error ?? "Saved."); }); }}>
      <h2 className="text-base font-semibold text-ink">What you are notified about</h2>
      <p className="mt-1 text-sm text-ink-soft">Invitations are always emailed. {emailReady ? "" : "Email sending is not set up on this server yet, so email choices take effect once it is."}</p>
      <table className="mt-3 w-full text-sm">
        <thead><tr className="text-left text-ink-soft"><th scope="col" className="py-1 font-medium">Category</th><th scope="col" className="py-1 font-medium">In the app</th><th scope="col" className="py-1 font-medium">By email</th></tr></thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key} className="border-t border-line">
              <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">{r.label}<span className="block text-xs font-normal text-ink-soft">{r.help}</span></th>
              {(["inapp", "email"] as const).map((k) => (
                <td key={k} className="py-2"><input type="checkbox" className="h-4 w-4" aria-label={`${r.label} ${k === "inapp" ? "in the app" : "by email"}`} checked={!!v[`${r.key}_${k}`]} onChange={(e) => setV({ ...v, [`${r.key}_${k}`]: e.target.checked })} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-3"><Button type="submit" loading={pending}>Save choices</Button><span role="status" aria-live="polite" className="text-sm text-ink-soft">{note}</span></div>
    </form>
  );
}

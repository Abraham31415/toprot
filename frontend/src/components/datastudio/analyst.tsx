"use client";

import { useState } from "react";
import { AlertTriangle, ClipboardCopy, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ds";
import { TASK_LABEL, type AnalystTask } from "@/lib/datastudio/ai";
import { askAnalyst, type AnalystAnswer } from "@/app/studies/[id]/data/ai-actions";
import type { SavedAnalysis } from "@/app/studies/[id]/data/actions";

/** AI Research Analyst: explains and drafts text from a saved, computed result. Clearly separated from computed output. */
export function Analyst({ studyId, analyses, canUse, initialId }: { studyId: string; analyses: SavedAnalysis[]; canUse: boolean; initialId?: string | null }) {
  const done = analyses.filter((a) => a.status === "completed");
  const [id, setId] = useState<string>(initialId ?? done[0]?.id ?? "");
  const [task, setTask] = useState<AnalystTask>("interpret");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AnalystAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true); setError(null); setAnswer(null);
    const r = await askAnalyst(studyId, id, task, q, crypto.randomUUID());
    setBusy(false);
    if (!r.ok) setError(r.error); else setAnswer(r.data);
  }
  if (!done.length) return <p className="type-support">Run an analysis first. The AI analyst works only from results the statistics engine has computed.</p>;
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        <div className="flex gap-2 rounded-control border border-info-line bg-info-bg p-3 text-sm text-info-ink"><ShieldCheck className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /><p>Only the summary tables, estimates and diagnostics of the chosen result are sent, never your data rows. Uses AI credits; ordinary analyses do not.</p></div>
        <label className="type-label">Result<select value={id} onChange={(e) => { setId(e.target.value); setAnswer(null); }} className="mt-1 w-full rounded-control border border-line-strong bg-surface px-2 py-1.5 text-sm">{done.map((a) => <option key={a.id} value={a.id}>{a.title} ({new Date(a.created_at).toLocaleDateString("en-GB")})</option>)}</select></label>
        <fieldset><legend className="type-label">Task</legend>{(Object.keys(TASK_LABEL) as AnalystTask[]).map((t) => <label key={t} className="mt-1 flex items-center gap-2 text-sm"><input type="radio" name="task" checked={task === t} onChange={() => setTask(t)} />{TASK_LABEL[t]}</label>)}</fieldset>
        <label className="type-label">Context or question (optional)<textarea rows={3} maxLength={800} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. This was a prespecified primary analysis in a cohort of adults." className="mt-1 w-full rounded-control border border-line-strong px-2 py-1.5 text-sm" /></label>
        <Button onClick={ask} loading={busy} disabled={!canUse || !id}><Sparkles className="h-4 w-4" aria-hidden="true" />Ask the analyst</Button>
        {!canUse && <p className="type-caption">Editors and owners can use the AI analyst.</p>}
      </div>
      <div className="min-w-0 space-y-3">
        {error && <p role="alert" className="rounded-control border border-danger-line bg-danger-bg p-3 text-sm text-danger-ink">{error}</p>}
        {answer && (
          <article className="rounded-card border-2 border-dashed border-accent-violet/50 bg-surface p-4" aria-label="AI-generated text">
            <p className="inline-flex items-center gap-1 rounded-full bg-accent-violet/10 px-2 py-0.5 text-xs font-semibold text-accent-violet"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />AI-generated. Check it before use.</p>
            {answer.untraced.length > 0 ? (
              <p className="mt-3 flex gap-2 rounded-control border border-warning-line bg-warning-bg p-2 text-sm text-warning-ink"><AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />These numbers do not appear in the computed result and may be wrong: {answer.untraced.join(", ")}. Remove or correct them.</p>
            ) : <p className="mt-3 flex gap-2 text-sm text-success-ink"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Every number in this text was found in the computed result.</p>}
            <div className="mt-3 space-y-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">{answer.text}</div>
            <div className="mt-3 flex gap-3"><button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => navigator.clipboard.writeText(answer.text)}><ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />Copy</button></div>
            <details className="mt-3 text-xs"><summary className="cursor-pointer text-ink-muted">Exactly what was sent to the AI</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-canvas p-2 text-ink-soft">{answer.sent}</pre></details>
          </article>
        )}
      </div>
    </div>
  );
}

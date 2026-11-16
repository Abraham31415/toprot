"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MessageSquare, Send } from "lucide-react";
import { Button, StatusIndicator } from "@/components/ds";
import { PROTOCOL_SECTIONS, sectionLabel, STATUS_LABEL, STATUS_TONE, type ReviewOverview, type ReviewStatus } from "@/lib/collab/review";
import { TITLE_TEXT } from "@/lib/collab/roles";
import { postComment, reviewDecision, setThreadResolved, submitReview } from "./actions";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const TONE = { neutral: "neutral", info: "info", warning: "warning", success: "success" } as const;
const box = "w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-primary";

export function ReviewPanel({ studyId, userId, overview }: { studyId: string; userId: string; overview: ReviewOverview }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ error?: string; message?: string } | null>(null);
  const role = overview.your_role;
  const canSubmit = role === "owner" || role === "editor";
  const canComment = role !== "viewer";
  const me = overview.reviewers.find((r) => r.user_id === userId);
  const manuscripts = overview.latest_submission?.manuscripts ?? [];

  const run = (fn: () => Promise<{ error?: string; message?: string }>, after?: () => void) =>
    start(async () => { const r = await fn(); setNotice(r); if (!r.error) { after?.(); router.refresh(); } });

  const [note, setNote] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [statement, setStatement] = useState("");
  const [confirm, setConfirm] = useState(false);
  const ids = { note: useId(), change: useId(), statement: useId(), section: useId(), body: useId() };

  const [section, setSection] = useState("general");
  const [body, setBody] = useState("");
  const [filter, setFilter] = useState<"open" | "all">("open");
  const threads = useMemo(() => overview.threads.filter((t) => filter === "all" || t.status === "open"), [overview.threads, filter]);

  return (
    <div className="mt-6 flex flex-col gap-8">
      <div role="status" aria-live="polite" className="empty:hidden">
        {notice?.error && <p className="rounded-control border border-danger-line bg-danger-bg p-3 text-sm text-danger-ink">{notice.error}</p>}
        {notice?.message && !notice.error && <p className="rounded-control border border-success-line bg-success-bg p-3 text-sm text-success-ink">{notice.message}</p>}
      </div>

      {canSubmit && (
        <section aria-labelledby="submit-h" className="rounded-card border border-line bg-surface p-5">
          <h2 id="submit-h" className="text-base font-semibold text-ink">Submit for review</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {overview.latest_submission
              ? `Latest submission: version ${overview.latest_submission.number}, ${when(overview.latest_submission.created_at)}. Submitting again sends the current protocol and manuscripts as a new version.`
              : "Nothing has been submitted yet. Submitting saves a snapshot of your protocol and manuscripts and asks every supervisor on this project to review it."}
          </p>
          <label htmlFor={ids.note} className="mt-3 block text-sm font-medium">Note to your supervisors <span className="font-normal text-ink-soft">(optional)</span></label>
          <textarea id={ids.note} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={`${box} mt-1`} placeholder="What should they focus on?" />
          <div className="mt-3"><Button loading={pending} disabled={overview.reviewers.length === 0} onClick={() => run(() => submitReview(studyId, note), () => setNote(""))}><Send className="h-4 w-4" aria-hidden="true" />Submit for review</Button></div>
          {overview.reviewers.length === 0 && <p className="mt-2 text-sm text-ink-soft">Invite a supervisor with Share first. They will appear here.</p>}
        </section>
      )}

      <section aria-labelledby="sup-h">
        <h2 id="sup-h" className="type-eyebrow mb-2">Supervisors</h2>
        {overview.reviewers.length === 0 ? (
          <p className="rounded-card border border-dashed border-line-strong bg-surface p-5 text-sm text-ink-soft">No supervisor is on this project yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {overview.reviewers.map((r) => (
              <li key={r.user_id} className="rounded-card border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">{r.full_name || "Supervisor"}{r.title_label && <span className="ml-2 text-xs font-normal text-ink-soft">{TITLE_TEXT[r.title_label as keyof typeof TITLE_TEXT] ?? ""}</span>}</p>
                    {r.updated_at && <p className="text-xs text-ink-soft">Since {when(r.updated_at)}{r.on_latest === false ? ". Reviewing an older version." : ""}</p>}
                  </div>
                  <StatusIndicator status={TONE[STATUS_TONE[r.status as ReviewStatus]]}>{STATUS_LABEL[r.status as ReviewStatus]}</StatusIndicator>
                </div>

                {r.approvals.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-2" aria-label={`Approvals by ${r.full_name}`}>
                    {r.approvals.map((a) => (
                      <li key={a.number} className="rounded-control border border-success-line bg-success-bg p-3 text-sm text-success-ink">
                        <p className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Approval {a.number}: version {a.submission}, {when(a.at)} {a.current ? "(current version)" : "(an older version, since resubmitted)"}</p>
                        {a.statement && <p className="mt-1">{a.statement}</p>}
                        <p className="mt-1 text-xs">Fingerprint {a.content_hash.slice(0, 12)}. Recorded permanently; it cannot be edited or removed. Internal ToProt approval, not ethics approval.</p>
                      </li>
                    ))}
                  </ul>
                )}

                {r.history.length > 0 && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink">History ({r.history.length})</summary>
                    <ol className="mt-2 flex flex-col gap-1.5 border-l border-line pl-4">
                      {r.history.map((h, i) => (
                        <li key={i}>
                          <span className="font-medium text-ink">{STATUS_LABEL[h.to as ReviewStatus] ?? h.to}</span>
                          <span className="text-ink-soft"> on {when(h.at)}{h.submission ? `, version ${h.submission}` : ""}</span>
                          {h.note && <p className="text-ink-soft">{h.note}</p>}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {role === "reviewer" && me && me.status !== "draft" && (
        <section aria-labelledby="dec-h" className="rounded-card border border-line bg-surface p-5">
          <h2 id="dec-h" className="text-base font-semibold text-ink">Your review</h2>
          <p className="mt-1 text-sm text-ink-soft">Your status: {STATUS_LABEL[me.status as ReviewStatus]}. Read the protocol and manuscripts, then decide. Only you can record your decision.</p>
          {(me.status === "submitted" || me.status === "resubmitted") && (
            <div className="mt-3"><Button loading={pending} onClick={() => run(() => reviewDecision(studyId, "under_review", {}))}>Start review</Button></div>
          )}
          {me.status === "under_review" && (
            <div className="mt-3 flex flex-col gap-5">
              <div>
                <label htmlFor={ids.change} className="block text-sm font-medium">Request changes</label>
                <textarea id={ids.change} rows={3} maxLength={4000} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} className={`${box} mt-1`} placeholder="Explain what needs to change." />
                <div className="mt-2"><Button variant="secondary" loading={pending} disabled={changeNote.trim().length < 3} onClick={() => run(() => reviewDecision(studyId, "changes_requested", { note: changeNote }), () => setChangeNote(""))}>Request changes</Button></div>
              </div>
              <div className="border-t border-line pt-4">
                <label htmlFor={ids.statement} className="block text-sm font-medium">Approve this version</label>
                <textarea id={ids.statement} rows={2} maxLength={2000} value={statement} onChange={(e) => setStatement(e.target.value)} className={`${box} mt-1`} placeholder="Optional statement recorded with your approval." />
                <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1 h-4 w-4" />
                  <span>I have personally reviewed the submitted version. I understand this is an internal ToProt approval, not ethics committee or institutional approval.</span></label>
                <div className="mt-2"><Button loading={pending} disabled={!confirm} onClick={() => run(() => reviewDecision(studyId, "approved", { statement, confirm }), () => { setStatement(""); setConfirm(false); })}>Approve</Button></div>
              </div>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="com-h">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="com-h" className="type-eyebrow">Comments</h2>
          <div role="group" aria-label="Filter comments" className="flex gap-1 text-sm">
            {(["open", "all"] as const).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-control px-3 py-1 ${filter === f ? "bg-surface-soft font-medium text-primary-hover" : "text-ink-soft hover:bg-hover"}`}>{f === "open" ? "Open" : "All"}</button>)}
          </div>
        </div>
        <p className="mb-3 text-sm text-ink-soft">Comments attach to a section of the protocol or to a manuscript. Highlighting text inside the manuscript editor is not available.</p>

        {canComment && (
          <form className="mb-4 rounded-card border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); run(() => postComment(studyId, section, body, null), () => setBody("")); }}>
            <label htmlFor={ids.section} className="block text-sm font-medium">Section</label>
            <select id={ids.section} value={section} onChange={(e) => setSection(e.target.value)} className={`${box} mt-1 sm:max-w-xs`}>
              <option value="general">General</option>
              <optgroup label="Protocol">{PROTOCOL_SECTIONS.map((s) => <option key={s.key} value={`protocol:${s.key}`}>{s.label}</option>)}</optgroup>
              {manuscripts.length > 0 && <optgroup label="Manuscripts">{manuscripts.map((m) => <option key={m.id} value={`manuscript:${m.id}`}>{m.title}</option>)}</optgroup>}
            </select>
            <label htmlFor={ids.body} className="mt-3 block text-sm font-medium">Comment</label>
            <textarea id={ids.body} rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} className={`${box} mt-1`} />
            <div className="mt-2"><Button type="submit" size="sm" loading={pending} disabled={!body.trim()}><MessageSquare className="h-4 w-4" aria-hidden="true" />Start thread</Button></div>
          </form>
        )}

        {threads.length === 0 ? <p className="text-sm text-ink-soft">{filter === "open" ? "No open comments." : "No comments yet."}</p> : (
          <ul className="flex flex-col gap-3">
            {threads.map((t) => <Thread key={t.id} t={t} studyId={studyId} manuscripts={manuscripts} canComment={canComment} run={run} pending={pending} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function Thread({ t, studyId, manuscripts, canComment, run, pending }: {
  t: ReviewOverview["threads"][number]; studyId: string; manuscripts: { id: string; title: string }[]; canComment: boolean; pending: boolean;
  run: (fn: () => Promise<{ error?: string; message?: string }>, after?: () => void) => void;
}) {
  const [reply, setReply] = useState("");
  const id = useId();
  return (
    <li className={`rounded-card border bg-surface p-4 ${t.status === "resolved" ? "border-line opacity-80" : "border-line-strong"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">{sectionLabel(t.section, manuscripts)}{t.submission ? <span className="ml-2 text-xs font-normal text-ink-soft">version {t.submission}</span> : null}</p>
        <div className="flex items-center gap-2">
          <StatusIndicator compact status={t.status === "open" ? "info" : "success"}>{t.status === "open" ? "Open" : "Resolved"}</StatusIndicator>
          {canComment && <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => setThreadResolved(studyId, t.id, t.status === "open"))}>{t.status === "open" ? "Resolve" : "Reopen"}</Button>}
        </div>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {t.comments.map((c) => (
          <li key={c.id} className="text-sm"><span className="font-medium text-ink">{c.author ?? "Former member"}</span><span className="text-xs text-ink-soft"> {when(c.at)}</span><p className="whitespace-pre-wrap text-ink">{c.body}</p></li>
        ))}
      </ul>
      {canComment && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => postComment(studyId, t.section, reply, t.id), () => setReply("")); }}>
          <label htmlFor={id} className="sr-only">Reply</label>
          <input id={id} value={reply} maxLength={4000} onChange={(e) => setReply(e.target.value)} placeholder="Reply" className={box} />
          <Button type="submit" size="sm" variant="secondary" disabled={pending || !reply.trim()}>Reply</Button>
        </form>
      )}
    </li>
  );
}

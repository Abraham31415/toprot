"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { Copy, Mail, Share2, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ds";
import { ROLE_LABEL, ROLE_SUMMARY, TITLE_LABELS, TITLE_TEXT, type MemberRole, type ProjectRole } from "@/lib/collab/roles";
import {
  changeRole, inviteToProject, leaveProject, loadPeople, removeFromProject, resendInvite, revokeInvite,
  type PeopleView, type ShareResult,
} from "@/app/studies/[id]/share/actions";

const ROLE_ORDER: MemberRole[] = ["reviewer", "editor", "viewer"];
const field = "min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-primary";

/** "Share" button and the people dialog for one project. Everything shown comes from the database; nothing is assumed. */
export function ShareProjectDialog({ studyId, role, memberCount }: { studyId: string; role: ProjectRole; memberCount: number }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<PeopleView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ShareResult | null>(null);
  const [pending, start] = useTransition();
  const isOwner = role === "owner";
  const ids = { email: useId(), role: useId(), label: useId(), title: useId() };

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("reviewer");
  const [label, setLabel] = useState("");

  const refresh = useCallback(async () => {
    const r = await loadPeople(studyId);
    if (r.view) { setView(r.view); setLoadError(null); } else setLoadError(r.error ?? "Could not load people.");
  }, [studyId]);

  const open = () => { setNotice(null); dialog.current?.showModal(); void refresh(); };
  const close = () => { dialog.current?.close(); opener.current?.focus(); };
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const onClose = () => opener.current?.focus();
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, []);

  const roleAvailable = (r: MemberRole) => (view?.limits[r]?.max ?? 0) > 0;
  const roleFull = (r: MemberRole) => !!view && (view.limits[r]?.used ?? 0) >= (view.limits[r]?.max ?? 0);

  const act = (fn: () => Promise<ShareResult>, after?: () => void) =>
    start(async () => { const r = await fn(); setNotice(r); if (!r.error) { after?.(); } await refresh(); });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    act(() => inviteToProject(studyId, email, inviteRole, label || null), () => { setEmail(""); setLabel(""); });
  };

  const copy = async (link: string) => { try { await navigator.clipboard.writeText(link); setNotice((n) => ({ ...(n ?? {}), message: "Link copied. It works only for the invited email address." })); } catch { setNotice({ error: "Could not copy. Select the link and copy it manually.", link }); } };

  return (
    <>
      <button ref={opener} type="button" onClick={open} className="inline-flex min-h-9 items-center gap-2 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-ink hover:border-primary hover:text-primary">
        <Share2 className="h-4 w-4" aria-hidden="true" />
        {isOwner ? "Share" : "People"}
        {memberCount > 0 && <span className="rounded-full bg-surface-soft px-1.5 text-xs text-ink-soft" aria-label={`${memberCount} ${memberCount === 1 ? "other person" : "other people"} on this project`}>{memberCount}</span>}
      </button>

      <dialog ref={dialog} aria-labelledby={ids.title} onClick={(e) => { if (e.target === dialog.current) close(); }} className="m-auto w-[min(40rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-card border border-line bg-surface p-0 text-ink shadow-raised backdrop:bg-ink/40">
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <h2 id={ids.title} className="text-lg font-semibold text-ink">{isOwner ? "Share this project" : "People on this project"}</h2>
            <p className="mt-1 text-sm text-ink-soft">You are {role === "owner" ? "the owner" : `a${role === "editor" ? "n" : ""} ${role}`} on this project.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="rounded-control p-2 text-ink-soft hover:bg-hover hover:text-ink"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>

        <div className="flex flex-col gap-6 p-5">
          <div role="status" aria-live="polite" className="empty:hidden">
            {notice?.error && <p className="rounded-control border border-danger-line bg-danger-bg p-3 text-sm text-danger-ink">{notice.error}</p>}
            {notice?.message && !notice.error && <p className="rounded-control border border-line bg-surface-soft p-3 text-sm text-ink">{notice.message}</p>}
            {notice?.link && (
              <div className="mt-2 flex items-center gap-2">
                <input readOnly value={notice.link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono text-xs`} />
                <Button variant="secondary" size="sm" onClick={() => copy(notice.link!)}><Copy className="h-4 w-4" aria-hidden="true" />Copy</Button>
              </div>
            )}
          </div>

          {loadError && <p className="text-sm text-danger-ink" role="alert">{loadError}</p>}
          {!view && !loadError && <p className="text-sm text-ink-soft">Loading people...</p>}

          {view && isOwner && (
            <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Invite someone">
              <h3 className="type-eyebrow">Invite someone</h3>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <div>
                  <label htmlFor={ids.email} className="mb-1 block text-sm font-medium">Email address</label>
                  <input id={ids.email} type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={field} placeholder="supervisor@university.edu" />
                </div>
                <div>
                  <label htmlFor={ids.role} className="mb-1 block text-sm font-medium">Role</label>
                  <select id={ids.role} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as MemberRole)} className={field} aria-describedby={`${ids.role}-help`}>
                    {ROLE_ORDER.map((r) => (
                      <option key={r} value={r} disabled={!roleAvailable(r) || roleFull(r)}>
                        {r === "reviewer" ? "Reviewer (supervisor)" : ROLE_LABEL[r]}{!roleAvailable(r) ? " (Pro)" : roleFull(r) ? " (limit reached)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p id={`${ids.role}-help`} className="text-sm text-ink-soft">{ROLE_SUMMARY[inviteRole]}</p>
              <div className="sm:max-w-xs">
                <label htmlFor={ids.label} className="mb-1 block text-sm font-medium">Title shown next to their name <span className="font-normal text-ink-soft">(optional)</span></label>
                <select id={ids.label} value={label} onChange={(e) => setLabel(e.target.value)} className={field}>
                  <option value="">None</option>
                  {TITLE_LABELS.map((t) => <option key={t} value={t}>{TITLE_TEXT[t]}</option>)}
                </select>
                <p className="mt-1 text-xs text-ink-soft">A title is only a label. Permissions come from the role.</p>
              </div>
              {view.plan === "free" && (
                <p className="rounded-control bg-surface-soft p-3 text-sm text-ink-soft">On the Free plan you can invite up to {view.limits.reviewer?.max ?? 0} supervisors (reviewers) to a project. Editors, co-investigators and viewers are part of Pro.</p>
              )}
              <div className="flex items-center gap-3">
                <Button type="submit" loading={pending} disabled={!email}><UserPlus className="h-4 w-4" aria-hidden="true" />Send invitation</Button>
                {!view.emailConfigured && <span className="text-xs text-ink-soft">Email sending is not set up on this server. You will get a link to share yourself.</span>}
              </div>
            </form>
          )}

          {view && (
            <section aria-labelledby={`${ids.title}-people`}>
              <h3 id={`${ids.title}-people`} className="type-eyebrow mb-2">People with access</h3>
              <ul className="divide-y divide-line rounded-control border border-line">
                <li className="flex items-center justify-between gap-3 p-3">
                  <div><p className="text-sm font-medium">{view.owner.full_name || "Owner"}</p><p className="text-xs text-ink-soft">{view.owner.institution ?? ""}</p></div>
                  <span className="rounded-full bg-surface-soft px-2 py-0.5 text-xs font-medium">Owner</span>
                </li>
                {view.members.map((m) => (
                  <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div>
                      <p className="text-sm font-medium">{m.full_name || "Unnamed user"}{m.title_label && <span className="ml-2 text-xs font-normal text-ink-soft">{TITLE_TEXT[m.title_label as keyof typeof TITLE_TEXT] ?? ""}</span>}</p>
                      <p className="text-xs text-ink-soft">{m.institution ?? ""}{!m.active && " This role is paused because the owner's plan does not include it."}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isOwner ? (
                        <>
                          <label className="sr-only" htmlFor={`role-${m.user_id}`}>Role for {m.full_name}</label>
                          <select id={`role-${m.user_id}`} value={m.role} disabled={pending} onChange={(e) => act(() => changeRole(studyId, m.user_id, e.target.value))} className="min-h-9 rounded-control border border-line-strong bg-surface px-2 text-sm">
                            {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                          <button type="button" disabled={pending} onClick={() => { if (confirm(`Remove ${m.full_name || "this person"}? They will lose access immediately.`)) act(() => removeFromProject(studyId, m.user_id)); }} aria-label={`Remove ${m.full_name}`} className="rounded-control p-2 text-ink-soft hover:bg-hover hover:text-danger-ink"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                        </>
                      ) : <span className="rounded-full bg-surface-soft px-2 py-0.5 text-xs font-medium">{ROLE_LABEL[m.role]}</span>}
                    </div>
                  </li>
                ))}
                {!view.members.length && <li className="p-3 text-sm text-ink-soft">Nobody else has access yet.</li>}
              </ul>
            </section>
          )}

          {view && isOwner && view.invitations.length > 0 && (
            <section aria-labelledby={`${ids.title}-pending`}>
              <h3 id={`${ids.title}-pending`} className="type-eyebrow mb-2">Pending invitations</h3>
              <ul className="divide-y divide-line rounded-control border border-line">
                {view.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div>
                      <p className="flex items-center gap-1.5 text-sm font-medium"><Mail className="h-4 w-4 text-ink-soft" aria-hidden="true" />{i.email}</p>
                      <p className="text-xs text-ink-soft">
                        {ROLE_LABEL[i.role]}. {i.expired ? "Expired. Resend to renew it." : `Expires ${new Date(i.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`}{" "}
                        {i.delivery_status === "provider_accepted" ? "Email accepted by the provider." : i.delivery_status === "failed" ? "Email could not be sent." : i.delivery_status === "not_configured" ? "Not emailed (email not set up)." : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => act(() => resendInvite(studyId, i.id))}>Resend</Button>
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => act(() => revokeInvite(studyId, i.id))}>Revoke</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {view && !isOwner && (
            <div>
              <Button variant="secondary" size="sm" disabled={pending} onClick={() => { if (confirm("Leave this project? You will lose access.")) act(() => leaveProject(studyId), () => { router.push("/shared"); }); }}>Leave this project</Button>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}

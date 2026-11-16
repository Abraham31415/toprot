"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Mail, Trash2 } from "lucide-react";
import { Button } from "@/components/ds";
import { TEAM_ROLE_LABEL, TEAM_ROLE_SUMMARY, teamCan, type TeamInviteRole, type TeamOverview, type TeamRole } from "@/lib/collab/teams";
import { changeMemberRole, inviteMember, leaveTeam, removeMember, resendInvite, revokeInvite, type TeamResult } from "@/app/teams/actions";

const field = "min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-sm";

export function MembersPanel({ teamId, userId, overview, emailReady }: { teamId: string; userId: string; overview: TeamOverview; emailReady: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<TeamResult | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamInviteRole>("member");
  const ids = { email: useId(), role: useId() };
  const me = overview.your_role;
  const canInvite = teamCan(me, "invite");
  const act = (fn: () => Promise<TeamResult>, after?: () => void) => start(async () => { const r = await fn(); setNotice(r); if (!r.error) { after?.(); router.refresh(); } });
  const e = overview.entitlements, s = overview.seats;
  const roles: TeamInviteRole[] = me === "owner" ? ["member", "guest", "administrator"] : ["member", "guest"];

  return (
    <div className="flex flex-col gap-8">
      <div role="status" aria-live="polite" className="empty:hidden">
        {notice?.error && <p className="rounded-control border border-danger-line bg-danger-bg p-3 text-sm text-danger-ink">{notice.error}</p>}
        {notice?.message && !notice.error && <p className="rounded-control border border-line bg-surface-soft p-3 text-sm">{notice.message}</p>}
        {notice?.link && (
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={notice.link} aria-label="Invitation link" onFocus={(ev) => ev.currentTarget.select()} className={`${field} font-mono text-xs`} />
            <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(notice.link!).then(() => setNotice({ message: "Link copied." }), () => undefined)}><Copy className="h-4 w-4" aria-hidden="true" />Copy</Button>
          </div>
        )}
      </div>

      {canInvite && (
        <form className="rounded-card border border-line bg-surface p-5" onSubmit={(ev) => { ev.preventDefault(); act(() => inviteMember(teamId, email, role), () => setEmail("")); }}>
          <h2 className="text-base font-semibold text-ink">Invite to the team</h2>
          <p className="mt-1 text-sm text-ink-soft">Paid seats: {s.paid_used + s.paid_invited} of {e.max_paid_seats} used. Guest seats: {s.guests_used + s.guests_invited} of {e.max_guests} used.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <div><label htmlFor={ids.email} className="mb-1 block text-sm font-medium">Email address</label><input id={ids.email} type="email" required autoComplete="off" value={email} onChange={(ev) => setEmail(ev.target.value)} className={field} /></div>
            <div><label htmlFor={ids.role} className="mb-1 block text-sm font-medium">Role</label>
              <select id={ids.role} value={role} onChange={(ev) => setRole(ev.target.value as TeamInviteRole)} className={field}>{roles.map((r) => <option key={r} value={r}>{TEAM_ROLE_LABEL[r]}</option>)}</select></div>
          </div>
          <p className="mt-2 text-sm text-ink-soft">{TEAM_ROLE_SUMMARY[role]}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3"><Button type="submit" loading={pending} disabled={!email}>Send invitation</Button>{!emailReady && <span className="text-xs text-ink-soft">Email sending is not set up on this server. You will get a link to share yourself.</span>}</div>
        </form>
      )}

      <section aria-labelledby="mem-h">
        <h2 id="mem-h" className="type-eyebrow mb-2">People</h2>
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {overview.members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div><p className="font-medium text-ink">{m.full_name || "Unnamed user"}{m.user_id === userId ? " (you)" : ""}</p><p className="text-xs text-ink-soft">{m.institution ?? ""} {m.seat_type === "guest" ? "Guest seat." : "Paid seat."}{m.projects ? ` Owns ${m.projects} team project${m.projects === 1 ? "" : "s"}.` : ""}</p></div>
              <div className="flex items-center gap-2">
                {me === "owner" && m.role !== "owner" ? (
                  <><label className="sr-only" htmlFor={`r-${m.user_id}`}>Role for {m.full_name}</label>
                    <select id={`r-${m.user_id}`} value={m.role} disabled={pending} onChange={(ev) => act(() => changeMemberRole(teamId, m.user_id, ev.target.value))} className="min-h-9 rounded-control border border-line-strong bg-surface px-2 text-sm">
                      {(["administrator", "member", "guest"] as TeamRole[]).map((r) => <option key={r} value={r}>{TEAM_ROLE_LABEL[r]}</option>)}</select></>
                ) : <span className="rounded-full bg-surface-soft px-2 py-0.5 text-xs font-medium">{TEAM_ROLE_LABEL[m.role]}</span>}
                {teamCan(me, "manage_members") && m.role !== "owner" && m.user_id !== userId && !(me === "administrator" && m.role === "administrator") && (
                  <button type="button" disabled={pending} aria-label={`Remove ${m.full_name}`} onClick={() => { if (confirm(`Remove ${m.full_name || "this person"} from the team? They lose access to team files and any team project roles immediately.`)) act(() => removeMember(teamId, m.user_id)); }} className="rounded-control p-2 text-ink-soft hover:bg-hover hover:text-danger-ink"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {me !== "owner" && <div className="mt-3"><Button variant="secondary" size="sm" disabled={pending} onClick={() => { if (confirm("Leave this team?")) act(() => leaveTeam(teamId), () => router.push("/teams")); }}>Leave team</Button></div>}
      </section>

      {canInvite && overview.invitations.length > 0 && (
        <section aria-labelledby="pend-h">
          <h2 id="pend-h" className="type-eyebrow mb-2">Pending invitations</h2>
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {overview.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div><p className="flex items-center gap-1.5 text-sm font-medium"><Mail className="h-4 w-4 text-ink-soft" aria-hidden="true" />{i.email}</p>
                  <p className="text-xs text-ink-soft">{TEAM_ROLE_LABEL[i.role]}. {i.expired ? "Expired. Resend to renew it." : `Expires ${new Date(i.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`} {i.delivery_status === "provider_accepted" ? "Email accepted by the provider." : i.delivery_status === "failed" ? "Email could not be sent." : i.delivery_status === "not_configured" ? "Not emailed (email not set up)." : ""}</p></div>
                <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={pending} onClick={() => act(() => resendInvite(teamId, i.id))}>Resend</Button><Button variant="secondary" size="sm" disabled={pending} onClick={() => act(() => revokeInvite(teamId, i.id))}>Revoke</Button></div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

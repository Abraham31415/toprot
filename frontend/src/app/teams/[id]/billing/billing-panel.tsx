"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds";
import {
  chooseFunding, decideRequest, lowerSeats, requestMoreCredits, setMemberLimit, setPool, startAddSeats, startTeamSubscription,
} from "@/app/teams/billing-actions";

export type BillingOverview = {
  your_role: "owner" | "administrator" | "member";
  entitlements: { state: string; max_paid_seats: number; max_guests: number; period_end: string | null; cancel_at_period_end: boolean; grace_until: string | null; next_paid_seats: number | null; seat_sync_pending: boolean };
  billing_enabled: boolean;
  prices: { base: number | null; seat: number | null; base_seats: number; max_seats: number; monthly_credits: number | null };
  subscription: null | { status: string; paid_seats: number; next_paid_seats: number | null; period_end: string; cancel_at_period_end: boolean; grace_until: string | null; seat_sync_pending: boolean; renews_automatically: boolean };
  payments: { kind: string; amount: number; currency: string; status: string; at: string }[];
};
export type AiOverview = {
  your_role: "owner" | "administrator" | "member";
  pool: null | { enabled: boolean; balance_mcr: number; reserved_mcr: number; available_mcr: number; monthly_team_limit_mcr: number | null; default_member_limit_mcr: number | null; month_used_mcr: number };
  you: { used_mcr: number; allowance_mcr: number | null; using_pool: boolean };
  members: { user_id: string; full_name: string; used_mcr: number; allowance_mcr: number | null; override_mcr: number | null }[];
  requests: { id: string; user_id: string; full_name: string; requested_mcr: number; reason: string | null; status: string; granted_mcr: number | null; at: string }[];
  transactions: { kind: string; amount_mcr: number; user: string | null; note: string | null; at: string }[];
};

const cr = (mcr: number | null) => (mcr === null ? "No limit" : `${(mcr / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} credits`);
const money = (n: number | null) => (n === null ? "not set" : `$${n.toFixed(2)}`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");
const field = "min-h-10 rounded-control border border-line-strong bg-surface px-3 text-sm";
const KIND: Record<string, string> = { team_subscription: "Teams plan", team_seats: "Extra seats", team_pack: "Credit pack" };

export function BillingPanel({ teamId, userId, bill, ai, paymentsReady, paymentsMessage }: { teamId: string; userId: string; bill: BillingOverview; ai: AiOverview; paymentsReady: boolean; paymentsMessage: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ error?: string; message?: string } | null>(null);
  const ids = { seats: useId(), add: useId(), teamLimit: useId(), memberLimit: useId(), req: useId(), reason: useId() };
  const isOwner = bill.your_role === "owner";
  const isAdmin = bill.your_role === "owner" || bill.your_role === "administrator";
  const e = bill.entitlements, sub = bill.subscription;
  const [seats, setSeats] = useState(String(sub?.paid_seats ?? bill.prices.base_seats));
  const [add, setAdd] = useState("1");
  const [teamLimit, setTeamLimit] = useState(ai.pool?.monthly_team_limit_mcr != null ? String(ai.pool.monthly_team_limit_mcr / 1000) : "");
  const [memberLimit, setMemberLimitText] = useState(ai.pool?.default_member_limit_mcr != null ? String(ai.pool.default_member_limit_mcr / 1000) : "");
  const [reqCredits, setReqCredits] = useState("20");
  const [reason, setReason] = useState("");

  const act = (fn: () => Promise<{ error?: string; message?: string; url?: string }>) =>
    start(async () => { const r = await fn(); if (r.url) { window.location.assign(r.url); return; } setNotice(r); if (!r.error) router.refresh(); });
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const seatTotal = (n: number) => bill.prices.base !== null && bill.prices.seat !== null ? bill.prices.base + Math.max(n - bill.prices.base_seats, 0) * bill.prices.seat : null;
  const active = e.state === "active";

  return (
    <div className="flex flex-col gap-8">
      <div role="status" aria-live="polite" className="empty:hidden">
        {notice?.error && <p className="rounded-control border border-danger-line bg-danger-bg p-3 text-sm text-danger-ink">{notice.error}</p>}
        {notice?.message && !notice.error && <p className="rounded-control border border-line bg-surface-soft p-3 text-sm">{notice.message}</p>}
      </div>

      <section aria-labelledby="plan-h" className="rounded-card border border-line bg-surface p-5">
        <h2 id="plan-h" className="text-base font-semibold text-ink">Teams plan</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {active ? `Active${e.cancel_at_period_end ? ", ends " + day(e.period_end) + " (no further renewal)" : e.period_end ? ", paid until " + day(e.period_end) : ""}. ${e.max_paid_seats} paid seats.` :
            e.state === "lapsed" ? "The plan has lapsed. Team projects follow each owner's own plan again; nothing has been deleted." : "This team is not on a Teams plan."}
          {sub?.status === "past_due" && sub.grace_until && ` The last renewal payment failed. Everything keeps working until ${day(sub.grace_until)}.`}
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          {bill.prices.base !== null ? `${money(bill.prices.base)} a month includes ${bill.prices.base_seats} paid seats${bill.prices.seat !== null ? `, then ${money(bill.prices.seat)} a month per extra seat` : ""}.` : "Teams pricing is not set up."} Guest reviewers use free guest seats. Your personal Pro plan is separate: it covers your own projects, and you never pay for another member&apos;s seat.
        </p>
        {!bill.billing_enabled && <p className="mt-2 rounded-control bg-surface-soft p-3 text-sm text-ink-soft">Teams billing is not switched on yet, so a Teams plan cannot be bought. It will be offered once the payment setup has been verified.</p>}
        {bill.billing_enabled && !paymentsReady && <p className="mt-2 rounded-control bg-surface-soft p-3 text-sm text-ink-soft">{paymentsMessage}</p>}

        {isOwner && bill.billing_enabled && paymentsReady && (
          <div className="mt-4 flex flex-col gap-4">
            {(!sub || sub.status !== "active" || sub.cancel_at_period_end || !sub.renews_automatically) && (
              <div className="flex flex-wrap items-end gap-3">
                <div><label htmlFor={ids.seats} className="mb-1 block text-sm font-medium">Paid seats</label>
                  <input id={ids.seats} type="number" min={bill.prices.base_seats} max={bill.prices.max_seats} value={seats} onChange={(ev) => setSeats(ev.target.value)} className={`${field} w-28`} /></div>
                <p className="pb-2 text-sm text-ink-soft">{seatTotal(Number(seats)) !== null ? `${money(seatTotal(Number(seats)))} a month, charged in US dollars.` : ""}</p>
                <Button loading={pending} onClick={() => act(() => startTeamSubscription(teamId, Number(seats)))}>{active ? "Renew now" : "Subscribe"}</Button>
              </div>
            )}
            {sub && sub.status === "active" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-control border border-line p-3">
                  <label htmlFor={ids.add} className="block text-sm font-medium">Add seats now</label>
                  <p className="text-xs text-ink-soft">One-off payment of {money(bill.prices.seat)} per seat. Seats renew with the team.</p>
                  <div className="mt-2 flex gap-2"><input id={ids.add} type="number" min={1} value={add} onChange={(ev) => setAdd(ev.target.value)} className={`${field} w-24`} /><Button size="sm" loading={pending} onClick={() => act(() => startAddSeats(teamId, Number(add)))}>Pay and add</Button></div>
                </div>
                <div className="rounded-control border border-line p-3">
                  <p className="text-sm font-medium">Reduce seats</p>
                  <p className="text-xs text-ink-soft">Takes effect at the next renewal, never below the seats in use.{sub.next_paid_seats ? ` Currently set to ${sub.next_paid_seats}.` : ""}</p>
                  <div className="mt-2 flex gap-2"><label className="sr-only" htmlFor={`${ids.add}-r`}>Seats at next renewal</label><input id={`${ids.add}-r`} type="number" min={bill.prices.base_seats} value={seats} onChange={(ev) => setSeats(ev.target.value)} className={`${field} w-24`} /><Button size="sm" variant="secondary" loading={pending} onClick={() => act(() => lowerSeats(teamId, Number(seats)))}>Set seats</Button></div>
                </div>
              </div>
            )}
            {sub?.seat_sync_pending && <p className="text-xs text-ink-soft">The seat count changed. The payment provider&apos;s subscription quantity is brought in line by the administrator; until then the provider may still bill the old number.</p>}
          </div>
        )}
        {!isOwner && <p className="mt-3 text-sm text-ink-soft">Only the team owner manages the plan and payments.</p>}
        {isOwner && bill.payments.length > 0 && (
          <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium text-ink-soft">Payments ({bill.payments.length})</summary>
            <ul className="mt-2 divide-y divide-line">{bill.payments.map((p, i) => <li key={i} className="flex justify-between py-1.5"><span>{KIND[p.kind] ?? p.kind}, {day(p.at)}</span><span>{p.amount.toFixed(2)} {p.currency}, {p.status}</span></li>)}</ul></details>
        )}
      </section>

      <section aria-labelledby="ai-h" className="rounded-card border border-line bg-surface p-5">
        <h2 id="ai-h" className="text-base font-semibold text-ink">Shared AI credits</h2>
        <p className="mt-1 text-sm text-ink-soft">By default every AI request uses your own credits. If the team turns on a shared pool, each member can choose to use it. The pool never gives anyone access to a project, and it cannot go below zero.</p>
        {!ai.pool?.enabled && !isAdmin && <p className="mt-3 text-sm text-ink-soft">The team has not turned on shared credits.</p>}
        {ai.pool && (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-ink-soft">In the pool</dt><dd className="font-semibold text-ink">{cr(ai.pool.balance_mcr)}</dd></div>
            <div><dt className="text-ink-soft">Held for requests</dt><dd className="font-semibold text-ink">{cr(ai.pool.reserved_mcr)}</dd></div>
            <div><dt className="text-ink-soft">Team used this month</dt><dd className="font-semibold text-ink">{cr(ai.pool.month_used_mcr)}</dd></div>
            <div><dt className="text-ink-soft">You used this month</dt><dd className="font-semibold text-ink">{cr(ai.you.used_mcr)}{ai.you.allowance_mcr !== null ? ` of ${cr(ai.you.allowance_mcr)}` : ""}</dd></div>
          </dl>
        )}

        {ai.pool?.enabled && (
          <div className="mt-4 rounded-control border border-line p-3">
            <p className="text-sm font-medium">Pay for my AI requests with</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant={ai.you.using_pool ? "secondary" : "primary"} aria-pressed={!ai.you.using_pool} loading={pending} onClick={() => act(() => chooseFunding(null))}>My own credits</Button>
              <Button size="sm" variant={ai.you.using_pool ? "primary" : "secondary"} aria-pressed={ai.you.using_pool} loading={pending} onClick={() => act(() => chooseFunding(teamId))}>The team pool</Button>
            </div>
            <p className="mt-2 text-xs text-ink-soft">If the pool cannot cover a request you are told why; ToProt never switches to your own credits without you choosing it.</p>
          </div>
        )}

        {isAdmin && (
          <div className="mt-4 flex flex-col gap-3 rounded-control border border-line p-3">
            <p className="text-sm font-medium">Pool settings</p>
            <div className="flex flex-wrap items-end gap-3">
              <div><label htmlFor={ids.teamLimit} className="mb-1 block text-xs font-medium">Team limit per month (credits)</label><input id={ids.teamLimit} inputMode="decimal" value={teamLimit} onChange={(ev) => setTeamLimit(ev.target.value)} placeholder="No limit" className={`${field} w-36`} /></div>
              <div><label htmlFor={ids.memberLimit} className="mb-1 block text-xs font-medium">Each member per month (credits)</label><input id={ids.memberLimit} inputMode="decimal" value={memberLimit} onChange={(ev) => setMemberLimitText(ev.target.value)} placeholder="No limit" className={`${field} w-36`} /></div>
              <Button size="sm" loading={pending} onClick={() => act(() => setPool(teamId, true, num(teamLimit), num(memberLimit)))}>{ai.pool?.enabled ? "Save settings" : "Turn on shared credits"}</Button>
              {ai.pool?.enabled && <Button size="sm" variant="secondary" loading={pending} onClick={() => act(() => setPool(teamId, false, num(teamLimit), num(memberLimit)))}>Turn off</Button>}
            </div>
            {ai.members.length > 0 && (
              <table className="w-full text-sm"><thead><tr className="text-left text-ink-soft"><th scope="col" className="py-1 font-medium">Member</th><th scope="col" className="py-1 font-medium">Used</th><th scope="col" className="py-1 font-medium">Limit</th><th scope="col" className="py-1"><span className="sr-only">Change</span></th></tr></thead>
                <tbody>{ai.members.map((m) => (
                  <tr key={m.user_id} className="border-t border-line"><td className="py-1.5">{m.full_name}</td><td>{cr(m.used_mcr)}</td><td>{cr(m.allowance_mcr)}{m.override_mcr !== null ? " (custom)" : ""}</td>
                    <td className="text-right"><Button size="sm" variant="text" disabled={pending} onClick={() => { const v = prompt(`Monthly limit for ${m.full_name} in credits (leave empty to use the default)`); if (v !== null) act(() => setMemberLimit(teamId, m.user_id, v.trim() === "" ? null : Number(v))); }}>Set limit</Button></td></tr>))}</tbody></table>
            )}
          </div>
        )}

        {ai.pool?.enabled && (
          <div className="mt-4 flex flex-col gap-3">
            <form className="flex flex-wrap items-end gap-3" onSubmit={(ev) => { ev.preventDefault(); act(() => requestMoreCredits(teamId, Number(reqCredits), reason)); }}>
              <div><label htmlFor={ids.req} className="mb-1 block text-xs font-medium">Ask for more credits this month</label><input id={ids.req} inputMode="decimal" value={reqCredits} onChange={(ev) => setReqCredits(ev.target.value)} className={`${field} w-28`} /></div>
              <div><label htmlFor={ids.reason} className="mb-1 block text-xs font-medium">Why (optional)</label><input id={ids.reason} value={reason} maxLength={500} onChange={(ev) => setReason(ev.target.value)} className={`${field} w-64`} /></div>
              <Button size="sm" type="submit" variant="secondary" loading={pending}>Send request</Button>
            </form>
            {ai.requests.length > 0 && (
              <ul className="divide-y divide-line rounded-control border border-line text-sm">
                {ai.requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                    <span>{r.full_name}{r.user_id === userId ? " (you)" : ""} asked for {cr(r.requested_mcr)}{r.reason ? `: ${r.reason}` : ""}. <strong className="font-medium">{r.status === "approved" ? `Approved ${cr(r.granted_mcr)}` : r.status === "denied" ? "Declined" : "Waiting"}</strong></span>
                    {isAdmin && r.status === "pending" && <span className="flex gap-2"><Button size="sm" loading={pending} onClick={() => act(() => decideRequest(teamId, r.id, true, r.requested_mcr / 1000))}>Approve</Button><Button size="sm" variant="secondary" loading={pending} onClick={() => act(() => decideRequest(teamId, r.id, false, null))}>Decline</Button></span>}
                  </li>))}
              </ul>
            )}
          </div>
        )}

        {isAdmin && ai.transactions.length > 0 && (
          <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium text-ink-soft">Pool ledger</summary>
            <ul className="mt-2 divide-y divide-line">{ai.transactions.map((t, i) => <li key={i} className="flex justify-between gap-3 py-1.5"><span>{t.kind.replace("_", " ")}{t.user ? `, ${t.user}` : ""}{t.note ? `, ${t.note}` : ""}</span><span>{t.amount_mcr > 0 ? "+" : ""}{(t.amount_mcr / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}</span></li>)}</ul></details>
        )}
      </section>
    </div>
  );
}

"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/admin/auth";
import { Field, buttonCls, dangerButtonCls, inputCls } from "@/components/admin/ui";
import { investigateAction, teamCreditAction, teamPoolAction, withdrawInvitationAction, type PersonResult } from "./actions";

function Result({ state }: { state: ActionResult | undefined }) {
  if (!state) return null;
  return <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success-ink" : "text-danger-ink"}`}>{state.ok ? state.message : state.error}</p>;
}
const Reason = () => <Field label="Reason" hint="At least 10 characters. Saved in the audit log."><textarea name="reason" required minLength={10} maxLength={500} rows={2} className={`${inputCls} h-auto py-2`} /></Field>;

export function WithdrawForm({ kind, id }: { kind: string; id: string }) {
  const [state, action, pending] = useActionState(withdrawInvitationAction, undefined);
  return (
    <form action={action} className="flex min-w-48 flex-col gap-1">
      <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`w-${id}`}>Reason for withdrawing this invitation</label>
      <input id={`w-${id}`} name="reason" required minLength={10} maxLength={500} placeholder="Reason (10+ characters)" className={inputCls} />
      <button type="submit" disabled={pending} className={dangerButtonCls}>{pending ? "Working..." : "Withdraw"}</button>
      <Result state={state} />
    </form>
  );
}

export function TeamCreditForm({ teamId, disabled }: { teamId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(teamCreditAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="team" value={teamId} />
      <Field label="Credits to add to the pool" hint="Capped by the administrator grant limits."><input name="credits" type="number" min={1} required className={inputCls} /></Field>
      <Reason />
      <button type="submit" disabled={pending || disabled} className={buttonCls}>{pending ? "Working..." : "Add credits"}</button>
      <Result state={state} />
    </form>
  );
}

export function TeamPoolForm({ teamId, enabled, disabled }: { teamId: string; enabled: boolean; disabled: boolean }) {
  const [state, action, pending] = useActionState(teamPoolAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="team" value={teamId} /><input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
      <Reason />
      <button type="submit" disabled={pending || disabled} className={enabled ? dangerButtonCls : buttonCls}>{pending ? "Working..." : enabled ? "Switch shared credits off" : "Switch shared credits on"}</button>
      <Result state={state} />
    </form>
  );
}

export function InvestigateForm() {
  const [state, action, pending] = useActionState<PersonResult | undefined, FormData>(investigateAction, undefined);
  return (
    <div className="space-y-4">
      <form action={action} className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Field label="Exact email address"><input name="email" type="email" required autoComplete="off" className={inputCls} /></Field>
        <Field label="Reason" hint="At least 10 characters. Saved in the audit log."><input name="reason" required minLength={10} maxLength={500} className={inputCls} /></Field>
        <div><button type="submit" disabled={pending} className={buttonCls}>{pending ? "Looking..." : "Look up access"}</button></div>
      </form>
      {state && !state.ok && <p role="alert" className="text-sm text-danger-ink">{state.error}</p>}
      {state?.ok && (
        <pre aria-label="Access report" className="max-h-96 overflow-auto rounded-card border border-line bg-surface p-3 text-xs">{JSON.stringify(state.data, null, 2)}</pre>
      )}
    </div>
  );
}

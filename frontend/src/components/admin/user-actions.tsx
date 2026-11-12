"use client";

import { useActionState } from "react";
import { suspensionAction, grantAction, revokeAction } from "@/app/admin/users/[id]/actions";
import type { ActionResult } from "@/lib/admin/auth";
import { Field, buttonCls, dangerButtonCls, inputCls } from "./ui";

// The forms for changing an account. Each one needs a reason, which is saved with the change in the audit log.

function Result({ state }: { state: ActionResult | undefined }) {
  if (!state) return null;
  return <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success-ink" : "text-danger-ink"}`}>{state.ok ? state.message : state.error}</p>;
}
const Reason = () => <Field label="Reason" hint="At least 10 characters. Saved in the audit log."><textarea name="reason" required minLength={10} maxLength={500} rows={2} className={`${inputCls} h-auto py-2`} /></Field>;

export function SuspensionForm({ userId, suspended, disabled }: { userId: string; suspended: boolean; disabled: boolean }) {
  const [state, action, pending] = useActionState(suspensionAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="user" value={userId} /><input type="hidden" name="suspend" value={suspended ? "0" : "1"} />
      <Reason />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending || disabled} className={suspended ? buttonCls : dangerButtonCls}>{pending ? "Working..." : suspended ? "Restore access" : "Suspend account"}</button>
        {disabled && <span className="type-caption">Administrators cannot be suspended.</span>}
      </div>
      <Result state={state} />
    </form>
  );
}

export function GrantForm({ userId, maxCredits }: { userId: string; maxCredits: number }) {
  const [state, action, pending] = useActionState(grantAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="user" value={userId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Credits" hint={`1 to ${maxCredits} per grant`}><input name="credits" type="number" min={1} max={maxCredits} step={1} required className={inputCls} /></Field>
        <Field label="Valid for (days)" hint="1 to 365"><input name="days" type="number" min={1} max={365} step={1} defaultValue={30} required className={inputCls} /></Field>
      </div>
      <Reason />
      <button type="submit" disabled={pending} className={buttonCls}>{pending ? "Working..." : "Grant promotional credits"}</button>
      <Result state={state} />
    </form>
  );
}

export function RevokeForm({ userId, lotId }: { userId: string; lotId: string }) {
  const [state, action, pending] = useActionState(revokeAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="user" value={userId} /><input type="hidden" name="lot" value={lotId} />
      <label className="flex flex-col gap-1 text-xs"><span className="sr-only">Reason for taking back this grant</span>
        <input name="reason" required minLength={10} maxLength={500} placeholder="Reason (10+ characters)" className={`${inputCls} h-8 w-56 text-xs`} /></label>
      <button type="submit" disabled={pending} className={`${dangerButtonCls} h-8 px-3 text-xs`}>{pending ? "Working..." : "Take back unused"}</button>
      <Result state={state} />
    </form>
  );
}

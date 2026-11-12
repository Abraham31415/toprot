"use client";

import { useActionState } from "react";
import { featureLimitsAction, settingAction } from "@/app/admin/settings/actions";
import type { ActionResult } from "@/lib/admin/auth";
import { buttonCls, inputCls } from "./ui";

function Result({ state }: { state: ActionResult | undefined }) {
  if (!state) return null;
  return <p role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-success-ink" : "text-danger-ink"}`}>{state.ok ? state.message : state.error}</p>;
}

/** One numeric setting. Changing it needs a reason, which is saved with the old and new value in the audit log. */
export function SettingForm({ id, label, hint, current, unit, disabled }: { id: string; label: string; hint: string; current: string; unit?: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(settingAction, undefined);
  return (
    <form action={action} className="grid gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_auto] sm:items-end">
      <input type="hidden" name="key" value={id} />
      <div className="min-w-0"><p className="text-sm font-medium text-ink">{label}</p>{hint && <p className="type-caption">{hint}</p>}<p className="type-caption">Now: <span className="text-ink">{current}</span>{unit ? ` ${unit}` : ""}</p></div>
      <label className="text-xs"><span className="sr-only">New value for {label}</span><input name="value" type="number" step="any" min={0} required disabled={disabled} placeholder="New value" className={inputCls} /></label>
      <label className="text-xs"><span className="sr-only">Reason</span><input name="reason" required minLength={10} maxLength={500} disabled={disabled} placeholder="Reason (10+ characters)" className={inputCls} /></label>
      <button type="submit" disabled={pending || disabled} className={buttonCls}>{pending ? "Saving..." : "Save"}</button>
      <div className="sm:col-span-4"><Result state={state} /></div>
    </form>
  );
}

export function FeatureLimitsForm({ feature, iterations, toolCalls, opCostUsd, enabled, disabled }: { feature: string; iterations: number; toolCalls: number; opCostUsd: number; enabled: boolean; disabled: boolean }) {
  const [state, action, pending] = useActionState(featureLimitsAction, undefined);
  return (
    <form action={action} className="grid gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-[8rem_repeat(3,5.5rem)_6rem_minmax(0,1fr)_auto] sm:items-end">
      <input type="hidden" name="feature" value={feature} />
      <p className="text-sm font-medium text-ink">{feature}</p>
      <label className="text-xs"><span className="block text-ink-muted">Iterations</span><input name="iterations" type="number" min={1} max={40} defaultValue={iterations} disabled={disabled} className={inputCls} /></label>
      <label className="text-xs"><span className="block text-ink-muted">Tool calls</span><input name="toolCalls" type="number" min={0} max={200} defaultValue={toolCalls} disabled={disabled} className={inputCls} /></label>
      <label className="text-xs"><span className="block text-ink-muted">Max cost (USD)</span><input name="opCost" type="number" min={0.01} max={50} step="0.01" defaultValue={opCostUsd} disabled={disabled} className={inputCls} /></label>
      <label className="text-xs"><span className="block text-ink-muted">Enabled</span><select name="enabled" defaultValue={enabled ? "1" : "0"} disabled={disabled} className={inputCls}><option value="1">Yes</option><option value="0">No</option></select></label>
      <label className="text-xs"><span className="block text-ink-muted">Reason</span><input name="reason" required minLength={10} maxLength={500} disabled={disabled} placeholder="10+ characters" className={inputCls} /></label>
      <button type="submit" disabled={pending || disabled} className={buttonCls}>{pending ? "Saving..." : "Save"}</button>
      <div className="sm:col-span-7"><Result state={state} /></div>
    </form>
  );
}

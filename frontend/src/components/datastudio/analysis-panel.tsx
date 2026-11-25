"use client";

import { useMemo, useState } from "react";
import { Lock, Play, Sparkles, Wand2, X } from "lucide-react";
import { Button } from "@/components/ds";
import Link from "next/link";
import { CATEGORIES, METHODS, METHOD_BY_ID, type Field, type MethodDef } from "@/lib/datastudio/engine/registry";
import { TIER_LABEL, canUseMethod, upgradePrompt, type Tier } from "@/lib/datastudio/entitlements";
import { distinctPresent, fitsFilter, validateParams } from "@/lib/datastudio/engine/params";
import { suggest, type WizardAnswers } from "@/lib/datastudio/wizard";
import type { Dataset } from "@/lib/datastudio/types";

export function AnalysisPanel({ dataset, tier, plan, canRun, running, onRun }: { dataset: Dataset; tier: Tier; plan?: string; canRun: boolean; running: boolean; onRun: (method: string, params: Record<string, unknown>) => void }) {
  const [method, setMethod] = useState<string>("describe");
  const [params, setParams] = useState<Record<string, Record<string, unknown>>>({});
  const [wizard, setWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const def = METHOD_BY_ID.get(method)!;
  const p = params[method] ?? {};
  const set = (k: string, v: unknown) => { setError(null); setParams((s) => ({ ...s, [method]: { ...(s[method] ?? {}), [k]: v } })); };
  const locked = (m: MethodDef) => !canUseMethod(tier, m.id);
  const list = METHODS.filter((m) => !query || `${m.label} ${m.summary} ${m.category}`.toLowerCase().includes(query.toLowerCase()));

  function run() {
    try { validateParams(method, p, dataset); } catch (e) { setError((e as Error).message); return; }
    onRun(method, p);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <nav aria-label="Statistical methods" className="space-y-3">
        <div className="flex gap-2">
          <input type="search" placeholder="Search methods" aria-label="Search methods" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 rounded-control border border-line-strong px-3 py-2 text-sm" />
          <button type="button" onClick={() => setWizard(true)} className="inline-flex items-center gap-1 rounded-control border border-line-strong px-3 text-sm text-primary hover:border-primary" title="Help me choose a test"><Wand2 className="h-4 w-4" aria-hidden="true" />Guide</button>
        </div>
        {CATEGORIES.map((cat) => {
          const items = list.filter((m) => m.category === cat);
          if (!items.length) return null;
          return (
            <div key={cat}>
              <p className="type-eyebrow px-1">{cat}</p>
              <ul className="mt-1 space-y-0.5">
                {items.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => { setMethod(m.id); setError(null); }} aria-current={method === m.id ? "true" : undefined}
                      className={`flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-sm ${method === m.id ? "bg-surface-soft text-primary-hover" : "text-ink-soft hover:bg-hover"}`}>
                      <span>{m.label}</span>{locked(m) && <Lock className="h-3.5 w-3.5 flex-none text-ink-muted" aria-label={`Included in ${TIER_LABEL[m.tier]}`} />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <section aria-labelledby="method-h" className="min-w-0 space-y-4" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); if (canRun && !locked(def) && !running) run(); } }}>
        {wizard && <Wizard onClose={() => setWizard(false)} onPick={(m) => { setMethod(m); setWizard(false); }} />}
        <div>
          <h3 id="method-h" className="type-card">{def.label}</h3>
          <p className="type-support mt-1">{def.summary}</p>
          {locked(def) && <p className="mt-2 flex flex-wrap items-center gap-1 rounded-control bg-warning-bg px-2 py-1 text-sm text-warning-ink"><Lock className="h-3.5 w-3.5 flex-none" aria-hidden="true" /><span>{upgradePrompt(def, plan)}</span> <Link href="/pricing" className="font-medium underline">Compare plans</Link></p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {def.fields.map((f) => <FieldInput key={f.key} field={f} value={p[f.key]} params={p} dataset={dataset} onChange={(v) => set(f.key, v)} />)}
        </div>
        <details className="rounded-control border border-line bg-canvas p-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink">Assumptions and what to check before trusting the result</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">{def.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          <p className="mt-2 text-ink-muted">Missing data: rows with a missing value in any chosen variable are excluded (complete-case analysis); the result reports how many.</p>
        </details>
        {error && <p role="alert" className="rounded-control border border-danger-line bg-danger-bg p-2 text-sm text-danger-ink">{error}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={run} loading={running} disabled={!canRun || locked(def)}><Play className="h-4 w-4" aria-hidden="true" />Run analysis</Button>
          {!canRun && <span className="type-support">You have read-only access to this project.</span>}
          <span className="type-caption">Ctrl+Enter</span>
        </div>
      </section>
    </div>
  );
}

function VariableSelect({ dataset, field, value, onChange, multiple }: { dataset: Dataset; field: Field; value: unknown; onChange: (v: unknown) => void; multiple?: boolean }) {
  const [q, setQ] = useState("");
  const options = useMemo(() => dataset.variables.filter((v) => !fitsFilter(dataset, v.name, field.filter)), [dataset, field.filter]);
  if (!multiple) {
    return (
      <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className="mt-1 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm">
        <option value="">{field.required ? "Choose…" : "None"}</option>
        {options.map((v) => <option key={v.name} value={v.name}>{v.name}{v.label ? ` (${v.label})` : ""}</option>)}
      </select>
    );
  }
  const sel = (value as string[]) ?? [];
  const shown = options.filter((v) => !q || `${v.name} ${v.label ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="mt-1 rounded-control border border-line-strong bg-surface">
      {sel.length > 0 && <div className="flex flex-wrap gap-1 border-b border-line p-1.5">{sel.map((s) => <span key={s} className="inline-flex items-center gap-1 rounded bg-surface-soft px-1.5 py-0.5 text-xs text-ink">{s}<button type="button" aria-label={`Remove ${s}`} onClick={() => onChange(sel.filter((x) => x !== s))}><X className="h-3 w-3" aria-hidden="true" /></button></span>)}</div>}
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search variables" aria-label={`Search ${field.label}`} className="w-full border-0 border-b border-line px-2 py-1 text-sm" />
      <ul className="max-h-36 overflow-y-auto p-1">
        {shown.map((v) => (
          <li key={v.name}><label className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-hover"><input type="checkbox" checked={sel.includes(v.name)} onChange={(e) => onChange(e.target.checked ? [...sel, v.name] : sel.filter((x) => x !== v.name))} />{v.name}{v.label && <span className="truncate text-ink-muted">{v.label}</span>}</label></li>
        ))}
        {!shown.length && <li className="px-1 text-xs text-ink-muted">No suitable variables.</li>}
      </ul>
    </div>
  );
}

function FieldInput({ field, value, params, dataset, onChange }: { field: Field; value: unknown; params: Record<string, unknown>; dataset: Dataset; onChange: (v: unknown) => void }) {
  const wide = field.kind === "variables" || field.kind === "pairs";
  const label = <span className="type-label">{field.label}{field.required && <span className="text-danger-ink"> *</span>}</span>;
  let input: React.ReactNode;
  switch (field.kind) {
    case "variable": input = <VariableSelect dataset={dataset} field={field} value={value} onChange={onChange} />; break;
    case "variables": input = <VariableSelect dataset={dataset} field={field} value={value} onChange={onChange} multiple />; break;
    case "level": {
      const parent = params[field.levelOf!] as string | undefined;
      const v = dataset.variables.find((x) => x.name === parent);
      const lv = parent ? distinctPresent(dataset, parent, 60).sort() : [];
      input = <select disabled={!parent} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className="mt-1 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm disabled:bg-disabled-bg"><option value="">{parent ? "Default" : "Choose the variable first"}</option>{lv.map((l) => <option key={l} value={l}>{v?.valueLabels?.[l] ? `${l} = ${v.valueLabels[l]}` : l}</option>)}</select>;
      break;
    }
    case "number": input = <input type="number" step="any" value={(value as number | undefined) ?? (field.default as number | undefined) ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="mt-1 w-full rounded-control border border-line-strong px-3 py-2 text-sm" />; break;
    case "select": input = <select value={(value as string) ?? (field.default as string)} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm">{field.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>; break;
    case "boolean": return <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink"><input type="checkbox" checked={value === undefined ? !!field.default : !!value} onChange={(e) => onChange(e.target.checked)} />{field.label}</label>;
    case "pairs": {
      const preds = (params.predictors as string[]) ?? [];
      const pairs = (value as [string, string][]) ?? [];
      const all: [string, string][] = [];
      for (let i = 0; i < preds.length; i++) for (let j = i + 1; j < preds.length; j++) all.push([preds[i], preds[j]]);
      input = all.length ? (
        <div className="mt-1 flex flex-wrap gap-2">{all.map(([a, b]) => { const on = pairs.some((x) => x[0] === a && x[1] === b); return <label key={`${a}-${b}`} className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs"><input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? [...pairs, [a, b]] : pairs.filter((x) => !(x[0] === a && x[1] === b)))} />{a} × {b}</label>; })}</div>
      ) : <p className="type-caption mt-1">Choose two or more predictors to add interactions.</p>;
      break;
    }
  }
  // A <label> may wrap only one control, so multi-control fields are a labelled group instead.
  const gid = `f-${field.key}`;
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      {wide ? <div role="group" aria-labelledby={gid}><span id={gid}>{label}</span>{input}</div> : <label className="block">{label}{input}</label>}
      {field.help && <p className="type-caption mt-1">{field.help}</p>}
    </div>
  );
}

function Wizard({ onClose, onPick }: { onClose: () => void; onPick: (m: string) => void }) {
  const [a, setA] = useState<WizardAnswers>({ objective: "compare", outcome: "continuous", groups: 2, paired: false, clustered: false, normal: "unsure", design: "cross_sectional" });
  const s = suggest(a);
  const sel = (k: keyof WizardAnswers, opts: [string, string][], lab: string) => (
    <label className="type-label">{lab}<select value={String(a[k] ?? "")} onChange={(e) => setA({ ...a, [k]: k === "groups" ? Number(e.target.value) : e.target.value === "true" ? true : e.target.value === "false" ? false : e.target.value })} className="mt-1 w-full rounded-control border border-line-strong bg-surface px-2 py-1.5 text-sm">{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
  );
  return (
    <div role="dialog" aria-label="Choose a statistical test" className="rounded-card border border-info-line bg-info-bg p-4">
      <div className="flex items-start justify-between"><h3 className="type-card">Which test fits my question?</h3><button type="button" onClick={onClose} aria-label="Close"><X className="h-4 w-4" aria-hidden="true" /></button></div>
      <p className="type-support mt-1">Answer from your study design. Suggestions follow fixed rules; they are a starting point, not a verdict.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {sel("objective", [["describe", "Describe data"], ["compare", "Compare groups or conditions"], ["relate", "Measure association"], ["predict", "Model or predict an outcome"], ["agreement", "Agreement or reliability"], ["diagnostic", "Evaluate a diagnostic test"], ["survival", "Time to an event"]], "Objective")}
        {sel("outcome", [["continuous", "Continuous (measurement)"], ["ordinal", "Ordinal (ranked categories)"], ["binary", "Binary (yes/no)"], ["nominal", "Several categories"], ["count", "Count"], ["time_to_event", "Time to event"]], "Outcome type")}
        {sel("groups", [["1", "One group"], ["2", "Two"], ["3", "Three or more"]], "Groups or conditions")}
        {sel("paired", [["false", "Independent (different people)"], ["true", "Paired or repeated (same people)"]], "Observations")}
        {sel("clustered", [["false", "No"], ["true", "Yes (clinics, households, many visits)"]], "Clustered data?")}
        {sel("normal", [["unsure", "Not sure"], ["yes", "Roughly normal"], ["no", "Skewed or outliers"]], "Distribution")}
        {sel("design", [["cross_sectional", "Cross-sectional"], ["cohort", "Cohort"], ["case_control", "Case-control"], ["rct", "Randomised trial"], ["other", "Other"]], "Study design")}
        {sel("confounders", [["false", "No"], ["true", "Yes"]], "Adjust for confounders?")}
        {sel("factorial", [["false", "One"], ["true", "Two or more (factorial design)"]], "Grouping factors")}
      </div>
      <ul className="mt-4 space-y-2">
        {s.map((x, i) => (
          <li key={i} className={`rounded-control border bg-surface p-3 text-sm ${x.primary ? "border-primary" : "border-line"}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-ink">{x.primary && <span className="mr-1 text-xs font-semibold text-primary">Suggested</span>}{x.label}</p>
              {x.method && <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => onPick(x.method!)}>Use this</button>}
            </div>
            <p className="mt-1 text-ink-soft">{x.why}</p>
            {x.caveats.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-ink-muted">{x.caveats.map((c, k) => <li key={k}>{c}</li>)}</ul>}
          </li>
        ))}
      </ul>
      <p className="type-caption mt-3 inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />You can override any suggestion; the analysis form lists the assumptions to check.</p>
    </div>
  );
}

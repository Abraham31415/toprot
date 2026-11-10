"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Field } from "@/lib/tools/types";

type Row = Record<string, string>;

function parse(value: string): Row[] {
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** A repeating table of rows. The value is a JSON array of objects, so it travels as an ordinary string. */
export function RowsEditor({ field, value, onChange }: { field: Field; value: string; onChange: (next: string) => void }) {
  const cols = field.columns ?? [];
  const rows = parse(value);
  const set = (next: Row[]) => onChange(JSON.stringify(next));
  const blank = (): Row => Object.fromEntries(cols.map((c) => [c.id, c.kind === "select" ? (c.options?.[0]?.value ?? "") : ""]));
  const cls = "w-full min-w-0 rounded-md border border-navy/25 bg-white px-2 py-1.5 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20";

  return (
    <div className="min-w-0 sm:col-span-2">
      <p className="block text-sm font-medium text-navy">{field.label}</p>
      <ul className="mt-2 space-y-3">
        {rows.map((row, i) => (
          <li key={i} className="rounded-lg border border-line bg-paper p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {cols.map((c) => {
                const id = `${field.id}-${i}-${c.id}`;
                return (
                  <div key={c.id} className={`min-w-0 ${c.id === "text" || c.id === "definition" || c.id === "name" ? "sm:col-span-2" : ""}`}>
                    <label htmlFor={id} className="block text-xs font-medium text-navy/70">{c.label}</label>
                    {c.kind === "select" ? (
                      <select id={id} className={cls} value={row[c.id] ?? ""} onChange={(e) => set(rows.map((r, j) => (j === i ? { ...r, [c.id]: e.target.value } : r)))}>
                        {c.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input id={id} type="text" className={cls} placeholder={c.placeholder} value={row[c.id] ?? ""} onChange={(e) => set(rows.map((r, j) => (j === i ? { ...r, [c.id]: e.target.value } : r)))} />
                    )}
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => set(rows.filter((_, j) => j !== i))} className="mt-2 inline-flex items-center gap-1 text-xs text-navy/60 hover:text-red-700">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove row
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => set([...rows, blank()])} className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt hover:text-cobalt">
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add row
      </button>
      {field.help && <p className="mt-2 text-xs text-navy/65">{field.help}</p>}
    </div>
  );
}

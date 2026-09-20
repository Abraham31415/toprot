"use client";

import type { VariableRow } from "@/lib/protocol/types";

export function DataDictionaryPreview({ variables }: { variables: VariableRow[] }) {
  const rows = variables.filter((v) => v.variable_name.trim());

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Data dictionary</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Live preview, built from the Variables section.
      </p>

      {!rows.length ? (
        <p className="mt-4 text-sm text-zinc-400 dark:text-zinc-600">No variables yet.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {rows.map((v) => (
            <div key={v.id} className="rounded-lg border border-zinc-100 p-2.5 dark:border-zinc-900">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {v.variable_name}
              </p>
              <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {v.variable_slug}
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {v.variable_type} · {v.role}
                {v.unit && ` · ${v.unit}`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import type { VariableRow } from "@/lib/protocol/types";

export function DataDictionaryPreview({ variables }: { variables: VariableRow[] }) {
  const rows = variables.filter((v) => v.variable_name.trim());

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <h3 className="text-sm font-semibold text-navy">Data dictionary</h3>
      <p className="mt-1 text-xs text-navy/65">
        Live preview, built from the Variables section.
      </p>

      {!rows.length ? (
        <p className="mt-4 text-sm text-navy/55">No variables yet.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {rows.map((v) => (
            <div key={v.id} className="rounded-lg border border-line p-2.5">
              <p className="text-sm font-medium text-navy">
                {v.variable_name}
              </p>
              <p className="font-mono text-xs text-navy/65">
                {v.variable_slug}
              </p>
              <p className="mt-1 text-xs text-navy/65">
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

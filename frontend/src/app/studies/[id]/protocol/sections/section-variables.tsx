"use client";

import { useState } from "react";
import type { VariableRole, VariableRow, VariableType } from "@/lib/protocol/types";
import { VARIABLE_ROLES, VARIABLE_TYPES } from "@/lib/protocol/types";
import { slugify, uniqueSlug } from "@/lib/protocol/slug";
import { SaveBar } from "./form-controls";
import { useSaveController } from "./use-section-save";
import { saveVariables } from "../actions";

type DraftVariable = {
  variable_name: string;
  variable_type: VariableType;
  role: VariableRole;
  unit: string;
  measurement_timepoint: string;
  description: string;
};

function toDraft(v: VariableRow): DraftVariable {
  return {
    variable_name: v.variable_name,
    variable_type: v.variable_type,
    role: v.role,
    unit: v.unit ?? "",
    measurement_timepoint: v.measurement_timepoint ?? "",
    description: v.description ?? "",
  };
}

const emptyDraft = (): DraftVariable => ({
  variable_name: "",
  variable_type: "continuous",
  role: "other",
  unit: "",
  measurement_timepoint: "",
  description: "",
});

export function SectionVariables({
  versionId,
  studyId,
  variables,
  onChange,
  readOnly,
}: {
  versionId: string;
  studyId: string;
  variables: VariableRow[];
  onChange: (variables: VariableRow[]) => void;
  readOnly: boolean;
}) {
  const [drafts, setDrafts] = useState<DraftVariable[]>(
    variables.length ? variables.map(toDraft) : [emptyDraft()],
  );
  // Variables are saved with a replace-all write, which is atomic in the database (one transaction), so it
  // is safe to autosave; a failed save leaves the previous rows intact.
  const { save, pending, savedAt, error, dirty } = useSaveController(
    async (current: DraftVariable[]) => {
      const taken = new Set<string>();
      const payload = current
        .filter((d) => d.variable_name.trim())
        .map((d) => {
          const slug = uniqueSlug(d.variable_name, taken);
          taken.add(slug);
          return {
            variable_name: d.variable_name.trim(),
            variable_slug: slug,
            variable_type: d.variable_type,
            role: d.role,
            unit: d.unit || null,
            value_labels: null,
            measurement_timepoint: d.measurement_timepoint || null,
            description: d.description || null,
          };
        });
      const result = await saveVariables(versionId, studyId, payload);
      return result.error ? { error: result.error } : { savedAt: Date.now() };
    },
    readOnly ? null : drafts,
    true,
  );

  function recompute(next: DraftVariable[]) {
    setDrafts(next);
    const taken = new Set<string>();
    const rows: VariableRow[] = next.map((d, i) => {
      const slug = d.variable_name.trim() ? uniqueSlug(d.variable_name, taken) : "";
      if (slug) taken.add(slug);
      return {
        id: variables[i]?.id ?? `draft-${i}`,
        variable_name: d.variable_name,
        variable_slug: slug || slugify(`var_${i + 1}`),
        variable_type: d.variable_type,
        role: d.role,
        unit: d.unit || null,
        value_labels: null,
        measurement_timepoint: d.measurement_timepoint || null,
        description: d.description || null,
        display_order: i,
      };
    });
    onChange(rows);
  }

  function update(i: number, patch: Partial<DraftVariable>) {
    recompute(drafts.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-navy">Variables</h2>
        <p className="text-sm text-navy/65">
          Names auto-slug to snake_case on the right, matching the generated Stata code.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {drafts.map((d, i) => (
          <div
            key={i}
            className="grid grid-cols-1 gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto] sm:items-center"
          >
            <input
              value={d.variable_name}
              disabled={readOnly}
              onChange={(e) => update(i, { variable_name: e.target.value })}
              placeholder="Variable name, e.g. Birth weight"
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-navy outline-none focus:border-navy/35 disabled:opacity-60"
            />
            <select
              value={d.variable_type}
              disabled={readOnly}
              onChange={(e) => update(i, { variable_type: e.target.value as VariableType })}
              className="rounded-lg border border-line bg-white px-2 py-2 text-sm text-navy outline-none disabled:opacity-60"
            >
              {VARIABLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={d.role}
              disabled={readOnly}
              onChange={(e) => update(i, { role: e.target.value as VariableRole })}
              className="rounded-lg border border-line bg-white px-2 py-2 text-sm text-navy outline-none disabled:opacity-60"
            >
              {VARIABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              value={d.unit}
              disabled={readOnly}
              onChange={(e) => update(i, { unit: e.target.value })}
              placeholder="Unit"
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-navy outline-none disabled:opacity-60"
            />
            {!readOnly && (
              <button
                type="button"
                onClick={() => recompute(drafts.filter((_, idx) => idx !== i))}
                className="rounded-lg border border-line px-2.5 py-2 text-navy/65 hover:bg-navy/5"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            onClick={() => recompute([...drafts, emptyDraft()])}
            className="self-start text-sm font-medium text-navy/75 hover:text-navy"
          >
            + Add variable
          </button>
        )}
      </div>

      <SaveBar onSave={save} pending={pending} savedAt={savedAt} error={error} dirty={dirty} disabled={readOnly} />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { ObjectiveRow, ObjectiveType, ProtocolVersionRow } from "@/lib/protocol/types";
import { TextAreaField, SaveBar } from "./form-controls";
import { saveObjectives, saveProtocolSection } from "../actions";
import { useProtocolLive } from "../protocol-context";
import { useSaveController } from "./use-section-save";

type DraftObjective = { objective_type: ObjectiveType; description: string };

export function SectionObjectives({
  version,
  objectives,
  studyId,
  readOnly,
}: {
  version: ProtocolVersionRow;
  objectives: ObjectiveRow[];
  studyId: string;
  readOnly: boolean;
}) {
  const [researchQuestion, setResearchQuestion] = useState(version.research_question ?? "");
  const [items, setItems] = useState<DraftObjective[]>(
    objectives.length
      ? objectives.map((o) => ({ objective_type: o.objective_type, description: o.description }))
      : [{ objective_type: "primary", description: "" }],
  );
  // Objectives are saved with a replace-all write, which is atomic in the database (one transaction), so it
  // is safe to autosave; a failed save leaves the previous rows intact.
  const { save, pending, savedAt, error, dirty } = useSaveController(
    async (p: { researchQuestion: string; items: DraftObjective[] }) => {
      const [sectionResult, objectivesResult] = await Promise.all([
        saveProtocolSection(version.id, studyId, { research_question: p.researchQuestion }),
        saveObjectives(version.id, studyId, p.items),
      ]);
      const err = sectionResult.error ?? objectivesResult.error;
      return err ? { error: err } : { savedAt: Date.now() };
    },
    readOnly ? null : { researchQuestion, items },
    true,
  );
  const { update: updateLive } = useProtocolLive();

  useEffect(() => {
    updateLive({ research_question: researchQuestion, objectives: items });
  }, [researchQuestion, items, updateLive]);

  function update(i: number, patch: Partial<DraftObjective>) {
    setItems((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
        Research question &amp; objectives
      </h2>
      <TextAreaField
        label="Research question"
        value={researchQuestion}
        onChange={setResearchQuestion}
        disabled={readOnly}
      />

      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Objectives</span>
        {items.map((o, i) => (
          <div key={i} className="flex gap-2">
            <select
              value={o.objective_type}
              disabled={readOnly}
              onChange={(e) => update(i, { objective_type: e.target.value as ObjectiveType })}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
            </select>
            <input
              value={o.description}
              disabled={readOnly}
              onChange={(e) => update(i, { description: e.target.value })}
              placeholder="Describe the objective"
              className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
            />
            {!readOnly && (
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                className="rounded-lg border border-zinc-200 px-2.5 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, { objective_type: "secondary", description: "" }])}
            className="self-start text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            + Add objective
          </button>
        )}
      </div>

      <SaveBar onSave={save} pending={pending} savedAt={savedAt} error={error} dirty={dirty} disabled={readOnly} />
    </div>
  );
}

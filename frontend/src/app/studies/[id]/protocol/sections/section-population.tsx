"use client";

import { useEffect, useState } from "react";
import type { ProtocolVersionRow } from "@/lib/protocol/types";
import { TextField, SaveBar } from "./form-controls";
import { CriteriaList } from "./criteria-list";
import { useSectionSave } from "./use-section-save";
import { useProtocolLive } from "../protocol-context";

export function SectionPopulation({
  version,
  studyId,
  readOnly,
}: {
  version: ProtocolVersionRow;
  studyId: string;
  readOnly: boolean;
}) {
  const [targetPopulation, setTargetPopulation] = useState(version.target_population ?? "");
  const [setting, setSetting] = useState(version.setting ?? "");
  const [inclusion, setInclusion] = useState<string[]>(version.inclusion_criteria ?? []);
  const [exclusion, setExclusion] = useState<string[]>(version.exclusion_criteria ?? []);
  const { save, pending, savedAt, error } = useSectionSave(version.id, studyId);
  const { update } = useProtocolLive();

  useEffect(() => {
    update({
      target_population: targetPopulation,
      setting,
      inclusion_criteria: inclusion,
      exclusion_criteria: exclusion,
    });
  }, [targetPopulation, setting, inclusion, exclusion, update]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
        Population and eligibility
      </h2>
      <TextField label="Target population" value={targetPopulation} onChange={setTargetPopulation} disabled={readOnly} />
      <TextField label="Setting" value={setting} onChange={setSetting} placeholder="e.g. NICU, Mulago Hospital" disabled={readOnly} />
      <CriteriaList label="Inclusion criteria" items={inclusion} onChange={setInclusion} readOnly={readOnly} />
      <CriteriaList label="Exclusion criteria" items={exclusion} onChange={setExclusion} readOnly={readOnly} />
      <SaveBar
        onSave={() =>
          save({
            target_population: targetPopulation,
            setting,
            inclusion_criteria: inclusion.filter((c) => c.trim()),
            exclusion_criteria: exclusion.filter((c) => c.trim()),
          })
        }
        pending={pending}
        savedAt={savedAt}
        error={error}
        disabled={readOnly}
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { ProtocolVersionRow } from "@/lib/protocol/types";
import { TextField, TextAreaField, SaveBar } from "./form-controls";
import { useSectionSave } from "./use-section-save";
import { useProtocolLive } from "../protocol-context";

export function SectionStatistics({
  version,
  studyId,
  readOnly,
}: {
  version: ProtocolVersionRow;
  studyId: string;
  readOnly: boolean;
}) {
  const [fields, setFields] = useState({
    statistical_methods: version.statistical_methods ?? "",
    primary_analysis: version.primary_analysis ?? "",
    significance_level: String(version.significance_level ?? 0.05),
    analysis_software: version.analysis_software ?? "Stata",
  });
  const { save, pending, savedAt, error } = useSectionSave(version.id, studyId);
  const { update } = useProtocolLive();
  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    update({
      statistical_methods: fields.statistical_methods,
      primary_analysis: fields.primary_analysis,
      significance_level: parseFloat(fields.significance_level) || null,
    });
  }, [fields, update]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Statistical plan</h2>
      <TextAreaField
        label="Statistical methods"
        value={fields.statistical_methods}
        onChange={set("statistical_methods")}
        disabled={readOnly}
      />
      <TextAreaField
        label="Primary analysis"
        value={fields.primary_analysis}
        onChange={set("primary_analysis")}
        disabled={readOnly}
      />
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="Significance level (alpha)"
          type="number"
          value={fields.significance_level}
          onChange={set("significance_level")}
          disabled={readOnly}
        />
        <TextField
          label="Analysis software"
          value={fields.analysis_software}
          onChange={set("analysis_software")}
          disabled={readOnly}
        />
      </div>
      <SaveBar
        onSave={() =>
          save({ ...fields, significance_level: parseFloat(fields.significance_level) || null })
        }
        pending={pending}
        savedAt={savedAt}
        error={error}
        disabled={readOnly}
      />
    </div>
  );
}

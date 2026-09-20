"use client";

import { useEffect, useState } from "react";
import type { ProtocolVersionRow } from "@/lib/protocol/types";
import { TextField, SaveBar } from "./form-controls";
import { useSectionSave } from "./use-section-save";
import { useProtocolLive } from "../protocol-context";

export function SectionIdentity({
  version,
  studyId,
  readOnly,
}: {
  version: ProtocolVersionRow;
  studyId: string;
  readOnly: boolean;
}) {
  const [fields, setFields] = useState({
    study_title: version.study_title ?? "",
    short_title: version.short_title ?? "",
    study_design: version.study_design ?? "",
    site: version.site ?? "",
    principal_investigator_name: version.principal_investigator_name ?? "",
    anticipated_start_date: version.anticipated_start_date ?? "",
    anticipated_end_date: version.anticipated_end_date ?? "",
  });
  const { save, pending, savedAt, error } = useSectionSave(version.id, studyId);
  const { update } = useProtocolLive();

  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    update({ study_title: fields.study_title, study_design: fields.study_design });
  }, [fields, update]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Study identity</h2>
      <TextField label="Full study title" value={fields.study_title} onChange={set("study_title")} disabled={readOnly} />
      <TextField label="Short title" value={fields.short_title} onChange={set("short_title")} disabled={readOnly} />
      <TextField
        label="Study design"
        value={fields.study_design}
        onChange={set("study_design")}
        placeholder="e.g. prospective cohort, cross-sectional"
        disabled={readOnly}
      />
      <TextField label="Site" value={fields.site} onChange={set("site")} placeholder="e.g. Mulago National Referral Hospital" disabled={readOnly} />
      <TextField
        label="Principal investigator"
        value={fields.principal_investigator_name}
        onChange={set("principal_investigator_name")}
        disabled={readOnly}
      />
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="Anticipated start date"
          type="date"
          value={fields.anticipated_start_date}
          onChange={set("anticipated_start_date")}
          disabled={readOnly}
        />
        <TextField
          label="Anticipated end date"
          type="date"
          value={fields.anticipated_end_date}
          onChange={set("anticipated_end_date")}
          disabled={readOnly}
        />
      </div>
      <SaveBar
        onSave={() =>
          save({
            ...fields,
            anticipated_start_date: fields.anticipated_start_date || null,
            anticipated_end_date: fields.anticipated_end_date || null,
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

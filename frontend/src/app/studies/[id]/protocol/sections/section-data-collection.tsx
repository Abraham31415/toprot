"use client";

import { useState } from "react";
import type { ProtocolVersionRow } from "@/lib/protocol/types";
import { TextAreaField, SaveBar } from "./form-controls";
import { useSectionSave } from "./use-section-save";

export function SectionDataCollection({
  version,
  studyId,
  readOnly,
}: {
  version: ProtocolVersionRow;
  studyId: string;
  readOnly: boolean;
}) {
  const [fields, setFields] = useState({
    data_collection_methods: version.data_collection_methods ?? "",
    data_sources: version.data_sources ?? "",
    data_management_plan: version.data_management_plan ?? "",
  });
  const { save, pending, savedAt, error } = useSectionSave(version.id, studyId);
  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Data collection</h2>
      <TextAreaField
        label="Data collection methods"
        value={fields.data_collection_methods}
        onChange={set("data_collection_methods")}
        disabled={readOnly}
      />
      <TextAreaField
        label="Data sources"
        value={fields.data_sources}
        onChange={set("data_sources")}
        placeholder="e.g. patient charts, ROP screening register, caregiver interview"
        disabled={readOnly}
      />
      <TextAreaField
        label="Data management plan"
        value={fields.data_management_plan}
        onChange={set("data_management_plan")}
        placeholder="Storage, access control, backup, retention"
        disabled={readOnly}
      />
      <SaveBar onSave={() => save(fields)} pending={pending} savedAt={savedAt} error={error} disabled={readOnly} />
    </div>
  );
}

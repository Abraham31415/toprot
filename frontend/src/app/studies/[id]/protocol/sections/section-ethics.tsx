"use client";

import { useEffect, useState } from "react";
import type { ProtocolVersionRow } from "@/lib/protocol/types";
import { TextField, TextAreaField, SaveBar } from "./form-controls";
import { useSectionSave } from "./use-section-save";
import { useProtocolLive } from "../protocol-context";

export function SectionEthics({
  version,
  studyId,
  readOnly,
}: {
  version: ProtocolVersionRow;
  studyId: string;
  readOnly: boolean;
}) {
  const [fields, setFields] = useState({
    ethical_approval_body: version.ethical_approval_body ?? "",
    consent_process: version.consent_process ?? "",
    risks_and_benefits: version.risks_and_benefits ?? "",
    confidentiality_plan: version.confidentiality_plan ?? "",
  });
  const { save, pending, savedAt, error } = useSectionSave(version.id, studyId);
  const { update } = useProtocolLive();
  const set = (k: keyof typeof fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    update({
      ethical_approval_body: fields.ethical_approval_body,
      consent_process: fields.consent_process,
    });
  }, [fields, update]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
        Ethical considerations
      </h2>
      <TextField
        label="Ethical approval body"
        value={fields.ethical_approval_body}
        onChange={set("ethical_approval_body")}
        placeholder="e.g. Makerere University SOM REC"
        disabled={readOnly}
      />
      <TextAreaField label="Consent process" value={fields.consent_process} onChange={set("consent_process")} disabled={readOnly} />
      <TextAreaField
        label="Risks and benefits"
        value={fields.risks_and_benefits}
        onChange={set("risks_and_benefits")}
        disabled={readOnly}
      />
      <TextAreaField
        label="Confidentiality plan"
        value={fields.confidentiality_plan}
        onChange={set("confidentiality_plan")}
        disabled={readOnly}
      />
      <SaveBar onSave={() => save(fields)} pending={pending} savedAt={savedAt} error={error} disabled={readOnly} />
    </div>
  );
}

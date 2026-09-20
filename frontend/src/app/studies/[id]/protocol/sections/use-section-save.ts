"use client";

import { useState, useTransition } from "react";
import { saveProtocolSection } from "../actions";

export function useSectionSave(versionId: string, studyId: string) {
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save(patch: Record<string, unknown>) {
    setError(null);
    startTransition(async () => {
      const result = await saveProtocolSection(versionId, studyId, patch);
      if (result.error) {
        setError(result.error);
      } else {
        setSavedAt(result.savedAt ?? Date.now());
      }
    });
  }

  return { save, pending, savedAt, error };
}

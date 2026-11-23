"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AutosaveController, type SaveOutcome } from "@/lib/protocol/autosave";
import { saveProtocolSection } from "../actions";

/**
 * Generic save hook. `payload` is the current form value (or null when read-only).
 * With auto=true it is saved shortly after the user stops typing; with auto=false it is only
 * tracked as unsaved until save() is called (used for destructive replace-all saves).
 */
export function useSaveController<T>(
  saveFn: (payload: T) => Promise<SaveOutcome>,
  payload: T | null,
  auto: boolean,
) {
  const [ctrl] = useState(() => new AutosaveController<T>({ save: saveFn, auto }, payload));
  const state = useSyncExternalStore(ctrl.subscribe, ctrl.getState, ctrl.getState);
  const key = payload === null ? null : JSON.stringify(payload);

  useEffect(() => {
    ctrl.update(key === null ? null : (JSON.parse(key) as T));
  }, [ctrl, key]);

  useEffect(() => () => ctrl.dispose(), [ctrl]);

  const unsaved = state.status === "dirty" || state.status === "saving";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  return {
    /** Save the latest form value now (manual button and retry). */
    save: () => ctrl.flush(),
    status: state.status,
    pending: state.status === "saving",
    dirty: state.status === "dirty",
    savedAt: state.savedAt,
    error: state.error,
  };
}

/** Autosaving hook for the single-row text sections of the protocol. */
export function useSectionSave(versionId: string, studyId: string, patch: Record<string, unknown> | null) {
  // The values this section had when the page loaded, advanced after each successful save. The server refuses a save if someone else
  // changed these fields in between, so two people editing the same field never overwrite each other silently.
  const base = useRef<Record<string, unknown>>(patch ?? {});
  return useSaveController<Record<string, unknown>>(
    async (p) => {
      const r = await saveProtocolSection(versionId, studyId, p, base.current);
      if (!r.error) base.current = { ...base.current, ...p };
      return r;
    },
    patch,
    true,
  );
}

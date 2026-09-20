"use client";

import { createContext, useContext } from "react";
import type { QualitySnapshot } from "@/lib/protocol/quality";

type ProtocolLiveContextValue = {
  update: (patch: Partial<QualitySnapshot>) => void;
};

export const ProtocolLiveContext = createContext<ProtocolLiveContextValue | null>(null);

/**
 * Lets a section report its current in-progress (not necessarily saved) field
 * values up to the quality panel, so checks re-run as the student types rather
 * than only after they click Save.
 */
export function useProtocolLive() {
  const ctx = useContext(ProtocolLiveContext);
  if (!ctx) throw new Error("useProtocolLive must be used within ProtocolForm");
  return ctx;
}

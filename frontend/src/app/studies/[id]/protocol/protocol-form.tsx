"use client";

import { useState } from "react";
import type { ObjectiveRow, ProtocolVersionRow, VariableRow } from "@/lib/protocol/types";
import { DataDictionaryPreview } from "./data-dictionary-preview";
import { SectionIdentity } from "./sections/section-identity";
import { SectionObjectives } from "./sections/section-objectives";
import { SectionPopulation } from "./sections/section-population";
import { SectionVariables } from "./sections/section-variables";
import { SectionStatistics } from "./sections/section-statistics";
import { SectionSampleSize } from "./sections/section-sample-size";
import { SectionDataCollection } from "./sections/section-data-collection";
import { SectionEthics } from "./sections/section-ethics";

const SECTIONS = [
  { key: "identity", label: "1. Study identity" },
  { key: "objectives", label: "2. Research question & objectives" },
  { key: "population", label: "3. Population & eligibility" },
  { key: "variables", label: "4. Variables" },
  { key: "statistics", label: "5. Statistical plan" },
  { key: "sample_size", label: "6. Sample size" },
  { key: "data_collection", label: "7. Data collection" },
  { key: "ethics", label: "8. Ethical considerations" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

export function ProtocolForm({
  studyId,
  studyTitle,
  version,
  objectives,
  variables: initialVariables,
  readOnly,
}: {
  studyId: string;
  studyTitle: string;
  version: ProtocolVersionRow;
  objectives: ObjectiveRow[];
  variables: VariableRow[];
  readOnly: boolean;
}) {
  const [active, setActive] = useState<SectionKey>("identity");
  const [variables, setVariables] = useState<VariableRow[]>(initialVariables);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{studyTitle}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Protocol v{version.version_number} · {version.status}
            {readOnly && " · read-only"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr_320px]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setActive(s.key)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                active === s.key
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          {active === "identity" && (
            <SectionIdentity version={version} studyId={studyId} readOnly={readOnly} />
          )}
          {active === "objectives" && (
            <SectionObjectives
              version={version}
              objectives={objectives}
              studyId={studyId}
              readOnly={readOnly}
            />
          )}
          {active === "population" && (
            <SectionPopulation version={version} studyId={studyId} readOnly={readOnly} />
          )}
          {active === "variables" && (
            <SectionVariables
              versionId={version.id}
              studyId={studyId}
              variables={variables}
              onChange={setVariables}
              readOnly={readOnly}
            />
          )}
          {active === "statistics" && (
            <SectionStatistics version={version} studyId={studyId} readOnly={readOnly} />
          )}
          {active === "sample_size" && (
            <SectionSampleSize version={version} studyId={studyId} readOnly={readOnly} />
          )}
          {active === "data_collection" && (
            <SectionDataCollection version={version} studyId={studyId} readOnly={readOnly} />
          )}
          {active === "ethics" && (
            <SectionEthics version={version} studyId={studyId} readOnly={readOnly} />
          )}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <DataDictionaryPreview variables={variables} />
        </aside>
      </div>
    </main>
  );
}

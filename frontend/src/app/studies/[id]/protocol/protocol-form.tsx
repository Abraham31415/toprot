"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ObjectiveRow, ProtocolVersionRow, VariableRow } from "@/lib/protocol/types";
import { buildInitialSnapshot, type QualitySnapshot, type SectionKey } from "@/lib/protocol/quality";
import { computeCompletion } from "@/lib/protocol/completion";
import { ProtocolLiveContext } from "./protocol-context";
import { DataDictionaryPreview } from "./data-dictionary-preview";
import { QualityPanel } from "./quality-panel";
import { SectionIdentity } from "./sections/section-identity";
import { SectionObjectives } from "./sections/section-objectives";
import { SectionPopulation } from "./sections/section-population";
import { SectionVariables } from "./sections/section-variables";
import { SectionStatistics } from "./sections/section-statistics";
import { SectionSampleSize } from "./sections/section-sample-size";
import { SectionDataCollection } from "./sections/section-data-collection";
import { SectionEthics } from "./sections/section-ethics";

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "identity", label: "1. Study identity" },
  { key: "objectives", label: "2. Research question & objectives" },
  { key: "population", label: "3. Population & eligibility" },
  { key: "variables", label: "4. Variables" },
  { key: "statistics", label: "5. Statistical plan" },
  { key: "sample_size", label: "6. Sample size" },
  { key: "data_collection", label: "7. Data collection" },
  { key: "ethics", label: "8. Ethical considerations" },
];

export function ProtocolForm({
  studyId,
  studyTitle,
  version,
  objectives,
  variables: initialVariables,
  currentEnrollment,
  readOnly,
}: {
  studyId: string;
  studyTitle: string;
  version: ProtocolVersionRow;
  objectives: ObjectiveRow[];
  variables: VariableRow[];
  currentEnrollment: number | null;
  readOnly: boolean;
}) {
  const [active, setActive] = useState<SectionKey>("identity");
  const [variables, setVariables] = useState<VariableRow[]>(initialVariables);
  const [snapshot, setSnapshot] = useState<QualitySnapshot>(() =>
    buildInitialSnapshot(version, objectives, initialVariables, currentEnrollment),
  );

  const completion = useMemo(() => computeCompletion(snapshot), [snapshot]);
  const byKey = new Map(completion.sections.map((s) => [s.key, s]));
  const activeIndex = SECTIONS.findIndex((s) => s.key === active);

  const updateLive = useCallback(
    (patch: Partial<QualitySnapshot>) => setSnapshot((s) => ({ ...s, ...patch })),
    [],
  );

  useEffect(() => {
    setSnapshot((s) => ({ ...s, variables }));
  }, [variables]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-navy">{studyTitle}</h1>
          <p className="text-sm text-navy/65">
            Protocol v{version.version_number} · {version.status}
            {readOnly && " · read-only"}
          </p>
        </div>
        <div className="w-44 shrink-0 text-right">
          <p className="text-sm font-medium text-navy/85">
            {completion.percent}% complete
            <span className="ml-1 font-normal text-navy/65">
              ({completion.completeSections}/{SECTIONS.length} sections)
            </span>
          </p>
          <div
            className="mt-1 h-2 overflow-hidden rounded-full bg-navy/10"
            role="progressbar"
            aria-label="Protocol completion"
            aria-valuenow={completion.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-teal transition-all" style={{ width: `${completion.percent}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr_320px]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {SECTIONS.map((s) => {
            const c = byKey.get(s.key)!;
            const isActive = active === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setActive(s.key)}
                aria-current={isActive ? "step" : undefined}
                title={c.complete ? "Complete" : `Still needed: ${c.missing.join(", ")}`}
                className={`flex items-center justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-navy text-white"
                    : "text-navy/75 hover:bg-navy/5"
                }`}
              >
                <span>{s.label}</span>
                <span
                  className={`text-xs ${isActive ? "text-white/80" : c.complete ? "text-teal" : "text-navy/55"}`}
                  aria-label={c.complete ? "complete" : `${c.filled} of ${c.total} filled`}
                >
                  {c.complete ? "✓" : `${c.filled}/${c.total}`}
                </span>
              </button>
            );
          })}
        </nav>

        <ProtocolLiveContext.Provider value={{ update: updateLive }}>
          <div className="min-w-0 rounded-xl border border-line bg-white p-6">
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
            <div className="mt-6 flex justify-between border-t border-line pt-4">
              <button
                type="button"
                disabled={activeIndex <= 0}
                onClick={() => setActive(SECTIONS[activeIndex - 1].key)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy/85 hover:bg-navy/5 disabled:invisible"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={activeIndex >= SECTIONS.length - 1}
                onClick={() => setActive(SECTIONS[activeIndex + 1].key)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy/85 hover:bg-navy/5 disabled:invisible"
              >
                Next section
              </button>
            </div>
          </div>

          <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
            <QualityPanel snapshot={snapshot} onNavigate={setActive} />
            <DataDictionaryPreview variables={variables} />
          </aside>
        </ProtocolLiveContext.Provider>
      </div>
    </main>
  );
}

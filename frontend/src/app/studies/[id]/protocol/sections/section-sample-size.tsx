"use client";

import { useState } from "react";
import type { ProtocolVersionRow } from "@/lib/protocol/types";
import type { SampleSizeInput, SampleSizeResult } from "@/lib/protocol/sample-size";
import { SampleSizeForm } from "@/components/sample-size-form";
import { calculateSampleSize } from "../actions";
import { useProtocolLive } from "../protocol-context";

function reconstructResult(version: ProtocolVersionRow): SampleSizeResult | null {
  if (!version.stress_test_results || version.calculated_sample_size == null) return null;
  const stored = version.stress_test_results as SampleSizeResult["stress_test"] & {
    formula_label?: string;
    citation?: string;
  };
  const { formula_label, citation, ...stress_test } = stored;
  const inputs = version.sample_size_inputs as Partial<SampleSizeInput> | null;
  const isSingleGroup = !inputs?.design_type || inputs.design_type === "single_proportion" || inputs.design_type === "single_mean" || inputs.design_type === "paired_means" || inputs.design_type === "correlation" || inputs.design_type === "sensitivity_specificity";

  return {
    n_total: version.calculated_sample_size,
    n_before_dropout: version.calculated_sample_size,
    n_per_group: isSingleGroup ? null : Math.round(version.calculated_sample_size / 2),
    stress_test,
    formula_label: formula_label ?? "",
    citation: citation ?? "",
  };
}

export function SectionSampleSize({
  version,
  studyId,
  readOnly,
}: {
  version: ProtocolVersionRow;
  studyId: string;
  readOnly: boolean;
}) {
  const [result, setResult] = useState<SampleSizeResult | null>(() => reconstructResult(version));
  const { update } = useProtocolLive();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Sample size</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Calculated by the document service, then stress-tested across dropout rate and effect
          size so you can see how required N moves.
        </p>
      </div>

      <SampleSizeForm
        initialInput={version.sample_size_inputs as Partial<SampleSizeInput> | null}
        initialResult={result}
        readOnly={readOnly}
        onInputChange={(input) => update({ sample_size_inputs: input })}
        runCalculation={async (input) => {
          const res = await calculateSampleSize(version.id, studyId, input);
          if (res.result) {
            setResult(res.result);
            update({ sample_size_inputs: input, calculated_sample_size: res.result.n_total });
          }
          return res;
        }}
      />
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import type { ProtocolVersionRow } from "@/lib/protocol/types";
import type { DesignType, SampleSizeInput, SampleSizeResult } from "@/lib/protocol/sample-size";
import { DESIGN_TYPE_LABELS } from "@/lib/protocol/sample-size";
import { calculateSampleSize } from "../actions";
import { TextField } from "./form-controls";
import { StressTestTable } from "./stress-test-table";

function initialInput(version: ProtocolVersionRow): SampleSizeInput {
  const saved = version.sample_size_inputs as Partial<SampleSizeInput> | null;
  return {
    design_type: saved?.design_type ?? "single_proportion",
    confidence_level: saved?.confidence_level ?? 0.95,
    power: saved?.power ?? 0.8,
    dropout_rate: saved?.dropout_rate ?? 0.1,
    expected_proportion: saved?.expected_proportion ?? 0.5,
    margin_of_error: saved?.margin_of_error ?? 0.05,
    proportion_group1: saved?.proportion_group1 ?? 0.3,
    proportion_group2: saved?.proportion_group2 ?? 0.5,
    mean_difference: saved?.mean_difference ?? 5,
    standard_deviation: saved?.standard_deviation ?? 10,
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
  const [input, setInput] = useState<SampleSizeInput>(initialInput(version));
  const [result, setResult] = useState<SampleSizeResult | null>(() => {
    if (!version.stress_test_results || !version.calculated_sample_size) return null;
    const stressTest = version.stress_test_results as SampleSizeResult["stress_test"];
    const zeroDropoutRow = stressTest.rows.findIndex((r) => r.value === 0);
    const baseColIndex = Math.floor(stressTest.columns.length / 2);
    const n_before_dropout =
      zeroDropoutRow >= 0 ? stressTest.grid[zeroDropoutRow][baseColIndex] : version.calculated_sample_size;
    return {
      n_total: version.calculated_sample_size,
      n_before_dropout,
      n_per_group:
        input.design_type === "single_proportion" ? null : Math.round(version.calculated_sample_size / 2),
      stress_test: stressTest,
    };
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof SampleSizeInput>(key: K) => (value: SampleSizeInput[K]) =>
    setInput((f) => ({ ...f, [key]: value }));

  const num = (key: keyof SampleSizeInput) => (v: string) =>
    set(key)((v === "" ? undefined : parseFloat(v)) as never);

  function calculate() {
    setError(null);
    startTransition(async () => {
      const res = await calculateSampleSize(version.id, studyId, input);
      if (res.error) setError(res.error);
      else if (res.result) setResult(res.result);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Sample size</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Calculated by the document service, then stress-tested across dropout rate and effect
          size so you can see how required N moves.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Design</span>
        <select
          value={input.design_type}
          disabled={readOnly}
          onChange={(e) => set("design_type")(e.target.value as DesignType)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
        >
          {(Object.keys(DESIGN_TYPE_LABELS) as DesignType[]).map((t) => (
            <option key={t} value={t}>
              {DESIGN_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      {input.design_type === "single_proportion" && (
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Expected proportion"
            type="number"
            value={String(input.expected_proportion ?? "")}
            onChange={num("expected_proportion")}
            disabled={readOnly}
          />
          <TextField
            label="Margin of error"
            type="number"
            value={String(input.margin_of_error ?? "")}
            onChange={num("margin_of_error")}
            disabled={readOnly}
          />
        </div>
      )}

      {input.design_type === "two_proportions" && (
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Proportion, group 1"
            type="number"
            value={String(input.proportion_group1 ?? "")}
            onChange={num("proportion_group1")}
            disabled={readOnly}
          />
          <TextField
            label="Proportion, group 2"
            type="number"
            value={String(input.proportion_group2 ?? "")}
            onChange={num("proportion_group2")}
            disabled={readOnly}
          />
        </div>
      )}

      {input.design_type === "two_means" && (
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Mean difference"
            type="number"
            value={String(input.mean_difference ?? "")}
            onChange={num("mean_difference")}
            disabled={readOnly}
          />
          <TextField
            label="Standard deviation"
            type="number"
            value={String(input.standard_deviation ?? "")}
            onChange={num("standard_deviation")}
            disabled={readOnly}
          />
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <TextField
          label="Confidence level"
          type="number"
          value={String(input.confidence_level)}
          onChange={num("confidence_level")}
          disabled={readOnly}
        />
        {input.design_type !== "single_proportion" && (
          <TextField
            label="Power"
            type="number"
            value={String(input.power)}
            onChange={num("power")}
            disabled={readOnly}
          />
        )}
        <TextField
          label="Expected dropout rate"
          type="number"
          value={String(input.dropout_rate)}
          onChange={num("dropout_rate")}
          disabled={readOnly}
        />
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={calculate}
          disabled={pending}
          className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? "Calculating..." : "Calculate"}
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex flex-wrap gap-6">
            {result.n_per_group !== null && (
              <Stat label="Per group" value={result.n_per_group} />
            )}
            <Stat label="Before dropout" value={result.n_before_dropout} />
            <Stat label="Total (after dropout)" value={result.n_total} highlight />
          </div>
          <StressTestTable stressTest={result.stress_test} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p
        className={`text-2xl font-semibold ${
          highlight ? "text-zinc-950 dark:text-zinc-50" : "text-zinc-700 dark:text-zinc-300"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

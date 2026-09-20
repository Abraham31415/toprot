"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { DesignType, SampleSizeInput, SampleSizeResult } from "@/lib/protocol/sample-size";
import { DESIGN_TYPE_LABELS } from "@/lib/protocol/sample-size";
import { StressTestTable } from "./stress-test-table";

function defaultInput(saved?: Partial<SampleSizeInput> | null): SampleSizeInput {
  return {
    design_type: saved?.design_type ?? "single_proportion",
    confidence_level: saved?.confidence_level ?? 0.95,
    power: saved?.power ?? 0.8,
    dropout_rate: saved?.dropout_rate ?? 0.1,
    population_size: saved?.population_size,
    expected_proportion: saved?.expected_proportion ?? 0.5,
    margin_of_error: saved?.margin_of_error ?? 0.05,
    proportion_group1: saved?.proportion_group1 ?? 0.3,
    proportion_group2: saved?.proportion_group2 ?? 0.5,
    mean_difference: saved?.mean_difference ?? 5,
    standard_deviation: saved?.standard_deviation ?? 10,
    expected_correlation: saved?.expected_correlation ?? 0.3,
    expected_sensitivity: saved?.expected_sensitivity ?? 0.9,
    expected_specificity: saved?.expected_specificity ?? 0.9,
    disease_prevalence: saved?.disease_prevalence ?? 0.1,
    baseline_proportion: saved?.baseline_proportion ?? 0.2,
    odds_ratio: saved?.odds_ratio ?? 2,
    relative_risk: saved?.relative_risk ?? 2,
  };
}

const PRECISION_DESIGNS: DesignType[] = ["single_proportion", "single_mean", "sensitivity_specificity"];

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <input
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
      />
    </label>
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

export function SampleSizeForm({
  initialInput,
  initialResult,
  runCalculation,
  readOnly,
  footer,
  onInputChange,
}: {
  initialInput?: Partial<SampleSizeInput> | null;
  initialResult?: SampleSizeResult | null;
  runCalculation: (input: SampleSizeInput) => Promise<{ error?: string; result?: SampleSizeResult }>;
  readOnly?: boolean;
  footer?: (result: SampleSizeResult, input: SampleSizeInput) => ReactNode;
  /** Fires on every field change, before Calculate is clicked -- lets an embedding
   * page (e.g. the protocol's live quality panel) see in-progress edits. */
  onInputChange?: (input: SampleSizeInput) => void;
}) {
  const [input, setInput] = useState<SampleSizeInput>(defaultInput(initialInput));
  const [result, setResult] = useState<SampleSizeResult | null>(initialResult ?? null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onInputChange?.(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const set = <K extends keyof SampleSizeInput>(key: K) => (value: SampleSizeInput[K]) =>
    setInput((f) => ({ ...f, [key]: value }));

  const num = (key: keyof SampleSizeInput) => (v: string) =>
    set(key)((v === "" ? undefined : parseFloat(v)) as never);

  function calculate() {
    setError(null);
    startTransition(async () => {
      const res = await runCalculation(input);
      if (res.error) setError(res.error);
      else if (res.result) setResult(res.result);
    });
  }

  const isPrecisionDesign = PRECISION_DESIGNS.includes(input.design_type);

  return (
    <div className="flex flex-col gap-5">
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
          <Field label="Expected proportion" value={String(input.expected_proportion ?? "")} onChange={num("expected_proportion")} disabled={readOnly} />
          <Field label="Margin of error" value={String(input.margin_of_error ?? "")} onChange={num("margin_of_error")} disabled={readOnly} />
        </div>
      )}

      {input.design_type === "single_mean" && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Expected standard deviation" value={String(input.standard_deviation ?? "")} onChange={num("standard_deviation")} disabled={readOnly} />
          <Field label="Margin of error" value={String(input.margin_of_error ?? "")} onChange={num("margin_of_error")} disabled={readOnly} />
        </div>
      )}

      {input.design_type === "two_proportions" && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Proportion, group 1" value={String(input.proportion_group1 ?? "")} onChange={num("proportion_group1")} disabled={readOnly} />
          <Field label="Proportion, group 2" value={String(input.proportion_group2 ?? "")} onChange={num("proportion_group2")} disabled={readOnly} />
        </div>
      )}

      {input.design_type === "two_means" && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Mean difference" value={String(input.mean_difference ?? "")} onChange={num("mean_difference")} disabled={readOnly} />
          <Field label="Standard deviation" value={String(input.standard_deviation ?? "")} onChange={num("standard_deviation")} disabled={readOnly} />
        </div>
      )}

      {input.design_type === "paired_means" && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Mean difference" value={String(input.mean_difference ?? "")} onChange={num("mean_difference")} disabled={readOnly} />
          <Field label="SD of the differences" value={String(input.standard_deviation ?? "")} onChange={num("standard_deviation")} disabled={readOnly} />
        </div>
      )}

      {input.design_type === "correlation" && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Expected correlation (r)" value={String(input.expected_correlation ?? "")} onChange={num("expected_correlation")} disabled={readOnly} />
        </div>
      )}

      {input.design_type === "sensitivity_specificity" && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Expected sensitivity" value={String(input.expected_sensitivity ?? "")} onChange={num("expected_sensitivity")} disabled={readOnly} />
          <Field label="Expected specificity" value={String(input.expected_specificity ?? "")} onChange={num("expected_specificity")} disabled={readOnly} />
          <Field label="Disease prevalence" value={String(input.disease_prevalence ?? "")} onChange={num("disease_prevalence")} disabled={readOnly} />
          <Field label="Desired precision" value={String(input.margin_of_error ?? "")} onChange={num("margin_of_error")} disabled={readOnly} />
        </div>
      )}

      {input.design_type === "cross_sectional_or" && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Baseline proportion (unexposed)" value={String(input.baseline_proportion ?? "")} onChange={num("baseline_proportion")} disabled={readOnly} />
          <Field label="Odds ratio to detect" value={String(input.odds_ratio ?? "")} onChange={num("odds_ratio")} disabled={readOnly} />
        </div>
      )}

      {input.design_type === "cohort_rr" && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Baseline risk (unexposed)" value={String(input.baseline_proportion ?? "")} onChange={num("baseline_proportion")} disabled={readOnly} />
          <Field label="Relative risk to detect" value={String(input.relative_risk ?? "")} onChange={num("relative_risk")} disabled={readOnly} />
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Field label="Confidence level" value={String(input.confidence_level)} onChange={num("confidence_level")} disabled={readOnly} />
        {!isPrecisionDesign && (
          <Field label="Power" value={String(input.power)} onChange={num("power")} disabled={readOnly} />
        )}
        <Field label="Expected dropout rate" value={String(input.dropout_rate)} onChange={num("dropout_rate")} disabled={readOnly} />
      </div>

      <Field
        label="Population size (optional - applies a finite population correction)"
        value={input.population_size != null ? String(input.population_size) : ""}
        onChange={num("population_size")}
        disabled={readOnly}
      />

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
            {result.n_per_group !== null && <Stat label="Per group" value={result.n_per_group} />}
            <Stat label="Before dropout" value={result.n_before_dropout} />
            <Stat label="Total (after dropout)" value={result.n_total} highlight />
          </div>

          <div className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <p className="font-mono">{result.formula_label}</p>
            <p className="mt-1">{result.citation}</p>
          </div>

          <StressTestTable stressTest={result.stress_test} />

          {footer?.(result, input)}
        </div>
      )}
    </div>
  );
}

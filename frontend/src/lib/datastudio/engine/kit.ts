// Shared runner plumbing: the context each runner fills in, and small helpers used by several runners.

import { fmt, fmtP, type Assumption, type ChartData, type ResultTable } from "./common";
import { summarize } from "./describe";
import { shapiroWilk } from "./normality";
import type { Params } from "./params";
import type { Dataset, Warning } from "../types";

export type Ctx = { d: Dataset; p: Params; conf: number; warnings: Warning[]; assumptions: Assumption[]; tables: ResultTable[]; charts: ChartData[]; key: Record<string, number | string | null> };
export type Out = { title: string; methodsText: string; used: number; total: number };

export const pct = (c: number) => `${(100 * c).toFixed(0)}%`;
export const s = (x: unknown) => x as string;
export const label = (d: Dataset, name: string) => { const v = d.variables.find((x) => x.name === name); return v?.label ? `${v.label} (${name})` : name; };

export function boxOf(labelText: string, x: number[]) {
  const sm = summarize(x);
  const lo = sm.q1 - 1.5 * sm.iqr, hi = sm.q3 + 1.5 * sm.iqr;
  const inside = x.filter((v) => v >= lo && v <= hi);
  return { label: labelText, min: sm.min, q1: sm.q1, median: sm.median, q3: sm.q3, max: sm.max, whiskerLo: Math.min(...inside), whiskerHi: Math.max(...inside), outliers: x.filter((v) => v < lo || v > hi).slice(0, 200), n: x.length, mean: sm.mean };
}

export function normalityAssumption(name: string, x: number[]): Assumption {
  if (x.length < 3) return { name: `Normality (${name})`, detail: "Too few observations to assess.", status: "check" };
  if (x.length > 5000) return { name: `Normality (${name})`, detail: "Large sample: inspect the Q-Q plot; the central limit theorem usually protects tests of means.", status: "info" };
  try {
    const sw = shapiroWilk(x);
    const ok = sw.p >= 0.05;
    return { name: `Normality (${name})`, detail: `Shapiro-Wilk W = ${fmt(sw.w, 3)}, p = ${fmtP(sw.p)}${ok ? "" : x.length >= 30 ? "; with n ≥ 30 a t-test is usually still reasonable, but consider a nonparametric test for strong skew" : "; consider a nonparametric test"}.`, status: ok ? "met" : "violated" };
  } catch (e) { return { name: `Normality (${name})`, detail: (e as Error).message, status: "check" }; }
}


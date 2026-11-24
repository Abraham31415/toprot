"use client";

import { useMemo } from "react";
import { AlertTriangle, Download, Info } from "lucide-react";
import { profileDataset } from "@/lib/datastudio/profile";
import { dictionaryRows, toCsv } from "@/lib/datastudio/export";
import type { Dataset } from "@/lib/datastudio/types";
import { download } from "./chart";

const f = (x: number | undefined, d = 2) => (x === undefined || !Number.isFinite(x) ? "–" : Math.abs(x) >= 1e6 ? x.toExponential(2) : x.toFixed(d));

function Spark({ bins }: { bins: { count: number }[] }) {
  const max = Math.max(...bins.map((b) => b.count), 1);
  return <svg viewBox={`0 0 ${bins.length * 4} 20`} className="h-5 w-24" aria-hidden="true">{bins.map((b, i) => <rect key={i} x={i * 4} y={20 - (20 * b.count) / max} width={3} height={(20 * b.count) / max} className="fill-primary" />)}</svg>;
}

/** Data-quality profile and data dictionary. Computed in the browser from the loaded version; flags problems, never fixes them. */
export function ProfileView({ dataset, datasetName, canExport }: { dataset: Dataset; datasetName: string; canExport: (f: "csv") => Promise<boolean> }) {
  const p = useMemo(() => profileDataset(dataset), [dataset]);
  const issues = p.issues.length + p.variables.reduce((s, v) => s + v.issues.length, 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[["Rows", p.rows.toLocaleString("en-GB")], ["Variables", String(p.columns)], ["Complete rows", `${p.completeRows.toLocaleString("en-GB")} (${p.rows ? ((100 * p.completeRows) / p.rows).toFixed(0) : 0}%)`], ["Missing cells", `${p.totalCells ? ((100 * p.missingCells) / p.totalCells).toFixed(1) : 0}%`], ["Duplicate rows", String(p.duplicateRows)]].map(([k, v]) => (
          <div key={k} className="rounded-control border border-line bg-surface p-3"><p className="type-caption">{k}</p><p className="type-stat mt-1 text-xl">{v}</p></div>
        ))}
      </div>
      {p.issues.length > 0 && <ul className="space-y-1.5">{p.issues.map((w, i) => <li key={i} className="flex gap-2 rounded-control border border-warning-line bg-warning-bg p-2 text-sm text-warning-ink"><AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />{w.text}</li>)}</ul>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="type-card">Variables ({issues} item{issues === 1 ? "" : "s"} to review)</h3>
        <button type="button" className="inline-flex items-center gap-1 text-sm text-primary hover:underline" onClick={async () => { if (await canExport("csv")) { const d = dictionaryRows(dataset); download(`${datasetName} data dictionary.csv`, toCsv(d.header, d.rows), "text/csv"); } }}><Download className="h-4 w-4" aria-hidden="true" />Data dictionary (CSV)</button>
      </div>
      <div className="overflow-x-auto rounded-control border border-line">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-soft text-left text-xs text-ink"><tr>{["Variable", "Type / level", "N", "Missing", "Distinct", "Summary", "Shape", "Notes"].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {p.variables.map((v) => (
              <tr key={v.name} className="border-t border-line align-top">
                <td className="px-3 py-2"><p className="font-medium text-ink">{v.name}</p>{v.label && <p className="type-caption">{v.label}</p>}</td>
                <td className="px-3 py-2 text-ink-soft">{v.type} · {v.measure}</td>
                <td className="px-3 py-2 tabular-nums">{v.n}</td>
                <td className={`px-3 py-2 tabular-nums ${v.missingPct >= 20 ? "font-semibold text-warning-ink" : ""}`}>{v.missing} ({v.missingPct.toFixed(1)}%)</td>
                <td className="px-3 py-2 tabular-nums">{v.distinct}</td>
                <td className="px-3 py-2 text-xs text-ink-soft">
                  {v.numeric && <>Mean {f(v.numeric.mean)} (SD {f(v.numeric.sd)})<br />Median {f(v.numeric.median)} [{f(v.numeric.q1)}, {f(v.numeric.q3)}]<br />Range {f(v.numeric.min)} to {f(v.numeric.max)}</>}
                  {v.categories && v.categories.slice(0, 4).map((c) => <span key={c.value} className="block">{c.label ? `${c.value} (${c.label})` : c.value}: {c.count} ({c.pct.toFixed(0)}%)</span>)}
                  {v.categories && v.categories.length > 4 && <span className="block text-ink-muted">+{v.distinct - 4} more</span>}
                  {v.dates && <>From {v.dates.min} to {v.dates.max}</>}
                </td>
                <td className="px-3 py-2">{v.numeric && <><Spark bins={v.numeric.histogram} /><span className="type-caption">skew {f(v.numeric.skewness)}</span></>}</td>
                <td className="px-3 py-2">{v.issues.map((w, i) => <p key={i} className={`flex gap-1 text-xs ${w.level === "warning" ? "text-warning-ink" : "text-info-ink"}`}>{w.level === "warning" ? <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" aria-hidden="true" /> : <Info className="mt-0.5 h-3 w-3 flex-none" aria-hidden="true" />}{w.text}</p>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.strongCorrelations.length > 0 && (
        <div className="rounded-control border border-line p-3 text-sm"><h4 className="font-semibold text-ink">Nearly identical variables (|r| ≥ 0.9)</h4><ul className="mt-1 space-y-0.5 text-ink-soft">{p.strongCorrelations.map((c) => <li key={`${c.a}-${c.b}`}>{c.a} and {c.b}: r = {c.r.toFixed(3)} (n = {c.n})</li>)}</ul></div>
      )}
    </div>
  );
}

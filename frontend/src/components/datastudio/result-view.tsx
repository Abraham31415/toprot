"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Download, HelpCircle, Info, XCircle } from "lucide-react";
import type { AnalysisResult, ResultTable, TableCell } from "@/lib/datastudio/engine/common";
import { resultToCsv, tableToCsv } from "@/lib/datastudio/export";
import { Chart, download, pngBlob, svgString } from "./chart";

export type ReportStyle = { decimals: number; pStyle: "apa" | "exact" | "stars"; leadingZero: boolean };
export const DEFAULT_REPORT: ReportStyle = { decimals: 2, pStyle: "apa", leadingZero: true };

/** Formats one table cell according to its kind and the chosen reporting style. The stored number is never changed. */
export function formatCell(c: TableCell, kind: string | undefined, st: ReportStyle): string {
  if (c === null) return "–";
  if (typeof c === "string") return c;
  const lz = (s: string) => (st.leadingZero ? s : s.replace(/^(-?)0\./, "$1."));
  if (kind === "int") return Number.isInteger(c) ? c.toLocaleString("en-GB") : c.toFixed(st.decimals);
  if (kind === "p") {
    if (st.pStyle === "exact") return c < 1e-4 ? c.toExponential(2) : lz(c.toFixed(4));
    if (st.pStyle === "stars") return `${lz(c < 0.001 ? "<0.001" : c.toFixed(3))}${c < 0.001 ? "***" : c < 0.01 ? "**" : c < 0.05 ? "*" : ""}`;
    return c < 0.001 ? lz("<0.001") : lz(c.toFixed(3));
  }
  if (kind === "pct") return `${c.toFixed(1)}`;
  const a = Math.abs(c);
  if (a !== 0 && (a >= 1e7 || a < 10 ** -st.decimals / 2)) return c.toExponential(2);
  return lz(c.toFixed(st.decimals));
}

/** HTML for pasting into Word or the Toprot manuscript editor (both accept HTML tables from the clipboard). */
export function tableHtml(t: ResultTable, st: ReportStyle): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<table><caption>${esc(t.title)}</caption><thead><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c, k) => `<td>${esc(formatCell(c, t.kinds?.[k], st))}</td>`).join("")}</tr>`).join("")}</tbody></table>${(t.notes ?? []).map((n) => `<p><small>${esc(n)}</small></p>`).join("")}`;
}

async function copyHtml(html: string, text: string) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
  } catch { await navigator.clipboard.writeText(text); }
}

const STATUS = {
  met: { icon: CheckCircle2, cls: "text-success-ink", label: "Met" },
  violated: { icon: XCircle, cls: "text-danger-ink", label: "Concern" },
  check: { icon: HelpCircle, cls: "text-warning-ink", label: "Check" },
  info: { icon: Info, cls: "text-info-ink", label: "Note" },
} as const;

export function ResultView({ result, style, canExport, onExport }: { result: AnalysisResult; style: ReportStyle; canExport: (f: "csv" | "svg" | "png") => Promise<boolean>; onExport?: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const flash = (k: string) => { setCopied(k); setTimeout(() => setCopied(null), 1500); };
  return (
    <article className="space-y-5" aria-label={result.title}>
      <header>
        <p className="type-eyebrow">Computed result</p>
        <h3 className="type-card mt-1">{result.title}</h3>
        <p className="type-support mt-1">N used {result.n.used.toLocaleString("en-GB")} of {result.n.total.toLocaleString("en-GB")}{result.n.excluded ? ` (${result.n.excluded} excluded for missing values)` : ""}.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="inline-flex items-center gap-1 text-sm text-primary hover:underline" onClick={async () => { if (await canExport("csv")) { download(`${result.title}.csv`, resultToCsv(result), "text/csv"); onExport?.(); } }}><Download className="h-4 w-4" aria-hidden="true" />All tables (CSV)</button>
        </div>
      </header>

      {result.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {result.warnings.map((w, i) => (
            <li key={i} className={`flex gap-2 rounded-control border p-2 text-sm ${w.level === "warning" ? "border-warning-line bg-warning-bg text-warning-ink" : "border-info-line bg-info-bg text-info-ink"}`}>
              {w.level === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <Info className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}<span><span className="sr-only">{w.level}: </span>{w.text}</span>
            </li>
          ))}
        </ul>
      )}

      {result.tables.map((t, ti) => (
        <section key={ti} className="rounded-control border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas px-3 py-2">
            <h4 className="text-sm font-semibold text-ink">{t.title}</h4>
            <div className="flex gap-3">
              <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={async () => { await copyHtml(tableHtml(t, style), tableToCsv(t)); flash(`t${ti}`); }}><ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />{copied === `t${ti}` ? "Copied" : "Copy for Word or manuscript"}</button>
              <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={async () => { if (await canExport("csv")) download(`${t.title}.csv`, tableToCsv(t), "text/csv"); }}><Download className="h-3.5 w-3.5" aria-hidden="true" />CSV</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr>{t.columns.map((c, k) => <th key={k} scope="col" className={`whitespace-nowrap border-b border-line px-3 py-2 font-medium text-ink-soft ${k === 0 ? "text-left" : "text-right"}`}>{c}</th>)}</tr></thead>
              <tbody>
                {t.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {r.map((c, k) => <td key={k} className={`whitespace-nowrap px-3 py-1.5 tabular-nums ${typeof c === "number" || k > 0 ? "text-right" : "text-left"} ${k === 0 ? "text-ink" : "text-ink-soft"}`}>{formatCell(c, t.kinds?.[k], style)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {t.notes?.length ? <div className="space-y-1 border-t border-line px-3 py-2">{t.notes.map((n, i) => <p key={i} className="type-caption">{n}</p>)}</div> : null}
        </section>
      ))}

      {result.assumptions.length > 0 && (
        <section aria-label="Assumption checks" className="rounded-control border border-line p-3">
          <h4 className="text-sm font-semibold text-ink">Assumptions and diagnostics</h4>
          <ul className="mt-2 space-y-2">
            {result.assumptions.map((a, i) => { const S = STATUS[a.status]; return (
              <li key={i} className="flex gap-2 text-sm"><S.icon className={`mt-0.5 h-4 w-4 flex-none ${S.cls}`} aria-hidden="true" /><span><span className="font-medium text-ink">{a.name}</span> <span className={`text-xs font-semibold ${S.cls}`}>({S.label})</span>: <span className="text-ink-soft">{a.detail}</span></span></li>
            ); })}
          </ul>
        </section>
      )}

      {result.charts.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{result.charts.map((c, i) => <ChartCard key={i} chart={c} canExport={canExport} />)}</div>}

      <section className="rounded-control border border-line bg-canvas p-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-ink">Methods text</h4>
          <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={async () => { await navigator.clipboard.writeText(result.methodsText); flash("m"); }}><ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />{copied === "m" ? "Copied" : "Copy"}</button>
        </div>
        <p className="mt-1 text-sm text-ink-soft">{result.methodsText}</p>
        <p className="type-caption mt-2">Generated from the analysis settings, not by AI.</p>
      </section>
    </article>
  );
}

export function ChartCard({ chart, canExport }: { chart: AnalysisResult["charts"][number]; canExport: (f: "csv" | "svg" | "png") => Promise<boolean> }) {
  const ref = useRef<SVGSVGElement>(null);
  return (
    <figure className="rounded-control border border-line bg-surface p-2">
      <Chart ref={ref} chart={chart} />
      <figcaption className="mt-1 flex flex-wrap justify-end gap-3 text-xs">
        <button type="button" className="text-primary hover:underline" onClick={async () => { if (ref.current && (await canExport("svg"))) download(`${chart.title}.svg`, svgString(ref.current, 640, 420), "image/svg+xml"); }}>SVG</button>
        <button type="button" className="text-primary hover:underline" onClick={async () => { if (ref.current && (await canExport("png"))) download(`${chart.title}.png`, await pngBlob(ref.current, 640, 420, 3.125)); }}>PNG (300 dpi)</button>
      </figcaption>
    </figure>
  );
}

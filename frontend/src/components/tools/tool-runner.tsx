"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, Printer } from "lucide-react";
import { getCalculator } from "@/lib/tools/registry";
import { parseNumbers } from "@/lib/tools/helpers";
import type { Calculator, Field, ToolResult } from "@/lib/tools/types";

const visible = (f: Field, v: Record<string, string>) => !f.showIf || v[f.showIf.id] === f.showIf.equals;

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain HTML of the result. Word opens this as a document when saved with a .doc extension. */
function resultToHtml(tool: Calculator, values: Record<string, string>, r: ToolResult): string {
  const inputs = tool.fields.filter((f) => visible(f, values)).map((f) => `<tr><td>${escapeHtml(f.label)}</td><td>${escapeHtml(values[f.id] ?? "")}</td></tr>`).join("");
  const rows = (r.rows ?? []).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("");
  const steps = (r.steps ?? []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  const refs = tool.references.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  return `<html><head><meta charset="utf-8"><title>${escapeHtml(tool.name)}</title></head><body style="font-family:Calibri,Arial,sans-serif">
<h1>${escapeHtml(tool.name)}</h1>
<p><em>Generated with ToProt. Planning estimate, not a substitute for review by a qualified statistician.</em></p>
<h2>Inputs</h2><table border="1" cellpadding="4" style="border-collapse:collapse">${inputs}</table>
${r.headline ? `<h2>${escapeHtml(r.headline.label)}: ${escapeHtml(r.headline.value)}</h2>` : ""}
${rows ? `<table border="1" cellpadding="4" style="border-collapse:collapse">${rows}</table>` : ""}
${steps ? `<h2>Calculation steps</h2><ol>${steps}</ol>` : ""}
<h2>Formula</h2><p>${escapeHtml(tool.formula)}</p>
${r.methods ? `<h2>Methods text</h2><p>${escapeHtml(r.methods)}</p>` : ""}
<h2>References</h2><ol>${refs}</ol></body></html>`;
}

export function ToolRunner({ slug }: { slug: string }) {
  const tool = getCalculator(slug);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((tool?.fields ?? []).map((f) => [f.id, f.default])),
  );
  const [result, setResult] = useState<ToolResult | null>(null);
  const [copied, setCopied] = useState<"methods" | "result" | null>(null);

  const shown = useMemo(() => (tool ? tool.fields.filter((f) => visible(f, values)) : []), [tool, values]);
  if (!tool) return null;

  function run() {
    if (!tool) return;
    const parsed = parseNumbers(tool.fields, values);
    if ("error" in parsed) {
      setResult({ error: parsed.error });
      return;
    }
    try {
      setResult(tool.run(parsed.n, values));
    } catch (e) {
      setResult({ error: (e as Error).message || "The calculation failed." });
    }
  }

  async function copy(kind: "methods" | "result", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function download() {
    if (!tool || !result || result.error) return;
    const blob = new Blob([resultToHtml(tool, values, result)], { type: "application/msword" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${tool.slug}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const resultText = result && !result.error
    ? [tool.name, result.headline ? `${result.headline.label}: ${result.headline.value}` : "", ...(result.rows ?? []).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join("\n")
    : "";

  const inputClass = "mt-1 w-full rounded-md border border-navy/25 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20";

  const renderField = (f: Field) => (
    <div key={f.id}>
      <label htmlFor={`f-${f.id}`} className="block text-sm font-medium text-navy">{f.label}</label>
      {f.kind === "select" ? (
        <select id={`f-${f.id}`} className={inputClass} value={values[f.id]} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}>
          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : f.kind === "textarea" ? (
        <textarea id={`f-${f.id}`} rows={4} className={`${inputClass} font-mono`} placeholder={f.placeholder} value={values[f.id]} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} />
      ) : (
        <input id={`f-${f.id}`} type="number" inputMode="decimal" className={inputClass} value={values[f.id]} min={f.min} max={f.max} step={f.step ?? "any"} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} />
      )}
      {f.help && <p className="mt-1 text-xs text-navy/65">{f.help}</p>}
    </div>
  );

  const tableFields = tool.tableLabels ? shown.filter((f) => ["a", "b", "c", "d"].includes(f.id)) : [];
  const otherFields = shown.filter((f) => !tableFields.includes(f));

  return (
    <div>
      <form
        onSubmit={(e) => { e.preventDefault(); run(); }}
        className="rounded-xl border border-line bg-white p-5 print:hidden"
        aria-label={`${tool.name} inputs`}
      >
        {tool.tableLabels && (
          <fieldset className="mb-5">
            <legend className="text-sm font-semibold text-navy">{tool.tableLabels.title}</legend>
            <div className="mt-2 grid grid-cols-[auto_1fr_1fr] items-end gap-2 text-sm">
              <span />
              {tool.tableLabels.cols.map((c) => <span key={c} className="text-center text-xs font-medium text-navy/70">{c}</span>)}
              {[0, 1].map((r) => (
                <FragmentRow key={r} label={tool.tableLabels!.rows[r]}>
                  {[0, 1].map((c) => {
                    const f = tableFields[r * 2 + c];
                    return f ? (
                      <div key={f.id}>
                        <label htmlFor={`f-${f.id}`} className="sr-only">{f.label}</label>
                        <input id={`f-${f.id}`} type="number" inputMode="numeric" min={0} step={1} className={`${inputClass} mt-0 text-center`} value={values[f.id]} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} />
                      </div>
                    ) : null;
                  })}
                </FragmentRow>
              ))}
            </div>
          </fieldset>
        )}
        <div className="grid gap-4 sm:grid-cols-2">{otherFields.map(renderField)}</div>
        <button type="submit" className="mt-5 rounded-md bg-cobalt px-5 py-2.5 text-sm font-medium text-white hover:bg-cobalt-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt">
          Calculate
        </button>
      </form>

      <div aria-live="polite" className="mt-5">
        {result?.error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{result.error}</p>}
        {result && !result.error && (
          <section className="rounded-xl border border-line bg-white p-5" aria-label="Results">
            {result.headline && (
              <div className="rounded-lg bg-soft p-4">
                <p className="text-sm text-navy/70">{result.headline.label}</p>
                <p className="text-3xl font-semibold text-navy">{result.headline.value}</p>
              </div>
            )}
            {result.rows && (
              <dl className="mt-4 divide-y divide-line text-sm">
                {result.rows.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-navy/70">{k}</dt><dd className="text-right font-medium text-navy">{v}</dd></div>
                ))}
              </dl>
            )}
            {result.table && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr>{result.table.head.map((h) => <th key={h} className="border-b border-line px-2 py-1.5 text-left font-medium text-navy/70">{h}</th>)}</tr></thead>
                  <tbody>{result.table.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className="border-b border-line px-2 py-1.5">{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
            {result.steps && (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-navy">Calculation steps</h3>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-navy/85">{result.steps.map((s, i) => <li key={i} className="break-words font-mono text-xs leading-5">{s}</li>)}</ol>
              </div>
            )}
            {result.notes && <ul className="mt-4 space-y-1 text-xs text-navy/65">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            {result.methods && (
              <div className="mt-5 rounded-lg border border-line p-4">
                <h3 className="text-sm font-semibold text-navy">Copy-ready methods text</h3>
                <p className="mt-2 text-sm text-navy/85">{result.methods}</p>
                <button type="button" onClick={() => copy("methods", result.methods!)} className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt hover:text-cobalt">
                  {copied === "methods" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied === "methods" ? "Copied" : "Copy text"}
                </button>
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-2 print:hidden">
              <button type="button" onClick={() => copy("result", resultText)} className="inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt hover:text-cobalt">
                {copied === "result" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied === "result" ? "Copied" : "Copy results"}
              </button>
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt hover:text-cobalt">
                <Printer className="h-3.5 w-3.5" /> Print or save as PDF
              </button>
              <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt hover:text-cobalt">
                <Download className="h-3.5 w-3.5" /> Download Word (.doc)
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function FragmentRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="pr-2 text-xs font-medium text-navy/70">{label}</span>
      {children}
    </>
  );
}

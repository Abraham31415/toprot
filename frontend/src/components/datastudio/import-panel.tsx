"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, FileUp, Info } from "lucide-react";
import { Button } from "@/components/ds";
import { createClient } from "@/lib/supabase/client";
import { parseFile, SUPPORTED_EXTENSIONS, type ImportOptions, type ImportResult } from "@/lib/datastudio/parse";
import type { VarType } from "@/lib/datastudio/types";
import { createBlankDataset, importDataset, prepareUpload } from "@/app/studies/[id]/data/actions";

const PREVIEW_ROWS = 15;
const accept = Object.keys(SUPPORTED_EXTENSIONS).map((e) => `.${e}`).join(",");

/** Upload, preview, correct and import a data file. The preview uses the same parser the server runs after upload. */
export function ImportPanel({ studyId, maxBytes, maxRows, maxColumns }: { studyId: string; maxBytes: number; maxRows: number; maxColumns: number }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [opts, setOpts] = useState<ImportOptions>({ header: true, dateOrder: "dmy" });
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [blank, setBlank] = useState(false);
  const [blankCols, setBlankCols] = useState("id, age, sex");

  async function reparse(b: Uint8Array, f: File, o: ImportOptions) {
    setError(null);
    try { setPreview(await parseFile(b, f.name, o, { maxRows, maxColumns, maxBytes })); }
    catch (e) { setPreview(null); setError((e as Error).message); }
  }
  async function pick(f: File | undefined) {
    if (!f) return;
    setFile(f); setName(f.name.replace(/\.[^.]+$/, "").slice(0, 120));
    if (f.size > maxBytes) { setError(`The file is ${(f.size / 1048576).toFixed(1)} MB; this project's plan allows ${(maxBytes / 1048576).toFixed(0)} MB.`); setPreview(null); return; }
    const b = new Uint8Array(await f.arrayBuffer());
    setBytes(b);
    const o: ImportOptions = { header: true, dateOrder: "dmy" };
    setOpts(o);
    await reparse(b, f, o);
  }
  async function change(patch: Partial<ImportOptions>) {
    const o = { ...opts, ...patch };
    setOpts(o);
    if (bytes && file) await reparse(bytes, file, o);
  }
  async function doImport() {
    if (!file || !preview) return;
    setBusy("Uploading…"); setError(null);
    const prep = await prepareUpload(studyId, file.name, file.size);
    if (!prep.ok) { setBusy(null); setError(prep.error); return; }
    const { error: upErr } = await createClient().storage.from("ds-uploads").upload(prep.data.path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
    if (upErr) { setBusy(null); setError("The upload failed. Check your connection and try again."); return; }
    setBusy("Checking and saving on the server…");
    const r = await importDataset(studyId, { path: prep.data.path, filename: file.name, name, options: opts });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    router.push(`/studies/${studyId}/data/${r.data.datasetId}`);
  }
  async function doBlank() {
    const cols = blankCols.split(",").map((c) => c.trim()).filter(Boolean).map((c) => ({ name: c, type: "numeric" as const }));
    setBusy("Creating…");
    const r = await createBlankDataset(studyId, name || "New dataset", cols);
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    router.push(`/studies/${studyId}/data/${r.data.datasetId}`);
  }

  const isText = file && !/\.(xlsx|json)$/i.test(file.name);
  return (
    <section aria-labelledby="import-h" className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 id="import-h" className="type-card">Add a dataset</h2>
      <p className="type-support mt-1">CSV, TSV, TXT, XLSX or JSON, up to {(maxBytes / 1048576).toFixed(0)} MB, {maxRows.toLocaleString("en-GB")} rows and {maxColumns} variables on this project&apos;s plan. SPSS, Stata and Parquet files: export them to CSV first.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:border-primary hover:text-primary">
          <FileUp className="h-4 w-4" aria-hidden="true" /> Choose file
          <input type="file" accept={accept} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setBlank((v) => !v)}>{blank ? "Cancel" : "Or start an empty dataset"}</button>
        {file && <span className="type-support">{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>}
      </div>

      {blank && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <label className="type-label">Name<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-control border border-line-strong px-3 py-2 text-sm" /></label>
          <label className="type-label">Variable names (comma separated)<input value={blankCols} onChange={(e) => setBlankCols(e.target.value)} className="mt-1 w-full rounded-control border border-line-strong px-3 py-2 text-sm" /></label>
          <Button size="sm" onClick={doBlank} loading={!!busy}>Create</Button>
        </div>
      )}

      {error && <p role="alert" className="mt-4 flex gap-2 rounded-control border border-danger-line bg-danger-bg p-3 text-sm text-danger-ink"><AlertTriangle className="h-4 w-4 flex-none" aria-hidden="true" />{error}</p>}

      {preview && file && (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="type-label">Dataset name<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-control border border-line-strong px-3 py-2 text-sm" /></label>
            <label className="type-label flex items-center gap-2 pt-6"><input type="checkbox" checked={opts.header !== false} onChange={(e) => change({ header: e.target.checked })} /> First row has variable names</label>
            {isText && (
              <label className="type-label">Delimiter
                <select value={opts.delimiter ?? preview.report.delimiter} onChange={(e) => change({ delimiter: e.target.value as ImportOptions["delimiter"] })} className="mt-1 w-full rounded-control border border-line-strong px-3 py-2 text-sm">
                  <option value=",">Comma</option><option value={"\t"}>Tab</option><option value=";">Semicolon</option><option value="|">Pipe</option>
                </select>
              </label>
            )}
            {isText && (
              <label className="type-label">Encoding
                <select value={opts.encoding ?? preview.report.encoding} onChange={(e) => change({ encoding: e.target.value as ImportOptions["encoding"] })} className="mt-1 w-full rounded-control border border-line-strong px-3 py-2 text-sm">
                  <option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option>
                </select>
              </label>
            )}
            {preview.report.sheets && preview.report.sheets.length > 1 && (
              <label className="type-label">Sheet
                <select value={opts.sheet ?? preview.report.sheet} onChange={(e) => change({ sheet: e.target.value })} className="mt-1 w-full rounded-control border border-line-strong px-3 py-2 text-sm">{preview.report.sheets.map((s) => <option key={s}>{s}</option>)}</select>
              </label>
            )}
            <label className="type-label">Dates written as
              <select value={opts.dateOrder} onChange={(e) => change({ dateOrder: e.target.value as "dmy" | "mdy" })} className="mt-1 w-full rounded-control border border-line-strong px-3 py-2 text-sm"><option value="dmy">Day/month/year</option><option value="mdy">Month/day/year</option></select>
            </label>
            {isText && <label className="type-label flex items-center gap-2 pt-6"><input type="checkbox" checked={!!opts.decimalComma} onChange={(e) => change({ decimalComma: e.target.checked })} /> Decimal comma (1,5)</label>}
            <label className="type-label">Skip rows at the top<input type="number" min={0} max={1000} value={opts.skipRows ?? 0} onChange={(e) => change({ skipRows: Math.max(0, Number(e.target.value) || 0) })} className="mt-1 w-full rounded-control border border-line-strong px-3 py-2 text-sm" /></label>
          </div>

          <p className="type-support">{preview.report.rows.toLocaleString("en-GB")} rows, {preview.report.columns} variables{preview.report.encoding ? `, ${preview.report.encoding}` : ""}. Check each variable&apos;s type; change it if the guess is wrong.</p>
          {preview.warnings.length > 0 && (
            <ul className="space-y-1.5">
              {preview.warnings.map((w, i) => (
                <li key={i} className={`flex gap-2 rounded-control border p-2 text-sm ${w.level === "warning" ? "border-warning-line bg-warning-bg text-warning-ink" : "border-info-line bg-info-bg text-info-ink"}`}>
                  {w.level === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <Info className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}{w.text}
                </li>
              ))}
            </ul>
          )}
          <div className="max-h-96 overflow-auto rounded-control border border-line">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-surface-soft">
                <tr>{preview.dataset.variables.map((v, j) => (
                  <th key={j} className="border-b border-line px-2 py-1.5 text-left align-top font-semibold text-ink">
                    <div className="whitespace-nowrap">{v.name}</div>
                    <select aria-label={`Type of ${v.name}`} value={opts.typeOverrides?.[j] ?? v.type} onChange={(e) => change({ typeOverrides: { ...(opts.typeOverrides ?? {}), [j]: e.target.value as VarType } })} className="mt-1 rounded border border-line-strong bg-surface px-1 py-0.5 text-xs font-normal">
                      <option value="numeric">Number</option><option value="string">Text</option><option value="date">Date</option>
                    </select>
                  </th>
                ))}</tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.min(PREVIEW_ROWS, preview.report.rows) }, (_, i) => (
                  <tr key={i} className="odd:bg-surface even:bg-canvas">{preview.dataset.columns.map((c, j) => <td key={j} className={`whitespace-nowrap px-2 py-1 ${c[i] === null ? "text-ink-muted" : "text-ink"}`}>{c[i] === null ? "·" : String(c[i])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={doImport} loading={!!busy} disabled={!name.trim()}>Import dataset</Button>
            {busy && <span className="type-support" role="status">{busy}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Operation } from "@/lib/datastudio/transform";
import { isMissing, MEASURES, ROLES, nRows, type Cell, type Dataset, type Variable } from "@/lib/datastudio/types";

const ROW_H = 30, OVERSCAN = 10, COL_W = 130;

/**
 * Spreadsheet view. Rows are virtualised (only visible rows are in the DOM), so large datasets scroll smoothly. Sorting and filtering
 * here change only the view; editing a cell records a "set_cells" step that is applied, previewed and saved like any other step.
 */
export function DataGrid({ dataset, editable, onOps }: { dataset: Dataset; editable: boolean; onOps: (ops: Operation[]) => void }) {
  const n = nRows(dataset);
  const [sort, setSort] = useState<{ j: number; desc: boolean } | null>(null);
  const [filter, setFilter] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [edit, setEdit] = useState<{ i: number; j: number; value: string } | null>(null);
  const [sel, setSel] = useState<{ i: number; j: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const order = useMemo(() => {
    let idx = Array.from({ length: n }, (_, i) => i);
    const q = filter.trim().toLowerCase();
    if (q) idx = idx.filter((i) => dataset.columns.some((c) => c[i] !== null && String(c[i]).toLowerCase().includes(q)));
    if (onlyMissing) idx = idx.filter((i) => dataset.variables.some((v, j) => isMissing(v, dataset.columns[j][i])));
    if (sort) {
      const c = dataset.columns[sort.j];
      idx.sort((a, b) => { const x = c[a], y = c[b]; if (x === y) return a - b; if (x === null) return 1; if (y === null) return -1; const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)); return sort.desc ? -r : r; });
    }
    return idx;
  }, [dataset, n, filter, onlyMissing, sort]);

  const viewH = 520;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(order.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

  function commit() {
    if (!edit) return;
    const v = dataset.variables[edit.j];
    const raw = edit.value.trim();
    const old = dataset.columns[edit.j][edit.i];
    const value: Cell = raw === "" ? null : v.type === "numeric" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
    setEdit(null);
    if (value !== old && String(value) !== String(old)) onOps([{ op: "set_cells", edits: [{ row: edit.i, name: v.name, value }] }]);
  }
  function keyNav(e: KeyboardEvent) {
    if (!sel || edit) return;
    const pos = order.indexOf(sel.i);
    const move = (di: number, dj: number) => { const np = Math.max(0, Math.min(order.length - 1, pos + di)); setSel({ i: order[np], j: Math.max(0, Math.min(dataset.variables.length - 1, sel.j + dj)) }); e.preventDefault(); };
    if (e.key === "ArrowDown") move(1, 0); else if (e.key === "ArrowUp") move(-1, 0); else if (e.key === "ArrowRight" || e.key === "Tab") move(0, 1); else if (e.key === "ArrowLeft") move(0, -1);
    else if (e.key === "Enter" && editable) { setEdit({ ...sel, value: dataset.columns[sel.j][sel.i] === null ? "" : String(dataset.columns[sel.j][sel.i]) }); e.preventDefault(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && editable && dataset.columns[sel.j][sel.i] !== null) { onOps([{ op: "set_cells", edits: [{ row: sel.i, name: dataset.variables[sel.j].name, value: null }] }]); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "c") { void navigator.clipboard.writeText(String(dataset.columns[sel.j][sel.i] ?? "")); }
  }
  async function paste(e: React.ClipboardEvent) {
    if (!sel || !editable || edit) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const rows = text.replace(/\r/g, "").split("\n").filter((r, k, a) => r !== "" || k < a.length - 1).map((r) => r.split("\t"));
    const pos = order.indexOf(sel.i);
    const edits: { row: number; name: string; value: Cell }[] = [];
    rows.forEach((r, di) => r.forEach((val, dj) => {
      const i = order[pos + di], j = sel.j + dj;
      if (i === undefined || j >= dataset.variables.length) return;
      const v = dataset.variables[j]; const t = val.trim();
      edits.push({ row: i, name: v.name, value: t === "" ? null : v.type === "numeric" && Number.isFinite(Number(t)) ? Number(t) : t });
    }));
    if (edits.length) onOps([{ op: "set_cells", edits: edits.slice(0, 20000) }]);
  }

  const totalW = 64 + dataset.variables.length * COL_W;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" placeholder="Find in data" aria-label="Find in data" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56 rounded-control border border-line-strong px-3 py-1.5 text-sm" />
        <label className="flex items-center gap-1.5 text-sm text-ink-soft"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />Rows with missing values</label>
        <span className="type-caption">{order.length.toLocaleString("en-GB")} of {n.toLocaleString("en-GB")} rows shown. {editable ? "Double-click or press Enter to edit; paste a block from a spreadsheet with Ctrl+V." : "Read-only."} Sorting and finding change only the view.</span>
      </div>
      <div ref={box} tabIndex={0} role="grid" aria-rowcount={order.length} aria-colcount={dataset.variables.length} onKeyDown={keyNav} onPaste={paste}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)} className="relative overflow-auto rounded-control border border-line bg-surface focus:outline-2" style={{ height: viewH + 34 }}>
        <div style={{ width: totalW, height: order.length * ROW_H + 34 }}>
          <div role="row" className="sticky top-0 z-10 flex border-b border-line bg-surface-soft text-xs font-semibold text-ink" style={{ height: 34 }}>
            <div className="sticky left-0 z-20 flex w-16 flex-none items-center bg-surface-soft px-2">#</div>
            {dataset.variables.map((v, j) => (
              <button key={v.name} role="columnheader" type="button" title={v.label ?? v.name} onClick={() => setSort((s) => (s?.j === j ? (s.desc ? null : { j, desc: true }) : { j, desc: false }))}
                aria-sort={sort?.j === j ? (sort.desc ? "descending" : "ascending") : "none"} className="flex flex-none items-center gap-1 truncate border-l border-line px-2 text-left hover:bg-hover" style={{ width: COL_W }}>
                <span className="truncate">{v.name}</span>{sort?.j === j && (sort.desc ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUp className="h-3 w-3" aria-hidden="true" />)}
                <span className="ml-auto text-[10px] font-normal text-ink-muted">{v.type === "numeric" ? "123" : v.type === "date" ? "date" : "abc"}</span>
              </button>
            ))}
          </div>
          {order.slice(first, last).map((i, k) => (
            <div key={i} role="row" className="absolute flex text-xs" style={{ top: 34 + (first + k) * ROW_H, height: ROW_H, width: totalW }}>
              <div className="sticky left-0 flex w-16 flex-none items-center border-b border-line bg-canvas px-2 text-ink-muted">{i + 1}</div>
              {dataset.variables.map((v, j) => {
                const c = dataset.columns[j][i];
                const miss = isMissing(v, c);
                const isSel = sel?.i === i && sel.j === j;
                const out = typeof c === "number" && ((v.validMin !== undefined && c < v.validMin) || (v.validMax !== undefined && c > v.validMax));
                if (edit && edit.i === i && edit.j === j) {
                  return <input key={j} autoFocus aria-label={`Edit ${v.name}, row ${i + 1}`} value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEdit(null); e.stopPropagation(); }} className="flex-none border border-primary px-1.5 text-xs" style={{ width: COL_W }} />;
                }
                const label = c !== null && v.valueLabels?.[String(c)];
                return (
                  <div key={j} role="gridcell" aria-selected={isSel} onClick={() => setSel({ i, j })} onDoubleClick={() => editable && setEdit({ i, j, value: c === null ? "" : String(c) })}
                    title={label ? `${c} = ${label}` : undefined}
                    className={`flex flex-none items-center truncate border-b border-l border-line px-2 ${typeof c === "number" ? "justify-end tabular-nums" : ""} ${miss ? "bg-warning-bg/60 text-ink-muted" : out ? "bg-danger-bg text-danger-ink" : "text-ink"} ${isSel ? "outline outline-2 -outline-offset-2 outline-primary" : ""}`} style={{ width: COL_W }}>
                    {c === null ? "·" : label ? label : String(c)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="type-caption">Shaded cells are missing (empty or a declared missing code); red cells are outside the variable&apos;s valid range.</p>
    </div>
  );
}

const parseLabels = (s: string): Record<string, string> | null => {
  const out: Record<string, string> = {};
  for (const part of s.split(/;|\n/)) { const m = part.match(/^\s*([^=]+?)\s*=\s*(.+?)\s*$/); if (m) out[m[1]] = m[2]; }
  return Object.keys(out).length ? out : null;
};
const labelsText = (v: Variable) => (v.valueLabels ? Object.entries(v.valueLabels).map(([k, l]) => `${k}=${l}`).join("; ") : "");

/** Variable view (like SPSS): one row per variable with every property editable. Each change is recorded as a step. */
export function VariableView({ dataset, editable, onOps }: { dataset: Dataset; editable: boolean; onOps: (ops: Operation[]) => void }) {
  const patch = (name: string, p: Record<string, unknown>) => onOps([{ op: "set_variable", name, patch: p } as Operation]);
  const cls = "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-line-strong focus:border-primary disabled:hover:border-transparent";
  return (
    <div className="overflow-x-auto rounded-control border border-line">
      <table className="min-w-full text-xs">
        <thead className="bg-surface-soft text-left text-ink">
          <tr>{["Name", "Label", "Type", "Measure", "Role", "Value labels (1=Male; 2=Female)", "Missing codes", "Valid min", "Valid max", "Decimals", "Protocol link", "Formula"].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {dataset.variables.map((v) => (
            <tr key={v.name} className="border-t border-line align-top">
              <td className="px-1 py-1"><input key={v.name} aria-label={`Name of ${v.name}`} disabled={!editable} defaultValue={v.name} className={`${cls} font-medium`} onBlur={(e) => { const to = e.target.value.trim(); if (to && to !== v.name) onOps([{ op: "rename", from: v.name, to }]); }} /></td>
              <td className="px-1 py-1"><input aria-label={`Label of ${v.name}`} disabled={!editable} defaultValue={v.label ?? ""} className={cls} onBlur={(e) => e.target.value !== (v.label ?? "") && patch(v.name, { label: e.target.value })} /></td>
              <td className="px-1 py-1"><select aria-label={`Type of ${v.name}`} disabled={!editable} value={v.type} className={cls} onChange={(e) => patch(v.name, { type: e.target.value })}><option value="numeric">Numeric</option><option value="string">Text</option><option value="date">Date</option></select></td>
              <td className="px-1 py-1"><select aria-label={`Measurement level of ${v.name}`} disabled={!editable} value={v.measure} className={cls} onChange={(e) => patch(v.name, { measure: e.target.value })}>{MEASURES.filter((m) => v.type !== "string" || m !== "scale").map((m) => <option key={m} value={m}>{m}</option>)}</select></td>
              <td className="px-1 py-1"><select aria-label={`Role of ${v.name}`} disabled={!editable} value={v.role ?? "none"} className={cls} onChange={(e) => patch(v.name, { role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></td>
              <td className="px-1 py-1"><input aria-label={`Value labels of ${v.name}`} disabled={!editable} defaultValue={labelsText(v)} className={`${cls} min-w-48`} onBlur={(e) => e.target.value !== labelsText(v) && patch(v.name, { valueLabels: parseLabels(e.target.value) })} /></td>
              <td className="px-1 py-1"><input aria-label={`Missing codes of ${v.name}`} disabled={!editable} defaultValue={(v.missingCodes ?? []).join("; ")} className={cls} onBlur={(e) => { const codes = e.target.value.split(";").map((x) => x.trim()).filter(Boolean).map((x) => (v.type === "numeric" && Number.isFinite(Number(x)) ? Number(x) : x)); if (codes.join(";") !== (v.missingCodes ?? []).join(";")) patch(v.name, { missingCodes: codes.length ? codes : null }); }} /></td>
              {(["validMin", "validMax", "decimals"] as const).map((k) => (
                <td key={k} className="px-1 py-1"><input aria-label={`${k} of ${v.name}`} type="number" disabled={!editable || v.type !== "numeric"} defaultValue={v[k] ?? ""} className={`${cls} w-20`} onBlur={(e) => { const val = e.target.value === "" ? null : Number(e.target.value); if (val !== (v[k] ?? null)) patch(v.name, { [k]: val }); }} /></td>
              ))}
              <td className="px-1 py-1"><input aria-label={`Protocol link of ${v.name}`} disabled={!editable} defaultValue={v.protocolLink ?? ""} placeholder="e.g. Primary outcome" className={cls} onBlur={(e) => e.target.value !== (v.protocolLink ?? "") && patch(v.name, { protocolLink: e.target.value })} /></td>
              <td className="max-w-56 truncate px-2 py-1 text-ink-muted" title={v.formula}>{v.formula ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

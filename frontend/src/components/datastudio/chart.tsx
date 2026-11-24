"use client";

// Publication-style SVG charts rendered from engine output (ChartData). Every mark is drawn from computed numbers; the SVG can be
// exported as vector (SVG) or rasterised (PNG) at any resolution.

import { forwardRef, type ReactNode } from "react";
import type { ChartData } from "@/lib/datastudio/engine/common";
import { DEFAULT_STYLE, PALETTES, logTicks, niceTicks, tickLabel, type ChartStyle } from "@/lib/datastudio/chart-style";

type Scale = { (v: number): number; ticks: number[] };
function linear(d0: number, d1: number, r0: number, r1: number, nice = true): Scale {
  const ticks = nice ? niceTicks(d0, d1) : [d0, d1];
  const lo = nice && ticks.length ? Math.min(d0, ticks[0]) : d0, hi = nice && ticks.length ? Math.max(d1, ticks[ticks.length - 1]) : d1;
  const f = ((v: number) => r0 + ((v - lo) / (hi - lo || 1)) * (r1 - r0)) as Scale;
  f.ticks = ticks.filter((t) => t >= lo - 1e-12 && t <= hi + 1e-12);
  return f;
}
function logScale(d0: number, d1: number, r0: number, r1: number): Scale {
  const lo = Math.log(d0), hi = Math.log(d1);
  const f = ((v: number) => r0 + ((Math.log(v) - lo) / (hi - lo || 1)) * (r1 - r0)) as Scale;
  f.ticks = logTicks(d0, d1);
  return f;
}
const ext = (v: number[]) => { const f = v.filter(Number.isFinite); return f.length ? [Math.min(...f), Math.max(...f)] : [0, 1]; };

function Frame({ s, x, y, children, xCats, legend }: { s: ChartStyle; x?: Scale; y?: Scale; children: ReactNode; xCats?: { label: string; at: number }[]; legend?: { name: string; color: string }[] }) {
  const m = margins(s, !!legend?.length);
  const fs = s.fontSize;
  return (
    <g fontFamily={s.fontFamily} fontSize={fs} fill="#222">
      {s.title && <text x={s.width / 2} y={fs * 1.6} textAnchor="middle" fontWeight="bold" fontSize={fs * 1.2}>{s.title}</text>}
      {y && y.ticks.map((t) => (
        <g key={`y${t}`}>
          {s.grid && <line x1={m.l} x2={s.width - m.r} y1={y(t)} y2={y(t)} stroke="#E3E3E3" strokeWidth={1} />}
          <text x={m.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={fs * 0.9}>{tickLabel(t)}</text>
        </g>
      ))}
      {x && x.ticks.map((t) => (
        <g key={`x${t}`}>
          {s.grid && <line y1={m.t} y2={s.height - m.b} x1={x(t)} x2={x(t)} stroke="#EFEFEF" strokeWidth={1} />}
          <text x={x(t)} y={s.height - m.b + fs + 4} textAnchor="middle" fontSize={fs * 0.9}>{tickLabel(t)}</text>
        </g>
      ))}
      {xCats?.map((c) => <text key={c.label} x={c.at} y={s.height - m.b + fs + 4} textAnchor="middle" fontSize={fs * 0.9}>{c.label.length > 18 ? `${c.label.slice(0, 17)}…` : c.label}</text>)}
      <line x1={m.l} x2={m.l} y1={m.t} y2={s.height - m.b} stroke="#333" />
      <line x1={m.l} x2={s.width - m.r} y1={s.height - m.b} y2={s.height - m.b} stroke="#333" />
      {s.xLabel && <text x={(m.l + s.width - m.r) / 2} y={s.height - 8} textAnchor="middle">{s.xLabel}</text>}
      {s.yLabel && <text transform={`translate(${fs + 2}, ${(m.t + s.height - m.b) / 2}) rotate(-90)`} textAnchor="middle">{s.yLabel}</text>}
      {children}
      {s.showLegend && legend && legend.length > 1 && (
        <g transform={`translate(${s.width - m.r + 10}, ${m.t})`}>
          {legend.map((l, i) => (
            <g key={l.name} transform={`translate(0, ${i * (fs + 6)})`}>
              <rect width={fs} height={fs} fill={l.color} />
              <text x={fs + 5} y={fs / 2} dominantBaseline="middle" fontSize={fs * 0.9}>{l.name.length > 16 ? `${l.name.slice(0, 15)}…` : l.name}</text>
            </g>
          ))}
        </g>
      )}
    </g>
  );
}
const margins = (s: ChartStyle, legend: boolean) => ({ t: s.title ? s.fontSize * 3 : s.fontSize * 1.5, r: legend && s.showLegend ? 140 : 20, b: s.fontSize * 3.6, l: s.fontSize * 5 });

function body(chart: ChartData, s: ChartStyle): ReactNode {
  const m = margins(s, chart.kind === "bar" ? chart.series.length > 1 : chart.kind === "step" ? chart.series.length > 1 : false);
  const X0 = m.l, X1 = s.width - m.r, Y0 = s.height - m.b, Y1 = m.t;
  const col = (i: number) => PALETTES[s.palette].colors[i % PALETTES[s.palette].colors.length];
  const yDom = (lo: number, hi: number) => [s.yMin ?? lo, s.yMax ?? hi] as const;
  switch (chart.kind) {
    case "histogram": {
      const xs = linear(chart.bins[0]?.lo ?? 0, chart.bins[chart.bins.length - 1]?.hi ?? 1, X0, X1);
      const [a, b] = yDom(0, Math.max(...chart.bins.map((b2) => b2.count), 1));
      const ys = linear(a, b, Y0, Y1);
      const width = chart.bins.length ? chart.bins[0].hi - chart.bins[0].lo : 1;
      let curve: string | null = null;
      if (chart.normal && chart.normal.sd > 0) {
        const pts: string[] = [];
        const [lo, hi] = [chart.bins[0].lo, chart.bins[chart.bins.length - 1].hi];
        for (let k = 0; k <= 80; k++) { const xv = lo + ((hi - lo) * k) / 80; const dens = Math.exp(-0.5 * ((xv - chart.normal.mean) / chart.normal.sd) ** 2) / (chart.normal.sd * Math.sqrt(2 * Math.PI)); pts.push(`${xs(xv)},${ys(dens * chart.normal.n * width)}`); }
        curve = pts.join(" ");
      }
      return <Frame s={s} x={xs} y={ys}>{chart.bins.map((b2, i) => <rect key={i} x={xs(b2.lo)} y={ys(b2.count)} width={Math.max(0.5, xs(b2.hi) - xs(b2.lo) - 1)} height={Math.max(0, Y0 - ys(b2.count))} fill={col(0)} fillOpacity={0.75} stroke="#fff" />)}{curve && <polyline points={curve} fill="none" stroke={col(3)} strokeWidth={s.lineWidth} />}</Frame>;
    }
    case "box": {
      const all = chart.groups.flatMap((g) => [g.min, g.max]);
      const [lo, hi] = ext(all);
      const [a, b] = yDom(lo, hi);
      const ys = linear(a, b, Y0, Y1);
      const bw = (X1 - X0) / chart.groups.length;
      return (
        <Frame s={s} y={ys} xCats={chart.groups.map((g, i) => ({ label: g.label, at: X0 + bw * (i + 0.5) }))}>
          {chart.groups.map((g, i) => {
            const cx = X0 + bw * (i + 0.5), w = Math.min(60, bw * 0.5);
            return (
              <g key={i} stroke="#222" strokeWidth={s.lineWidth}>
                <line x1={cx} x2={cx} y1={ys(g.whiskerLo)} y2={ys(g.q1)} /><line x1={cx} x2={cx} y1={ys(g.q3)} y2={ys(g.whiskerHi)} />
                <line x1={cx - w / 4} x2={cx + w / 4} y1={ys(g.whiskerLo)} y2={ys(g.whiskerLo)} /><line x1={cx - w / 4} x2={cx + w / 4} y1={ys(g.whiskerHi)} y2={ys(g.whiskerHi)} />
                <rect x={cx - w / 2} y={ys(g.q3)} width={w} height={Math.max(1, ys(g.q1) - ys(g.q3))} fill={col(i)} fillOpacity={0.35} />
                <line x1={cx - w / 2} x2={cx + w / 2} y1={ys(g.median)} y2={ys(g.median)} strokeWidth={s.lineWidth * 2} />
                <path d={`M${cx - 4},${ys(g.mean)} l4,-4 l4,4 l-4,4 z`} fill="#fff" />
                {g.outliers.map((o, k) => <circle key={k} cx={cx} cy={ys(o)} r={s.markerSize} fill="none" />)}
              </g>
            );
          })}
        </Frame>
      );
    }
    case "means": {
      const [lo, hi] = ext(chart.groups.flatMap((g) => [g.lo, g.hi]));
      // An error-bar plot of means is about the intervals, so the axis fits them rather than starting at zero (unlike a bar chart).
      const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
      const [a, b] = yDom(lo - pad, hi + pad);
      const ys = linear(a, b, Y0, Y1);
      const bw = (X1 - X0) / chart.groups.length;
      return <Frame s={s} y={ys} xCats={chart.groups.map((g, i) => ({ label: g.label, at: X0 + bw * (i + 0.5) }))}>{chart.groups.map((g, i) => { const cx = X0 + bw * (i + 0.5); return <g key={i} stroke={col(i)} strokeWidth={s.lineWidth}><line x1={cx} x2={cx} y1={ys(g.lo)} y2={ys(g.hi)} /><line x1={cx - 8} x2={cx + 8} y1={ys(g.lo)} y2={ys(g.lo)} /><line x1={cx - 8} x2={cx + 8} y1={ys(g.hi)} y2={ys(g.hi)} /><circle cx={cx} cy={ys(g.mean)} r={s.markerSize + 2} fill={col(i)} /></g>; })}</Frame>;
    }
    case "bar": {
      const max = Math.max(...chart.series.flatMap((x) => x.values), 0);
      const [a, b] = yDom(0, max || 1);
      const ys = linear(a, b, Y0, Y1);
      const bw = (X1 - X0) / chart.categories.length, inner = (bw * 0.8) / chart.series.length;
      return <Frame s={s} y={ys} xCats={chart.categories.map((c, i) => ({ label: c, at: X0 + bw * (i + 0.5) }))} legend={chart.series.map((x, i) => ({ name: x.name, color: col(i) }))}>{chart.categories.map((_, i) => chart.series.map((se, k) => <rect key={`${i}-${k}`} x={X0 + bw * i + bw * 0.1 + inner * k} y={ys(se.values[i])} width={inner - 1} height={Math.max(0, Y0 - ys(se.values[i]))} fill={col(k)} />))}</Frame>;
    }
    case "scatter": {
      const [x0, x1] = ext(chart.points.map((p) => p[0])), [y0, y1] = ext(chart.points.map((p) => p[1]));
      const xs = linear(x0, x1, X0, X1);
      const [a, b] = yDom(y0, y1);
      const ys = linear(a, b, Y0, Y1);
      return (
        <Frame s={s} x={xs} y={ys}>
          {chart.refY !== undefined && <line x1={X0} x2={X1} y1={ys(chart.refY)} y2={ys(chart.refY)} stroke="#999" strokeDasharray="4 3" />}
          {chart.points.map((p, i) => <circle key={i} cx={xs(p[0])} cy={ys(p[1])} r={s.markerSize} fill={col(0)} fillOpacity={0.6} />)}
          {chart.line && <line x1={xs(x0)} x2={xs(x1)} y1={ys(chart.line.intercept + chart.line.slope * x0)} y2={ys(chart.line.intercept + chart.line.slope * x1)} stroke={col(3)} strokeWidth={s.lineWidth * 1.5} />}
        </Frame>
      );
    }
    case "qq": {
      const [lo, hi] = ext(chart.points.flat());
      const xs = linear(lo, hi, X0, X1), ys = linear(lo, hi, Y0, Y1);
      return <Frame s={{ ...s, xLabel: s.xLabel ?? "Theoretical quantile", yLabel: s.yLabel ?? "Standardised sample quantile" }} x={xs} y={ys}><line x1={xs(lo)} x2={xs(hi)} y1={ys(lo)} y2={ys(hi)} stroke="#999" strokeDasharray="4 3" />{chart.points.map((p, i) => <circle key={i} cx={xs(p[0])} cy={ys(p[1])} r={s.markerSize} fill={col(0)} fillOpacity={0.7} />)}</Frame>;
    }
    case "step": {
      const xmax = Math.max(...chart.series.flatMap((x) => [...x.points.map((p) => p[0]), ...(x.censored ?? []).map((c) => c[0])]), 1);
      const xs = linear(0, xmax, X0, X1), ys = linear(s.yMin ?? 0, s.yMax ?? 1, Y0, Y1);
      const path = (pts: [number, number][]) => pts.map((p, i) => (i === 0 ? `M${xs(p[0])},${ys(p[1])}` : `H${xs(p[0])}V${ys(p[1])}`)).join("") + `H${xs(xmax)}`;
      return (
        <Frame s={s} x={xs} y={ys} legend={chart.series.map((x, i) => ({ name: x.name, color: col(i) }))}>
          {chart.series.map((se, i) => (
            <g key={i}>
              {s.showCi && se.lower && <path d={path(se.lower)} fill="none" stroke={col(i)} strokeDasharray="3 3" strokeWidth={s.lineWidth * 0.7} opacity={0.7} />}
              {s.showCi && se.upper && <path d={path(se.upper)} fill="none" stroke={col(i)} strokeDasharray="3 3" strokeWidth={s.lineWidth * 0.7} opacity={0.7} />}
              <path d={path(se.points)} fill="none" stroke={col(i)} strokeWidth={s.lineWidth * 1.4} />
              {se.censored?.map((c, k) => <line key={k} x1={xs(c[0])} x2={xs(c[0])} y1={ys(c[1]) - 4} y2={ys(c[1]) + 4} stroke={col(i)} />)}
            </g>
          ))}
        </Frame>
      );
    }
    case "roc": {
      const xs = linear(0, 1, X0, X1), ys = linear(0, 1, Y0, Y1);
      return <Frame s={{ ...s, xLabel: s.xLabel ?? "1 - specificity", yLabel: s.yLabel ?? "Sensitivity" }} x={xs} y={ys}><line x1={xs(0)} x2={xs(1)} y1={ys(0)} y2={ys(1)} stroke="#999" strokeDasharray="4 3" /><polyline points={chart.points.map((p) => `${xs(p[0])},${ys(p[1])}`).join(" ")} fill="none" stroke={col(0)} strokeWidth={s.lineWidth * 1.5} /></Frame>;
    }
    case "forest": {
      const vals = chart.rows.flatMap((r) => [r.lo, r.hi, r.est]).filter((v) => Number.isFinite(v) && (!chart.log || v > 0));
      let [lo, hi] = ext([...vals, chart.ref]);
      if (chart.log) { lo = Math.max(lo, 1e-3); hi = Math.min(hi, 1e3); }
      const left = Math.min(260, s.width * 0.38);
      const xs = chart.log ? logScale(lo * 0.9, hi * 1.1, X0 + left, X1) : linear(lo, hi, X0 + left, X1);
      const rowH = Math.min(28, (Y0 - Y1) / Math.max(1, chart.rows.length));
      const clip = (v: number) => Math.max(X0 + left, Math.min(X1, xs(v)));
      return (
        <Frame s={{ ...s, yLabel: undefined }} x={xs}>
          <line x1={xs(chart.ref)} x2={xs(chart.ref)} y1={Y1} y2={Y0} stroke="#999" strokeDasharray="4 3" />
          {chart.rows.map((r, i) => {
            const cy = Y1 + rowH * (i + 0.5);
            return (
              <g key={i}>
                <text x={X0 + 4} y={cy} dominantBaseline="middle" fontSize={s.fontSize * 0.9}>{r.label.length > 34 ? `${r.label.slice(0, 33)}…` : r.label}</text>
                {Number.isFinite(r.lo) && Number.isFinite(r.hi) && <line x1={clip(r.lo)} x2={clip(r.hi)} y1={cy} y2={cy} stroke={col(0)} strokeWidth={s.lineWidth} />}
                {Number.isFinite(r.est) && <rect x={clip(r.est) - 4} y={cy - 4} width={8} height={8} fill={col(0)} />}
              </g>
            );
          })}
        </Frame>
      );
    }
    case "heatmap": {
      const n = chart.labels.length, size = Math.min((X1 - X0) / n, (Y0 - Y1) / n);
      const color = (v: number | null) => { if (v === null) return "#F2F2F2"; const t = Math.max(-1, Math.min(1, v)); return t >= 0 ? `rgb(${Math.round(255 - 200 * t)},${Math.round(255 - 140 * t)},255)` : `rgb(255,${Math.round(255 + 140 * t)},${Math.round(255 + 200 * t)})`; };
      return (
        <g fontFamily={s.fontFamily} fontSize={s.fontSize * 0.85}>
          {s.title && <text x={s.width / 2} y={s.fontSize * 1.6} textAnchor="middle" fontWeight="bold" fontSize={s.fontSize * 1.2}>{s.title}</text>}
          {chart.values.map((row, i) => row.map((v, j) => (
            <g key={`${i}-${j}`}>
              <rect x={X0 + j * size} y={Y1 + i * size} width={size - 1} height={size - 1} fill={color(v)} />
              {size > 26 && <text x={X0 + j * size + size / 2} y={Y1 + i * size + size / 2} textAnchor="middle" dominantBaseline="middle">{v === null ? "" : v.toFixed(2)}</text>}
            </g>
          )))}
          {chart.labels.map((l, i) => <text key={`r${i}`} x={X0 - 4} y={Y1 + i * size + size / 2} textAnchor="end" dominantBaseline="middle">{l.slice(0, 14)}</text>)}
          {chart.labels.map((l, j) => <text key={`c${j}`} transform={`translate(${X0 + j * size + size / 2}, ${Y1 + n * size + 6}) rotate(40)`}>{l.slice(0, 14)}</text>)}
        </g>
      );
    }
    case "bland_altman": {
      const [x0, x1] = ext(chart.points.map((p) => p[0]));
      const [y0, y1] = ext([...chart.points.map((p) => p[1]), chart.loaLo, chart.loaHi]);
      const xs = linear(x0, x1, X0, X1), ys = linear(y0, y1, Y0, Y1);
      return (
        <Frame s={{ ...s, xLabel: s.xLabel ?? "Mean of the two methods", yLabel: s.yLabel ?? "Difference" }} x={xs} y={ys}>
          {chart.points.map((p, i) => <circle key={i} cx={xs(p[0])} cy={ys(p[1])} r={s.markerSize} fill={col(0)} fillOpacity={0.6} />)}
          <line x1={X0} x2={X1} y1={ys(chart.bias)} y2={ys(chart.bias)} stroke={col(3)} strokeWidth={s.lineWidth} />
          {[chart.loaLo, chart.loaHi].map((v, i) => <line key={i} x1={X0} x2={X1} y1={ys(v)} y2={ys(v)} stroke={col(3)} strokeDasharray="5 4" strokeWidth={s.lineWidth} />)}
        </Frame>
      );
    }
  }
}

/** The chart as an <svg>. Forwarded ref gives the export functions the element. */
export const Chart = forwardRef<SVGSVGElement, { chart: ChartData; style?: Partial<ChartStyle>; responsive?: boolean }>(function Chart({ chart, style, responsive = true }, ref) {
  const s: ChartStyle = { ...DEFAULT_STYLE, title: chart.title, ...(chart.kind === "scatter" ? { xLabel: chart.xLabel, yLabel: chart.yLabel } : {}), ...(chart.kind === "step" ? { xLabel: chart.xLabel, yLabel: chart.yLabel } : {}), ...(chart.kind === "forest" ? { xLabel: chart.xLabel } : {}), ...((chart.kind === "box" || chart.kind === "bar" || chart.kind === "means") ? { yLabel: chart.yLabel } : {}), ...(chart.kind === "histogram" ? { xLabel: chart.variable, yLabel: "Count" } : {}), ...stripUndefined(style ?? {}) };
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${s.width} ${s.height}`} width={responsive ? "100%" : s.width} height={responsive ? undefined : s.height} role="img" aria-label={s.title ?? chart.title} style={{ maxWidth: s.width, background: "#fff" }}>
      <rect width={s.width} height={s.height} fill="#fff" />
      {body(chart, s)}
    </svg>
  );
});

function stripUndefined<T extends object>(o: T): Partial<T> { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>; }

/** Serialises an SVG element to a standalone file. */
export function svgString(el: SVGSVGElement, width: number, height: number): string {
  const clone = el.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(width)); clone.setAttribute("height", String(height));
  clone.removeAttribute("style");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/** Rasterises the SVG to PNG at `scale` times its size (e.g. 300 dpi for a 96 dpi layout is scale 3.125). */
export async function pngBlob(el: SVGSVGElement, width: number, height: number, scale: number): Promise<Blob> {
  const svg = svgString(el, width, height);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("render failed")); img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}

export function download(name: string, data: Blob | string, type = "text/plain") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

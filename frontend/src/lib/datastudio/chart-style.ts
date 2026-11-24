// Chart styling and scale helpers shared by the SVG renderer and the chart builder. Pure functions, no React.

export type Palette = "okabe_ito" | "toprot" | "grayscale" | "viridis";
export const PALETTES: Record<Palette, { label: string; colors: string[] }> = {
  // Okabe & Ito (2008): distinguishable with the common forms of colour-vision deficiency.
  okabe_ito: { label: "Colour-blind safe (Okabe-Ito)", colors: ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#F0E442", "#000000"] },
  toprot: { label: "Toprot", colors: ["#375DF5", "#0BAE9B", "#142C50", "#C58A36", "#5B4BB8", "#A8432C", "#0B6E8A", "#8A5D1C"] },
  grayscale: { label: "Grayscale (print)", colors: ["#111111", "#555555", "#888888", "#B0B0B0", "#333333", "#777777", "#9E9E9E", "#CCCCCC"] },
  viridis: { label: "Viridis", colors: ["#440154", "#3B528B", "#21918C", "#5EC962", "#FDE725", "#31688E", "#35B779", "#90D743"] },
};

export type ChartStyle = {
  title?: string; xLabel?: string; yLabel?: string; width: number; height: number; fontSize: number; fontFamily: string;
  palette: Palette; grid: boolean; lineWidth: number; markerSize: number; showLegend: boolean; refLine?: number | null;
  yMin?: number | null; yMax?: number | null; xLog?: boolean; showCi?: boolean;
};

export const DEFAULT_STYLE: ChartStyle = {
  width: 640, height: 420, fontSize: 12, fontFamily: "Arial, Helvetica, sans-serif", palette: "okabe_ito", grid: true, lineWidth: 1.5,
  markerSize: 3, showLegend: true, refLine: null, yMin: null, yMax: null, showCi: true,
};

/** "Nice" tick values covering [lo, hi] (Heckbert's algorithm). */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo === hi) { lo -= 1; hi += 1; }
  const nice = (x: number, round: boolean) => {
    const e = Math.floor(Math.log10(x)), f = x / 10 ** e;
    const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * 10 ** e;
  };
  const range = nice(hi - lo, false);
  const step = nice(range / (count - 1), true);
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(+v.toPrecision(12));
  return out;
}

export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  const cands = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 4, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (const c of cands) if (c >= lo * 0.999 && c <= hi * 1.001) out.push(c);
  return out.length >= 2 ? out : [lo, hi];
}

export const tickLabel = (v: number) => {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1);
  return String(+v.toPrecision(6));
};

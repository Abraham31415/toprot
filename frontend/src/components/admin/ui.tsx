import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, Info, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ds/card";
import { RANGE_KEYS, RANGE_LABEL, type DateRange } from "@/lib/admin/range";

// Building blocks for the admin pages. They are server components with no data of their own: each page passes in what it loaded.

export function PageTitle({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="type-page !text-[1.5rem]">{title}</h1>
        {lead && <p className="type-support mt-1 max-w-3xl !text-ink-soft">{lead}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Section({ title, lead, children, id }: { title: string; lead?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="mt-8">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {lead && <p className="type-support mt-0.5 max-w-3xl">{lead}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function KpiGrid({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 | 5 }) {
  const c = cols === 5 ? "lg:grid-cols-5" : cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4";
  return <div className={`grid grid-cols-2 gap-3 ${c}`}>{children}</div>;
}

/** One figure. `note` says how it was worked out or what it leaves out; `estimate` marks a figure that is not a recorded fact. */
export function Kpi({ label, value, note, icon: Icon, estimate = false }: { label: string; value: ReactNode; note?: ReactNode; icon?: LucideIcon; estimate?: boolean }) {
  return (
    <Card padding="sm" className="!p-4">
      <p className="type-caption flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
        <span>{label}</span>
        {estimate && <span className="rounded-full border border-warning-line bg-warning-bg px-1.5 text-[10px] font-medium text-warning-ink">Estimate</span>}
      </p>
      <p className="type-stat mt-1.5 break-words">{value}</p>
      {note && <p className="type-caption mt-1">{note}</p>}
    </Card>
  );
}

const TONE = {
  info: { cls: "border-info-line bg-info-bg/60 text-ink-soft", icon: Info },
  warning: { cls: "border-warning-line bg-warning-bg text-warning-ink", icon: CircleAlert },
  setup: { cls: "border-line-strong bg-surface text-ink-soft", icon: Settings2 },
  danger: { cls: "border-danger-line bg-danger-bg text-danger-ink", icon: CircleAlert },
} as const;

/** A message about the data: how it is defined, what is missing, or what has to be set up. */
export function Notice({ tone = "info", title, children }: { tone?: keyof typeof TONE; title?: string; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={`mt-4 flex items-start gap-2.5 rounded-card border p-3 text-sm ${t.cls}`}>
      <t.icon className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      <div className="min-w-0">{title && <p className="font-medium text-ink">{title}</p>}<div className={title ? "mt-0.5" : ""}>{children}</div></div>
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "success" | "warning" | "danger" | "info"; children: ReactNode }) {
  const cls = { neutral: "border-line bg-canvas text-ink-soft", success: "border-success-line bg-success-bg text-success-ink", warning: "border-warning-line bg-warning-bg text-warning-ink", danger: "border-danger-line bg-danger-bg text-danger-ink", info: "border-info-line bg-info-bg text-info-ink" }[tone];
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

/** A plain table. Headings are real column headers; an empty table says so instead of showing nothing. */
export function Table({ caption, head, rows, empty = "Nothing to show.", numeric = [] }: { caption: string; head: string[]; rows: ReactNode[][]; empty?: string; numeric?: number[] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-canvas">
          <tr>{head.map((h, i) => <th key={h + i} scope="col" className={`border-b border-line px-3 py-2 type-label ${numeric.includes(i) ? "text-right" : ""}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={head.length} className="px-3 py-6 text-center text-ink-muted">{empty}</td></tr> : rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">{r.map((c, j) => <td key={j} className={`px-3 py-2 ${numeric.includes(j) ? "text-right tabular-nums" : ""}`}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Previous and next links for a table paged on the server. The page number lives in the address. */
export function Pager({ total, page, pageSize, hrefFor }: { total: number; page: number; pageSize: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const link = "rounded-control border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:border-primary";
  return (
    <nav aria-label="Pages" className="mt-3 flex items-center justify-between gap-3 text-sm">
      <p className="type-support" role="status">{total === 0 ? "No results" : `Showing ${(page - 1) * pageSize + 1} to ${Math.min(page * pageSize, total)} of ${total.toLocaleString("en-GB")}`}</p>
      <div className="flex gap-2">
        {page > 1 ? <Link href={hrefFor(page - 1)} className={link} rel="prev">Previous</Link> : <span className={`${link} pointer-events-none opacity-50`} aria-disabled="true">Previous</span>}
        {page < pages ? <Link href={hrefFor(page + 1)} className={link} rel="next">Next</Link> : <span className={`${link} pointer-events-none opacity-50`} aria-disabled="true">Next</span>}
      </div>
    </nav>
  );
}

/** Preset ranges and a custom range. It is a plain GET form, so it works without scripts and the range is in the address. */
export function RangeFilter({ range, base, keep = {} }: { range: DateRange; base: string; keep?: Record<string, string | undefined> }) {
  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) p.set(k, v);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `${base}?${p.toString()}`;
  };
  return (
    <div className="mt-4 rounded-card border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-label mr-1">Period</span>
        {RANGE_KEYS.filter((k) => k !== "custom").map((k) => (
          <Link key={k} href={q({ range: k })} aria-current={range.key === k ? "true" : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium ${range.key === k ? "border-primary bg-primary text-white" : "border-line-strong bg-surface text-ink hover:border-primary"}`}>{RANGE_LABEL[k]}</Link>
        ))}
        <form action={base} method="get" className="flex flex-wrap items-center gap-2">
          {Object.entries(keep).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
          <input type="hidden" name="range" value="custom" />
          <label className="sr-only" htmlFor="rf-from">From</label><input id="rf-from" type="date" name="from" defaultValue={range.fromDay} className="h-8 rounded-control border border-line-strong bg-surface px-2 text-xs" />
          <span className="text-xs text-ink-muted" aria-hidden="true">to</span>
          <label className="sr-only" htmlFor="rf-to">To</label><input id="rf-to" type="date" name="to" defaultValue={range.toDay} className="h-8 rounded-control border border-line-strong bg-surface px-2 text-xs" />
          <button type="submit" className="h-8 rounded-control border border-line-strong bg-surface px-3 text-xs font-medium hover:border-primary">Apply</button>
        </form>
      </div>
      <p className="type-caption mt-2">Showing {range.label}. Days are in {range.tz}. The end date is included.</p>
      {range.error && <p role="alert" className="mt-1 text-xs text-warning-ink">{range.error}</p>}
    </div>
  );
}

/** Horizontal bars for a short list. The values are also printed, so nothing depends on seeing the bar. */
export function Bars({ rows, format = (n: number) => n.toLocaleString("en-GB"), max }: { rows: { label: string; value: number; note?: string }[]; format?: (n: number) => string; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="type-support">Nothing recorded in this period.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-ink" title={r.label}>{r.label}</span><span className="tabular-nums text-ink-soft">{format(r.value)}{r.note ? ` ${r.note}` : ""}</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-navy/10" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (100 * r.value) / top)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export type Series = { name: string; values: number[]; color: "primary" | "teal" | "navy" };
const STROKE = { primary: "var(--color-primary)", teal: "var(--color-teal)", navy: "var(--color-navy)" } as const;

/** A line chart for values over days. The numbers are in a table below it for anyone who cannot see the lines. */
export function LineChart({ labels, series, format = (n: number) => n.toLocaleString("en-GB"), title }: { labels: string[]; series: Series[]; format?: (n: number) => string; title: string }) {
  const W = 640, H = 180, P = 28;
  if (labels.length === 0) return <p className="type-support">Nothing recorded in this period.</p>;
  const top = Math.max(1e-9, ...series.flatMap((s) => s.values));
  const x = (i: number) => P + (labels.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (labels.length - 1));
  const y = (v: number) => H - P - (v / top) * (H - 2 * P);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="h-auto w-full">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--color-line-strong)" />
        <text x={P} y={12} fontSize="10" fill="var(--color-ink-muted)">{format(top)}</text>
        <text x={P} y={H - 8} fontSize="10" fill="var(--color-ink-muted)">{labels[0]}</text>
        <text x={W - P} y={H - 8} fontSize="10" textAnchor="end" fill="var(--color-ink-muted)">{labels[labels.length - 1]}</text>
        {series.map((s) => (
          <g key={s.name}>
            <polyline fill="none" stroke={STROKE[s.color]} strokeWidth="2" strokeLinejoin="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {labels.length <= 31 && s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={STROKE[s.color]} />)}
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-3 text-xs text-ink-soft">{series.map((s) => <span key={s.name} className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full" style={{ background: STROKE[s.color] }} aria-hidden="true" />{s.name}</span>)}</figcaption>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-primary">Show the numbers</summary>
        <div className="mt-2 max-h-60 overflow-auto"><table className="w-full text-left"><thead><tr><th scope="col" className="pr-3">Day</th>{series.map((s) => <th key={s.name} scope="col" className="pr-3">{s.name}</th>)}</tr></thead>
          <tbody>{labels.map((l, i) => <tr key={l}><td className="pr-3">{l}</td>{series.map((s) => <td key={s.name} className="pr-3 tabular-nums">{format(s.values[i])}</td>)}</tr>)}</tbody></table></div>
      </details>
    </figure>
  );
}

/** A form control row used by the admin forms. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-ink">{label}</span>{children}{hint && <span className="type-caption">{hint}</span>}</label>;
}
export const inputCls = "h-9 w-full rounded-control border border-line-strong bg-surface px-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/25";
export const buttonCls = "h-9 rounded-control bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60";
export const dangerButtonCls = "h-9 rounded-control border border-danger-line bg-danger-bg px-4 text-sm font-semibold text-danger-ink hover:border-danger-ink disabled:opacity-60";

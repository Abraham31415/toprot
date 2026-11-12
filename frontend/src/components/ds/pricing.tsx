import { Check, ChevronDown, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "./card";

// Pricing: a plan card, a comparison table and an accordion for the questions people ask. All text comes from the caller, so
// prices and limits can come from the billing configuration and never be written into a component.

/** One plan. The highlighted plan gets a cobalt border and a soft blue header band; the others stay quiet. */
export function PricingCard({ name, price, period, description, features, cta, highlighted = false, badge, footnote }: {
  name: string; price: string; period?: string; description: string; features: string[]; cta: ReactNode; highlighted?: boolean; badge?: ReactNode; footnote?: ReactNode;
}) {
  return (
    <Card tone={highlighted ? "highlight" : "default"} padding="lg" className={`relative flex h-full flex-col ${highlighted ? "overflow-hidden" : ""}`}>
      {highlighted && <div aria-hidden="true" className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-surface-soft to-transparent" />}
      <div className="relative flex flex-1 flex-col">
        <div className="flex items-center justify-between gap-3">
          <h3 className="type-card !text-lg">{name}</h3>
          {badge}
        </div>
        <p className="mt-4 flex items-baseline gap-1.5"><span className="type-hero !text-[2.75rem] !leading-none">{price}</span>{period && <span className="type-support">{period}</span>}</p>
        <p className="type-body mt-3">{description}</p>
        <ul className="mt-5 space-y-2.5">
          {features.map((f) => (
            <li key={f} className="type-body flex items-start gap-2.5 !text-ink"><Check className="mt-0.5 h-4 w-4 flex-none text-teal-ink" aria-hidden="true" /><span>{f}</span></li>
          ))}
        </ul>
        <div className="mt-6 pt-1">{cta}</div>
        {footnote && <p className="type-caption mt-3">{footnote}</p>}
      </div>
    </Card>
  );
}

export type ComparisonRow = { label: string; values: (boolean | string)[]; group?: string };

/** Plans side by side. A tick or dash always comes with words for screen readers, so the table reads without colour or symbols. */
export function FeatureComparison({ columns, rows, caption, highlightColumn }: { columns: string[]; rows: ComparisonRow[]; caption: string; highlightColumn?: number }) {
  // A group heading goes before the first row of each group. Worked out up front so rendering does not reassign anything.
  const startsGroup = rows.map((r, i) => !!r.group && r.group !== rows[i - 1]?.group);
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
      <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-canvas">
            <th scope="col" className="px-4 py-3 type-label">Feature</th>
            {columns.map((c, i) => <th key={c} scope="col" className={`px-4 py-3 text-center type-label ${i === highlightColumn ? "bg-surface-soft/70 !text-primary-hover" : ""}`}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r, ri) => {
            const out: ReactNode[] = [];
            if (startsGroup[ri]) {
              out.push(<tr key={`g-${r.group}`} className="bg-canvas"><th scope="colgroup" colSpan={columns.length + 1} className="px-4 py-2 type-eyebrow !text-ink-muted">{r.group}</th></tr>);
            }
            out.push(
              <tr key={r.label} className="border-t border-line">
                <th scope="row" className="px-4 py-3 font-normal text-ink">{r.label}</th>
                {r.values.map((v, i) => (
                  <td key={i} className={`px-4 py-3 text-center ${i === highlightColumn ? "bg-surface-soft/40" : ""}`}>
                    {v === true ? <><Check className="mx-auto h-4 w-4 text-teal-ink" aria-hidden="true" /><span className="sr-only">Included</span></>
                      : v === false ? <><Minus className="mx-auto h-4 w-4 text-ink-muted" aria-hidden="true" /><span className="sr-only">Not included</span></>
                      : <span className="text-ink">{v}</span>}
                  </td>
                ))}
              </tr>,
            );
            return out;
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Questions and answers that open and close. Built on <details>, so keyboard and screen-reader behaviour is the browser's own. */
export function Accordion({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {items.map((it) => (
        <details key={it.q} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 type-card hover:bg-hover [&::-webkit-details-marker]:hidden">
            {it.q}
            <ChevronDown className="h-4 w-4 flex-none text-ink-muted transition group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="type-body px-5 pb-5">{it.a}</div>
        </details>
      ))}
    </div>
  );
}

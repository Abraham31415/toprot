import type { ReactNode } from "react";
import { BookOpen, Calculator, FlaskConical, FilePen, Library, Search, ShieldCheck } from "lucide-react";

/**
 * Product previews for the marketing pages. They mirror the real screens using sample data
 * (fictional) and are always labelled. A screen for a tool that is not built yet would be labelled as a concept.
 */

export function BrowserFrame({
  url,
  label,
  concept = false,
  children,
}: {
  url: string;
  label: string;
  concept?: boolean;
  children: ReactNode;
}) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-line bg-paper px-3 py-2">
        <span className="flex gap-1" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-navy/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-navy/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-navy/15" />
        </span>
        <span className="mx-auto truncate rounded-md bg-white px-3 py-0.5 text-xs text-navy/55">{url}</span>
      </div>
      <div className="p-4 sm:p-5" aria-hidden="true">
        {children}
      </div>
      <figcaption
        className={`border-t border-line px-4 py-2 text-xs ${concept ? "bg-gold/10 text-[#8a5d1c]" : "bg-paper text-navy/65"}`}
      >
        {concept ? "Concept preview. This tool is planned and not available yet." : label}
      </figcaption>
    </figure>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-navy/10">
      <div className="h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DashboardPreview() {
  return (
    <BrowserFrame url="toprot.vercel.app/dashboard" label="Research dashboard, shown with sample data.">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Studies", "2"],
          ["Protocol completion", "68%"],
          ["Documents", "5"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-paper p-3">
            <p className="text-xs text-navy/60">{k}</p>
            <p className="text-xl font-semibold text-navy">{v}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {[
          ["Malaria prevalence in school children", 82],
          ["Hypertension control in clinic patients", 54],
        ].map(([t, p]) => (
          <div key={String(t)} className="rounded-lg border border-line p-3">
            <p className="text-sm font-medium text-navy">{t}</p>
            <p className="mb-1 mt-2 text-xs text-navy/60">Protocol {p}%</p>
            <Bar pct={Number(p)} />
          </div>
        ))}
      </div>
    </BrowserFrame>
  );
}

export function ProtocolPreview() {
  const rows: [string, boolean][] = [
    ["Study identity", true],
    ["Objectives", true],
    ["Population", true],
    ["Variables", true],
    ["Statistics", false],
    ["Ethics", false],
  ];
  return (
    <BrowserFrame url="toprot.vercel.app/studies/…/protocol" label="Protocol builder, shown with sample data.">
      <div className="flex items-center gap-2 text-navy">
        <FlaskConical className="h-4 w-4 text-cobalt" aria-hidden="true" />
        <p className="text-sm font-semibold">Protocol builder</p>
      </div>
      <ul className="mt-3 space-y-1.5">
        {rows.map(([name, done]) => (
          <li key={name} className="flex items-center justify-between rounded-md border border-line px-3 py-1.5 text-sm">
            <span>{name}</span>
            <span className={done ? "text-teal-ink" : "text-navy/45"}>{done ? "Complete" : "To do"}</span>
          </li>
        ))}
      </ul>
    </BrowserFrame>
  );
}

export function CalculatorPreview() {
  return (
    <BrowserFrame url="toprot.vercel.app/calculator" label="Sample size calculator, shown with sample inputs.">
      <div className="flex items-center gap-2 text-navy">
        <Calculator className="h-4 w-4 text-cobalt" aria-hidden="true" />
        <p className="text-sm font-semibold">Single proportion</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-navy/65">
        {["Expected proportion 0.30", "Margin of error 0.05", "Confidence 0.95", "Dropout 0.10"].map((t) => (
          <div key={t} className="rounded-md border border-line px-2 py-1.5">
            {t}
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-soft p-3">
        <p className="text-xs text-navy/65">Required sample size</p>
        <p className="text-2xl font-semibold text-navy">360</p>
      </div>
    </BrowserFrame>
  );
}

export function ReferencesPreview() {
  return (
    <BrowserFrame url="toprot.vercel.app/studies/…/references" label="Reference manager, shown with sample data.">
      <div className="flex items-center gap-2 text-navy">
        <Library className="h-4 w-4 text-cobalt" aria-hidden="true" />
        <p className="text-sm font-semibold">References</p>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {[
          ["Sample reference one", "DOI"],
          ["Sample reference two", "PubMed ID"],
          ["Sample reference three", "Manual"],
        ].map(([t, k]) => (
          <li key={t} className="flex items-center justify-between rounded-md border border-line px-3 py-1.5">
            <span>{t}</span>
            <span className="rounded-full bg-soft px-2 py-0.5 text-xs text-cobalt-dark">{k}</span>
          </li>
        ))}
      </ul>
    </BrowserFrame>
  );
}

export function LiteraturePreview() {
  return (
    <BrowserFrame url="toprot.vercel.app/literature" label="Literature Explorer, shown with a sample layout.">
      <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-navy/55">
        <Search className="h-4 w-4" aria-hidden="true" />
        Search PubMed, OpenAlex and Crossref
      </div>
      <div className="mt-3 space-y-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-md border border-line p-3">
            <div className="h-2.5 w-3/4 rounded bg-navy/10" />
            <div className="mt-2 h-2 w-1/2 rounded bg-navy/5" />
          </div>
        ))}
      </div>
    </BrowserFrame>
  );
}

export function EditorPreview() {
  return (
    <BrowserFrame url="toprot.vercel.app/studies/…/writing" label="Academic writing editor, shown with a sample layout.">
      <div className="flex items-center gap-2 text-navy/70">
        <FilePen className="h-4 w-4" aria-hidden="true" />
        <BookOpen className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-3 w-2/3 rounded bg-navy/15" />
        <div className="h-2 w-full rounded bg-navy/5" />
        <div className="h-2 w-11/12 rounded bg-navy/5" />
        <div className="h-2 w-4/5 rounded bg-navy/5" />
      </div>
    </BrowserFrame>
  );
}

export function ReviewPreview() {
  return (
    <BrowserFrame url="toprot.vercel.app/studies/…/protocol" label="Methodology checks, shown with sample data.">
      <div className="flex items-center gap-2 text-navy">
        <ShieldCheck className="h-4 w-4 text-teal-ink" aria-hidden="true" />
        <p className="text-sm font-semibold">Methodology checks</p>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        <li className="rounded-md bg-teal/10 px-3 py-1.5 text-teal-ink">Primary outcome is defined</li>
        <li className="rounded-md bg-gold/15 px-3 py-1.5 text-[#8a5d1c]">No exposure variable is marked</li>
      </ul>
    </BrowserFrame>
  );
}

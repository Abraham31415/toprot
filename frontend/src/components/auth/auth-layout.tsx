import type { ReactNode } from "react";
import { BookOpen, BrainCircuit, Calculator, FilePenLine, FlaskConical, Library } from "lucide-react";
import { PageShell } from "@/components/marketing/ui";

// One layout for every account page: a panel on the left about what ToProt does, and the form on the right. On a phone the
// panel is hidden and the form comes first, so the person signing in sees it straight away.

const POINTS = [
  { icon: FlaskConical, title: "Protocol builder", note: "Guided sections and methodology checks." },
  { icon: BookOpen, title: "Literature search", note: "OpenAlex, PubMed and Crossref in one place." },
  { icon: Library, title: "References and PDFs", note: "Import, organise and annotate your sources." },
  { icon: Calculator, title: "Sample size and statistics", note: "Free calculators with formulas and references." },
  { icon: FilePenLine, title: "Writing editor", note: "Cite from your library and export to Word or PDF." },
  { icon: BrainCircuit, title: "AI research assistant", note: "Help grounded in your own project." },
];

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <PageShell>
      <div className="grid lg:min-h-[calc(100vh-4rem-14rem)] lg:grid-cols-2">
        <aside aria-label="About ToProt" className="hidden bg-navy px-10 py-14 text-white lg:flex lg:flex-col lg:justify-center xl:px-16">
          <div className="max-w-md">
            <p className="type-eyebrow !text-white/70">ToProt</p>
            <h2 className="type-section mt-3 !text-white">Enter your study once. Everything else follows.</h2>
            <p className="mt-3 text-base text-white/80">One workspace for the research you are planning, running and writing up.</p>
            <ul className="mt-8 space-y-5">
              {POINTS.map((p) => (
                <li key={p.title} className="flex items-start gap-3">
                  <span aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-control bg-white/10"><p.icon className="h-[18px] w-[18px]" strokeWidth={1.9} /></span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{p.title}</span>
                    <span className="block text-sm text-white/75">{p.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <div className="flex items-start justify-center px-4 py-12 sm:px-6 sm:py-16 lg:items-center">
          <div className="w-full max-w-sm">
            <h1 className="type-page !text-[1.75rem]">{title}</h1>
            {subtitle && <p className="type-support mb-8 mt-1.5">{subtitle}</p>}
            {children}
            {footer && <div className="type-support mt-6">{footer}</div>}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

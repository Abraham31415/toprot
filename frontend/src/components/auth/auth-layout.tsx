import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, BookOpen, Calculator, FlaskConical } from "lucide-react";

// One layout for every account page, with its own minimal chrome: the logo, a way back to the homepage and a link to the other account page.
// Desktop is two columns (a short panel about ToProt on the left, the form on the right). On a phone the panel is dropped and the form
// starts straight under the header.

const BENEFITS = [
  { icon: FlaskConical, title: "Research protocols", note: "Plan your methodology with structured guidance." },
  { icon: BookOpen, title: "Literature and references", note: "Discover, organise and cite research evidence." },
  { icon: Calculator, title: "Research tools", note: "Calculators and statistical utilities, free to use." },
];

export type SwitchLink = { prompt: string; label: string; href: string };

export function AuthLayout({ title, subtitle, children, switchLink }: { title: string; subtitle?: ReactNode; children: ReactNode; switchLink?: SwitchLink }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink [color-scheme:light]">
      <a href="#auth-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:shadow-raised">
        Skip to the form
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="rounded-control text-lg font-semibold tracking-tight text-ink">ToProt</Link>
            <Link href="/" className="type-nav hidden items-center gap-1 rounded-control text-ink-soft hover:text-primary sm:inline-flex">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to homepage
            </Link>
          </div>
          {switchLink && (
            <p className="type-nav text-ink-soft">
              <span className="hidden sm:inline">{switchLink.prompt} </span>
              <Link href={switchLink.href} className="rounded-control font-semibold text-primary hover:text-primary-hover hover:underline">{switchLink.label}</Link>
            </p>
          )}
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <aside aria-label="About ToProt" className="hidden bg-navy px-10 py-12 text-white lg:flex lg:flex-col lg:justify-center xl:px-16">
          <div className="max-w-md">
            <h2 className="type-section !text-white">Your research starts here.</h2>
            <p className="mt-3 text-base text-white/80">Design studies, discover evidence, manage references, and organize research in one workspace.</p>
            <ul className="mt-8 space-y-5">
              {BENEFITS.map((b) => (
                <li key={b.title} className="flex items-start gap-3">
                  <span aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-control bg-white/10"><b.icon className="h-[18px] w-[18px]" strokeWidth={1.9} /></span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{b.title}</span>
                    <span className="block text-sm text-white/75">{b.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <main id="auth-main" className="flex items-start justify-center px-4 py-8 sm:px-6 sm:py-12 lg:items-center">
          <div className="w-full max-w-sm">
            <h1 className="type-page !text-[1.625rem]">{title}</h1>
            {subtitle && <p className="type-support mt-1.5 !text-ink-soft">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
        </main>
      </div>

      <footer className="border-t border-line bg-surface px-4 py-3 text-center type-caption">
        <Link href="/terms" className="hover:text-primary hover:underline">Terms</Link>
        <span aria-hidden="true"> · </span>
        <Link href="/privacy" className="hover:text-primary hover:underline">Privacy</Link>
        <span aria-hidden="true"> · </span>
        <Link href="/contact" className="hover:text-primary hover:underline">Contact</Link>
      </footer>
    </div>
  );
}

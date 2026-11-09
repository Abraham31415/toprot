import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** Page chrome for every public page: skip link, header, main landmark, footer. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-navy [color-scheme:light]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function PageHeading({ title, lead, eyebrow }: { title: string; lead?: string; eyebrow?: string }) {
  return (
    <Container className="pb-8 pt-12 sm:pt-16">
      {eyebrow && <p className="text-sm font-semibold uppercase tracking-wide text-teal">{eyebrow}</p>}
      <h1 className="mt-1 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      {lead && <p className="mt-4 max-w-2xl text-lg text-navy/75">{lead}</p>}
    </Container>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  const base =
    "inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal";
  const style =
    variant === "primary"
      ? "bg-navy text-white hover:bg-teal"
      : "border border-navy/25 bg-white text-navy hover:border-teal hover:text-teal";
  return (
    <Link href={href} className={`${base} ${style}`}>
      {children}
    </Link>
  );
}

export function StatusBadge({ status }: { status: "available" | "planned" }) {
  return status === "available" ? (
    <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-medium text-teal">Available</span>
  ) : (
    <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-xs font-medium text-[#8a5d1c]">Planned</span>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return (
    <Container className="pb-16">
      <div className="max-w-3xl space-y-4 text-base leading-7 text-navy/85 [&_a]:text-teal [&_a]:underline [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-navy [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </Container>
  );
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

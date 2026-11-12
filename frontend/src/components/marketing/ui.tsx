import type { ReactNode } from "react";
import { ButtonLink as DsButtonLink } from "@/components/ds/button";
import { Container as DsContainer, PageHeader } from "@/components/ds/layout";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

// The public pages' building blocks. These are thin wrappers over the shared design system (src/components/ds), kept so the
// existing pages keep working: there is one implementation of each part, in the design system, and none here.

/** Page chrome for every public page: skip link, header, main landmark, footer. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink [color-scheme:light]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:shadow-raised">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <DsContainer className={className}>{children}</DsContainer>;
}

/** The heading block at the top of a page. */
export function PageHeading({ title, lead, eyebrow }: { title: string; lead?: string; eyebrow?: string }) {
  return <PageHeader title={title} lead={lead} eyebrow={eyebrow} />;
}

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return <DsButtonLink href={href} variant={variant}>{children}</DsButtonLink>;
}

/** Marks something that is not built yet. Finished features carry no badge. */
export function StatusBadge({ status }: { status: "available" | "planned" }) {
  return status === "available" ? (
    <span className="rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-medium text-success-ink">Available</span>
  ) : (
    <span className="rounded-full bg-warning-bg px-2.5 py-0.5 text-xs font-medium text-warning-ink">Planned</span>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return (
    <Container className="pb-16">
      <div className="type-body max-w-3xl space-y-4 !text-base !leading-7 [&_a]:text-primary [&_a]:underline [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </Container>
  );
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

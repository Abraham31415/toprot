import type { ElementType, ReactNode } from "react";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";

// Foundation: page container, section, stack, grid, headers. One set of widths, paddings and gaps for every page.

const WIDTH = { narrow: "max-w-3xl", default: "max-w-5xl", wide: "max-w-6xl" } as const;

/** Centres content at a standard maximum width, with a consistent gutter. "wide" matches the site header. */
export function Container({ children, className = "", width = "wide" }: { children: ReactNode; className?: string; width?: keyof typeof WIDTH }) {
  return <div className={`mx-auto w-full px-4 sm:px-6 ${WIDTH[width]} ${className}`}>{children}</div>;
}

const TONE = {
  default: "bg-canvas",
  white: "bg-surface border-y border-line",
  soft: "bg-surface-soft/60",
  navy: "bg-navy text-white",
} as const;
const SPACE = { sm: "section-y-sm", md: "section-y", none: "" } as const;

/** A horizontal band of a page: background tone, vertical rhythm and an anchor target that clears the sticky header. */
export function Section({ children, tone = "default", spacing = "md", id, labelledBy, className = "" }: {
  children: ReactNode; tone?: keyof typeof TONE; spacing?: keyof typeof SPACE; id?: string; labelledBy?: string; className?: string;
}) {
  return <section id={id} aria-labelledby={labelledBy} className={`${TONE[tone]} ${SPACE[spacing]} ${className}`}>{children}</section>;
}

const GAP = { xs: "gap-1.5", sm: "gap-3", md: "gap-5", lg: "gap-8", xl: "gap-12" } as const;

/** Vertical rhythm between children. */
export function Stack({ children, gap = "md", as: Tag = "div", className = "" }: { children: ReactNode; gap?: keyof typeof GAP; as?: ElementType; className?: string }) {
  return <Tag className={`flex flex-col ${GAP[gap]} ${className}`}>{children}</Tag>;
}

// Static class names so Tailwind can see them. The first number is the phone layout, then tablet, then desktop.
const COLS = {
  "1": "grid-cols-1",
  "2": "grid-cols-1 sm:grid-cols-2",
  "3": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  "4": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  "2-split": "grid-cols-1 lg:grid-cols-2",
  "3-split": "grid-cols-1 md:grid-cols-3",
} as const;

/** Responsive grid with preset column behaviour. */
export function Grid({ children, cols = "3", gap = "md", as: Tag = "div", className = "" }: { children: ReactNode; cols?: keyof typeof COLS; gap?: keyof typeof GAP; as?: ElementType; className?: string }) {
  return <Tag className={`grid ${COLS[cols]} ${GAP[gap]} ${className}`}>{children}</Tag>;
}

export function Divider({ className = "" }: { className?: string }) {
  return <hr className={`border-0 border-t border-line ${className}`} />;
}

/** The heading block at the top of a page: optional breadcrumbs, eyebrow, title, a short lead and actions. */
export function PageHeader({ title, lead, eyebrow, actions, breadcrumbs, align = "left", id = "page-title" }: {
  title: ReactNode; lead?: ReactNode; eyebrow?: string; actions?: ReactNode; breadcrumbs?: Crumb[]; align?: "left" | "center"; id?: string;
}) {
  const centre = align === "center";
  return (
    <Container className="pb-8 pt-10 sm:pt-14">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} className="mb-4" />}
      <div className={centre ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
        {eyebrow && <p className="type-eyebrow mb-2">{eyebrow}</p>}
        <h1 id={id} className="type-page">{title}</h1>
        {lead && <p className="type-lead mt-3">{lead}</p>}
        {actions && <div className={`mt-6 flex flex-wrap gap-3 ${centre ? "justify-center" : ""}`}>{actions}</div>}
      </div>
    </Container>
  );
}

/** The heading block above a section of a page. */
export function SectionHeader({ title, lead, eyebrow, action, align = "left", id, as: Tag = "h2", onDark = false }: {
  title: ReactNode; lead?: ReactNode; eyebrow?: string; action?: ReactNode; align?: "left" | "center"; id?: string; as?: ElementType; onDark?: boolean;
}) {
  const centre = align === "center";
  return (
    <div className={`mb-8 flex flex-wrap items-end justify-between gap-4 ${centre ? "justify-center text-center" : ""}`}>
      <div className={centre ? "mx-auto max-w-2xl" : "max-w-2xl"}>
        {eyebrow && <p className="type-eyebrow mb-2">{eyebrow}</p>}
        <Tag id={id} className={`type-section ${onDark ? "!text-white" : ""}`}>{title}</Tag>
        {lead && <p className={`type-body mt-2 ${onDark ? "!text-white/80" : ""}`}>{lead}</p>}
      </div>
      {action}
    </div>
  );
}

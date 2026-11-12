import Link from "next/link";
import { ArrowRight, ArrowUpRight, Lock, type LucideIcon } from "lucide-react";
import type { ElementType, ReactNode } from "react";
import { ICONS, IconWrapper, TONES, type Tone } from "./icons";
import { Container, Section } from "./layout";
import { ButtonLink } from "./button";

// Surfaces and the cards built on them. A card is a white surface with a hairline border; "interactive" cards lift on hover and
// carry ONE link that stretches over the whole card, so the title is the accessible name and there is one tab stop.

const PAD = { sm: "p-3.5", md: "p-5", lg: "p-6" } as const;
const FOCUS = "has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus";

export function Card({ children, as: Tag = "div", padding = "md", tone = "default", interactive = false, className = "" }: {
  children: ReactNode; as?: ElementType; padding?: keyof typeof PAD; tone?: "default" | "soft" | "highlight"; interactive?: boolean; className?: string;
}) {
  const t = tone === "soft" ? "bg-surface-soft/60 border-line" : tone === "highlight" ? "bg-surface border-2 border-primary shadow-raised" : "bg-surface border-line shadow-card";
  const i = interactive ? `relative transition hover:shadow-raised ${FOCUS}` : "";
  return <Tag className={`rounded-card border ${t} ${PAD[padding]} ${i} ${className}`}>{children}</Tag>;
}

/** The link that covers a whole interactive card. Its text is the card's accessible name. */
function CardLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return <Link href={href} className={`after:absolute after:inset-0 after:content-[''] focus-visible:outline-none ${className}`}>{children}</Link>;
}

/** A capability, in one sentence: icon, short heading, one supporting line and a link. */
export function FeatureCard({ icon, tone = "cobalt", title, description, href, cta = "Learn more" }: { icon: LucideIcon; tone?: Tone; title: string; description: string; href: string; cta?: string }) {
  return (
    <Card interactive className={`flex h-full flex-col gap-3 ${TONES[tone].hover}`}>
      <IconWrapper icon={icon} tone={tone} />
      <h3 className="type-card"><CardLink href={href}>{title}</CardLink></h3>
      <p className="type-body">{description}</p>
      <span className="type-label mt-auto inline-flex items-center gap-1 pt-1 text-primary" aria-hidden="true">{cta}<ArrowRight className="h-4 w-4" /></span>
    </Card>
  );
}

/** A compact tool in a directory: icon, short title, one line, an arrow. Tools that live inside a study show a lock. */
export function ToolCard({ icon, tone, label, fullName, description, href, account = false, category }: {
  icon: LucideIcon; tone: Tone; label: string; fullName?: string; description: string; href: string | null; account?: boolean; category?: string;
}) {
  const Icon = icon;
  const body = (
    <>
      <span aria-hidden="true" className={`flex h-9 w-9 flex-none items-center justify-center rounded-control ${TONES[tone].tile}`}><Icon className={`h-[18px] w-[18px] ${TONES[tone].ink}`} strokeWidth={1.9} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-5 text-ink">
          {href ? <CardLink href={href}>{label}</CardLink> : label}
          {fullName && fullName !== label && <span className="sr-only"> ({fullName})</span>}
        </span>
        <span className="type-support mt-0.5 block !text-[13px] !leading-[18px]">{description}</span>
        {category && <span className={`mt-1.5 block text-[11px] font-medium ${TONES[tone].ink}`}>{category}</span>}
      </span>
      <span className="flex flex-none items-center gap-1.5 pt-0.5">
        {account && (<><Lock className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" /><span className="sr-only">Needs a free account</span></>)}
        <ArrowUpRight className="h-4 w-4 text-line-strong transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
      </span>
    </>
  );
  return href ? (
    <Card as="div" padding="sm" interactive className={`group flex h-full items-start gap-3 ${TONES[tone].hover}`}>{body}</Card>
  ) : (
    <div className="flex h-full items-start gap-3 rounded-card border border-dashed border-line-strong bg-canvas p-3.5">{body}</div>
  );
}

/** A tool worth showing first: a little more room than a ToolCard. */
export function FeaturedToolCard({ icon: Icon, tone, label, description, href }: { icon: LucideIcon; tone: Tone; label: string; description: string; href: string }) {
  return (
    <Card interactive className={`group flex h-full items-center gap-3 sm:flex-col sm:items-stretch sm:gap-0 ${TONES[tone].hover}`}>
      <span className="flex items-start justify-between sm:w-full">
        <IconWrapper icon={Icon} tone={tone} />
        <ArrowUpRight className="hidden h-4 w-4 text-line-strong transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary sm:block" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 sm:mt-3 sm:flex-none">
        <span className="block text-sm font-semibold text-ink"><CardLink href={href}>{label}</CardLink></span>
        <span className="type-support mt-0.5 block !text-[13px] !leading-[18px]">{description}</span>
      </span>
      <ArrowUpRight className="h-4 w-4 flex-none text-line-strong sm:hidden" aria-hidden="true" />
    </Card>
  );
}

/** A tool or area inside the signed-in workspace, as a compact row. */
export function ResearchModuleCard({ icon, tone = "cobalt", title, description, href }: { icon: LucideIcon; tone?: Tone; title: string; description?: string; href: string }) {
  return (
    <Card padding="sm" interactive className={`flex items-center gap-3 ${TONES[tone].hover}`}>
      <IconWrapper icon={icon} tone={tone} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink"><CardLink href={href}>{title}</CardLink></span>
        {description && <span className="type-caption block">{description}</span>}
      </span>
      <ArrowRight className="h-4 w-4 flex-none text-ink-muted" aria-hidden="true" />
    </Card>
  );
}

/** A single number with its label. */
export function MetricCard({ label, value, hint, icon: Icon, tone = "cobalt" }: { label: string; value: ReactNode; hint?: string; icon?: LucideIcon; tone?: Tone }) {
  return (
    <Card padding="sm" className="!p-4">
      <p className="type-caption flex items-center gap-2">
        {Icon && <Icon className={`h-4 w-4 ${TONES[tone].ink}`} aria-hidden="true" />}
        {label}
      </p>
      <p className="type-stat mt-1.5">{value}</p>
      {hint && <p className="type-caption mt-1">{hint}</p>}
    </Card>
  );
}

/** A progress bar with an accessible name and value. */
export function ProgressIndicator({ value, label, size = "md" }: { value: number; label: string; size?: "sm" | "md" }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} className={`overflow-hidden rounded-full bg-navy/10 ${size === "sm" ? "h-1" : "h-1.5"}`}>
      <div className="h-full rounded-full bg-teal" style={{ width: `${v}%` }} />
    </div>
  );
}

/** A research project: title, status, progress, where it stands and links to its parts. */
export function ProjectCard({ title, href, status, progress, stage, links }: {
  title: string; href: string; status?: { label: string; tone: "draft" | "locked" };
  progress?: { value: number; label: string; detail: string }; stage: string; links: { label: string; href: string }[];
}) {
  return (
    <Card as="article" padding="sm" className="flex flex-col !p-4">
      <div className="flex items-start justify-between gap-3">
        <Link href={href} className="font-medium text-ink hover:text-primary">{title}</Link>
        {status && <StatusIndicator status={status.tone === "locked" ? "success" : "info"} compact>{status.label}</StatusIndicator>}
      </div>
      {progress && (
        <div className="mt-3">
          <div className="type-caption flex justify-between"><span>{progress.label}</span><span>{progress.detail}</span></div>
          <div className="mt-1"><ProgressIndicator value={progress.value} label={`${progress.label} completion for ${title}`} /></div>
        </div>
      )}
      <p className="type-support mt-3">{stage}</p>
      <div className="mt-4 flex flex-wrap gap-1 border-t border-line pt-3 text-sm">
        {links.map((l) => <Link key={l.href} href={l.href} className="rounded-control px-2 py-1 font-medium text-ink-soft hover:bg-surface-soft hover:text-primary-hover">{l.label}</Link>)}
      </div>
    </Card>
  );
}

/** The AI credit balance: the total, where it comes from, and the plan. */
export function CreditBalanceCard({ available, planLine, purchasedLine, planName, href, linkLabel = "Billing and usage" }: { available: string; planLine: string; purchasedLine?: string; planName: string; href: string; linkLabel?: string }) {
  return (
    <div>
      <p className="type-caption mb-2">Plan: <span className="font-medium text-ink">{planName}</span></p>
      <p className="type-stat">{available}<span className="ml-2 text-sm font-normal text-ink-muted">credits available</span></p>
      <p className="type-caption mt-1">{planLine}{purchasedLine ? `, ${purchasedLine}` : ""}</p>
      <Link href={href} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">{linkLabel}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
    </div>
  );
}

/** A panel with an icon heading, for grouped content in the workspace. */
export function Panel({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <Card as="section">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon className="h-4 w-4 text-primary" aria-hidden="true" />{title}</h2>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

/** Nothing here yet: say so, and say what to do next. */
export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-surface px-6 py-8 text-center">
      <Icon className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
      <p className="mt-2 font-medium text-ink">{title}</p>
      {description && <p className="type-support mt-1">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

const STATUS = {
  success: { cls: "bg-success-bg text-success-ink border-success-line", icon: ICONS.success },
  warning: { cls: "bg-warning-bg text-warning-ink border-warning-line", icon: ICONS.warning },
  error: { cls: "bg-danger-bg text-danger-ink border-danger-line", icon: ICONS.error },
  info: { cls: "bg-info-bg text-info-ink border-info-line", icon: ICONS.info },
  neutral: { cls: "bg-canvas text-ink-soft border-line", icon: ICONS.info },
} as const;
/** A state shown with an icon AND words, never colour alone. Use it only when the state carries meaning (planned, locked, failed). */
export function StatusIndicator({ status = "neutral", children, compact = false }: { status?: keyof typeof STATUS; children: ReactNode; compact?: boolean }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex flex-none items-center gap-1 rounded-full border font-medium ${s.cls} ${compact ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}

/** A closing call to action. */
export function CTASection({ title, description, primary, secondary, tone = "navy" }: { title: string; description?: string; primary: { label: string; href: string }; secondary?: { label: string; href: string }; tone?: "navy" | "soft" }) {
  const dark = tone === "navy";
  return (
    <Section tone={dark ? "navy" : "soft"}>
      <Container className="text-center">
        <h2 className={`type-section ${dark ? "!text-white" : ""}`}>{title}</h2>
        {description && <p className={`mx-auto mt-3 max-w-xl text-base ${dark ? "text-white/80" : "text-ink-soft"}`}>{description}</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href={primary.href} size="lg">{primary.label}</ButtonLink>
          {secondary && (dark
            ? <ButtonLink href={secondary.href} variant="secondary" size="lg" className="!border-white/30 !bg-transparent !text-white hover:!border-white hover:!text-white">{secondary.label}</ButtonLink>
            : <ButtonLink href={secondary.href} variant="secondary" size="lg">{secondary.label}</ButtonLink>)}
        </div>
      </Container>
    </Section>
  );
}

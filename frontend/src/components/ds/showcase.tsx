import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconWrapper, TONES, type Tone } from "./icons";
import { StatusIndicator } from "./card";

// Product presentation: a browser frame for real screenshots, a text-plus-image showcase that alternates sides, and the research workflow.

/**
 * A screenshot in a browser frame. `kind="screenshot"` is a genuine capture of the running product; `kind="illustration"` is a drawn
 * sample and says so in its caption. Images load lazily unless `priority` is set (use it only for the first image on a page).
 */
export function ProductScreenshot({ src, alt, width, height, caption, address, kind = "screenshot", priority = false, sizes = "(min-width: 1024px) 560px, 100vw", className = "" }: {
  src: string; alt: string; width: number; height: number; caption?: string; address?: string; kind?: "screenshot" | "illustration"; priority?: boolean; sizes?: string; className?: string;
}) {
  return (
    <figure className={`overflow-hidden rounded-frame border border-line bg-surface shadow-raised ${className}`}>
      <div className="flex items-center gap-2 border-b border-line bg-canvas px-3 py-2">
        <span className="flex gap-1" aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full bg-line-strong" /><span className="h-2.5 w-2.5 rounded-full bg-line-strong" /><span className="h-2.5 w-2.5 rounded-full bg-line-strong" /></span>
        {address && <span className="type-caption mx-auto truncate rounded-control bg-surface px-3 py-0.5">{address}</span>}
      </div>
      <Image src={src} alt={alt} width={width} height={height} sizes={sizes} priority={priority} loading={priority ? undefined : "lazy"} className="block h-auto w-full" />
      {(caption || kind === "illustration") && (
        <figcaption className={`type-caption border-t border-line px-4 py-2 ${kind === "illustration" ? "bg-warning-bg !text-warning-ink" : "bg-canvas"}`}>
          {kind === "illustration" ? `Illustration with sample data, not a screenshot.${caption ? ` ${caption}` : ""}` : caption}
        </figcaption>
      )}
    </figure>
  );
}

/** One important feature: a short explanation on one side and the product on the other. Alternate `reverse` down a page. */
export function FeatureShowcase({ icon, tone = "cobalt", eyebrow, title, description, benefits, cta, media, reverse = false, id }: {
  icon: LucideIcon; tone?: Tone; eyebrow: string; title: string; description: string; benefits?: string[]; cta?: { label: string; href: string }; media: ReactNode; reverse?: boolean; id?: string;
}) {
  return (
    <div id={id} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <div className={reverse ? "lg:order-2" : ""}>
        <p className={`type-eyebrow mb-3 flex items-center gap-2 !text-[0.75rem] ${TONES[tone].ink}`}>
          <IconWrapper icon={icon} tone={tone} size="sm" />
          {eyebrow}
        </p>
        <h3 className="type-section">{title}</h3>
        <p className="type-body mt-3 max-w-xl !text-base">{description}</p>
        {benefits && benefits.length > 0 && (
          <ul className="mt-5 space-y-2.5">
            {benefits.slice(0, 3).map((b) => (
              <li key={b} className="type-body flex items-start gap-2.5"><Check className="mt-1 h-4 w-4 flex-none text-teal-ink" aria-hidden="true" /><span>{b}</span></li>
            ))}
          </ul>
        )}
        {cta && <Link href={cta.href} className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">{cta.label}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
      </div>
      <div className={`min-w-0 ${reverse ? "lg:order-1" : ""}`}>{media}</div>
    </div>
  );
}

export type WorkflowStep = { icon: LucideIcon; label: string; note: string; planned?: boolean };

/** The research lifecycle as a row of steps. Steps that exist carry no badge; only a step that is not built yet is marked. */
export function WorkflowSteps({ steps }: { steps: WorkflowStep[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {steps.map((s, i) => (
        <li key={s.label} className={`relative rounded-card border bg-surface p-4 ${s.planned ? "border-dashed border-line-strong" : "border-line shadow-card"}`}>
          <div className="flex items-center justify-between">
            <IconWrapper icon={s.icon} tone={s.planned ? "navy" : "cobalt"} size="sm" />
            <span className="type-caption tabular-nums" aria-hidden="true">{i + 1}</span>
          </div>
          <p className="type-card mt-3">{s.label}</p>
          <p className="type-caption mt-0.5">{s.note}</p>
          {s.planned && <div className="mt-2"><StatusIndicator status="warning" compact>Planned</StatusIndicator></div>}
        </li>
      ))}
    </ol>
  );
}

import { useId, type CSSProperties } from "react";
import { LOGO_STROKES, LOGO_VIEWBOX, strokesFor } from "./logo-geometry";

export type LogoVariant = "light" | "dark";
export type LogoMotion = "none" | "draw" | "loop";

export interface LogoMarkProps {
  /** Rendered width and height in px. Default 48. */
  size?: number;
  /** "light" is for light backgrounds (navy frame, teal pages), "dark" for dark backgrounds (pale frame, bright teal). */
  variant?: LogoVariant;
  /** Accessible name. Ignored when decorative. */
  title?: string;
  /** True when the logo sits next to the product name or a label, so screen readers skip it. */
  decorative?: boolean;
  className?: string;
  /** "none" is the finished static logo. "draw" inks it once, "loop" draws, holds, fades and repeats. */
  motion?: LogoMotion;
  /** Seconds for one draw (or one full loop cycle). */
  duration?: number;
  /** Seconds to wait before the animation starts. */
  delay?: number;
  /** Change this value to restart the animation. */
  replayKey?: number | string;
}

/**
 * The ToProt mark: an open magnifying glass with two stacked research layers inside.
 * Pure markup, so it works in server components. See AnimatedLogo for the reduced-motion-aware animated version.
 */
export function LogoMark({
  size = 48, variant = "light", title = "ToProt", decorative = false, className,
  motion = "none", duration, delay, replayKey,
}: LogoMarkProps) {
  const titleId = `toprot-logo-t-${useId().replace(/:/g, "")}`;
  const animated = motion !== "none";
  const strokes = strokesFor(size);
  const classes = [
    "toprot-logo",
    variant === "dark" ? "toprot-logo--dark" : "",
    animated ? `toprot-logo--${motion}` : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  const style = animated
    ? ({
        ...(duration ? { "--logo-duration": `${duration}s` } : null),
        ...(delay ? { "--logo-delay": `${delay}s` } : null),
      } as CSSProperties)
    : undefined;
  const a11y = decorative
    ? ({ "aria-hidden": true, focusable: "false" } as const)
    : ({ role: "img", "aria-labelledby": titleId } as const);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={LOGO_VIEWBOX}
      width={size}
      height={size}
      fill="none"
      className={classes}
      style={style}
      data-motion={motion}
      {...a11y}
    >
      {decorative ? null : <title id={titleId}>{title}</title>}
      <g key={animated ? String(replayKey ?? 0) : undefined} className="toprot-logo-art" strokeLinecap="round" strokeLinejoin="round">
        {LOGO_STROKES.map(({ part, d, layer }) => (
          <path
            key={part}
            className={`toprot-logo-${part}`}
            d={d}
            style={{ stroke: layer === "frame" ? "var(--toprot-logo-frame)" : "var(--toprot-logo-pages)" }}
            strokeWidth={strokes[layer]}
            {...(animated ? { pathLength: 1 } : null)}
          />
        ))}
      </g>
    </svg>
  );
}

"use client";

import { AnimatedLogo, type AnimatedLogoProps } from "./animated-logo";

export interface LogoLoaderProps extends Pick<AnimatedLogoProps, "size" | "variant" | "className" | "reducedMotion"> {
  /** Announced to screen readers while loading. */
  label?: string;
  /** Seconds per cycle (draw, hold, fade). Default 3.6. */
  duration?: number;
  /** False draws the logo once and then holds it. Default true. */
  loop?: boolean;
}

/**
 * A loading indicator: the logo draws, holds, fades out and starts again.
 * The first and last frames are both empty, so the repeat has no visible jump. With reduced motion it shows the still logo.
 */
export function LogoLoader({ size = 56, variant = "light", label = "Loading", duration = 3.6, loop = true, className, reducedMotion }: LogoLoaderProps) {
  return (
    <span role="status" aria-live="polite" className={["inline-flex items-center justify-center", className ?? ""].filter(Boolean).join(" ")}>
      <span className="sr-only">{label}</span>
      <AnimatedLogo size={size} variant={variant} once={!loop} duration={loop ? duration : duration * 0.55} decorative reducedMotion={reducedMotion} />
    </span>
  );
}

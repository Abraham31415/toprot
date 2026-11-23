"use client";

import { useSyncExternalStore } from "react";
import { LogoMark, type LogoMarkProps } from "./logo-mark";

const QUERY = "(prefers-reduced-motion: reduce)";
function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/** True when the reader has asked their system for less motion. The server render assumes motion is fine (the CSS also guards it). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}

export interface AnimatedLogoProps extends Omit<LogoMarkProps, "motion"> {
  /** True (default): ink the logo once and stay finished. False: draw, hold, fade and repeat without a jump. */
  once?: boolean;
  /** Force the finished static logo, as if the reader had asked for reduced motion. */
  reducedMotion?: boolean;
}

/**
 * The ToProt mark drawn like a pen: the lens ring, the handle, then the lower and upper research layers.
 * Duration defaults to 2 s (3.6 s per cycle when looping). Readers who prefer reduced motion get the finished logo.
 * The last frame is identical to the static LogoMark.
 */
export function AnimatedLogo({ once = true, reducedMotion, ...rest }: AnimatedLogoProps) {
  const systemReduced = usePrefersReducedMotion();
  const still = reducedMotion ?? systemReduced;
  return <LogoMark {...rest} motion={still ? "none" : once ? "draw" : "loop"} />;
}

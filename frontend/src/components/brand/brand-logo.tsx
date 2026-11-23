"use client";

import { useEffect, useState } from "react";
import { AnimatedLogo, type AnimatedLogoProps } from "./animated-logo";

// Set after the first logo mounts in this browser tab. Later mounts (in-app navigation remounts the page headers) start
// finished, so the mark draws once per page load rather than on every click. Effects never run on the server, so every
// server render draws, and the hydrating client agrees with it.
let drawnThisLoad = false;

export type BrandLogoProps = Omit<AnimatedLogoProps, "once" | "replayKey">;

/**
 * The header mark: draws once when the page first loads, then stays still. Decorative by default because headers
 * put the product name beside it.
 */
export function BrandLogo({ size = 28, decorative = true, ...rest }: BrandLogoProps) {
  const [draw] = useState(() => !drawnThisLoad);
  useEffect(() => { drawnThisLoad = true; }, []);
  return <AnimatedLogo size={size} decorative={decorative} reducedMotion={draw ? undefined : true} {...rest} />;
}

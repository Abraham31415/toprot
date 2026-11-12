"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Sends one small event per page view to ToProt's own /api/e. No cookie is set here and nothing is sent to another site. Pages that are
// private (the workspace, admin, account pages) are not sent, and a browser that asks not to be tracked is respected.

const SKIP = /^\/(?:admin|api|auth|login|register|forgot-password|reset-password|onboarding|suspended|logout)(?:\/|$)/;

export function send(body: Record<string, string | undefined>) {
  try {
    if (typeof navigator === "undefined") return;
    if (navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
    const data = JSON.stringify(body);
    if (!navigator.sendBeacon?.("/api/e", new Blob([data], { type: "application/json" }))) void fetch("/api/e", { method: "POST", body: data, keepalive: true, headers: { "Content-Type": "application/json" } });
  } catch { /* tracking must never affect the page */ }
}

/** Record that a calculator produced a result. Only the tool's short name is sent. */
export const trackCalculator = (tool: string) => send({ e: "calculator_completed", p: window.location.pathname, t: tool });

export function Tracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || SKIP.test(pathname) || /^\/studies\/|^\/dashboard|^\/billing|^\/assistant|^\/library|^\/writing|^\/supervisor/.test(pathname)) return;
    send({ e: "page_view", p: pathname, r: document.referrer || undefined, q: window.location.search || undefined });
  }, [pathname]);
  return null;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { isNavActive } from "@/lib/site";
import { buttonClass } from "./button";

// Navigation parts shared by the public header and the signed-in shell: a link that knows when it is the current page,
// a dropdown for secondary links, and the phone menu.

export type NavItem = { href: string; label: string; hint?: string };

const linkBase = "type-nav rounded-control px-3 py-1.5";
export const navLinkClass = (active: boolean) => `${linkBase} ${active ? "bg-surface-soft text-ink" : "text-ink-soft hover:bg-surface hover:text-primary"}`;

/** A link that is marked as the current page (visually and with aria-current) when the address belongs to it. */
export function ActiveNavLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  const active = isNavActive(href, usePathname());
  return <Link href={href} aria-current={active ? "page" : undefined} className={`${navLinkClass(active)} ${className}`}>{children}</Link>;
}

/**
 * A button that opens a short list of links. A simple disclosure rather than an ARIA menu: Enter or Space opens it, Tab moves through
 * the links, Escape closes it and returns focus to the button, and it also closes on an outside click or when the page changes.
 */
export function NavigationDropdown({ label, items, align = "right" }: { label: string; items: readonly NavItem[]; align?: "left" | "right" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = `menu-${label.toLowerCase().replace(/\W+/g, "-")}`;
  const active = items.some((l) => isNavActive(l.href, pathname));

  // Close when the page changes. Done while rendering (the documented way to reset state on a prop change), not in an effect.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) { setSeenPath(pathname); setOpen(false); }
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={wrap} className="relative" onBlur={(e) => { if (open && !wrap.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button ref={button} type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className={`${navLinkClass(active)} inline-flex items-center gap-1`}>
        {label}
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <ul id={id} className={`absolute top-full z-50 mt-2 w-64 rounded-card border border-line bg-surface p-1.5 shadow-raised ${align === "right" ? "right-0" : "left-0"}`}>
          {items.map((l) => {
            const cur = isNavActive(l.href, pathname);
            return (
              <li key={l.href}>
                <Link href={l.href} aria-current={cur ? "page" : undefined} className={`block rounded-control px-3 py-2 ${cur ? "bg-surface-soft" : "hover:bg-hover"}`}>
                  <span className="block text-sm font-medium text-ink">{l.label}</span>
                  {l.hint && <span className="type-caption block">{l.hint}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The phone menu: primary links, then secondary ones under a "More" heading, then the account actions. */
export function MobileNavigation({ primary, more, onNavigate }: { primary: readonly NavItem[]; more: readonly NavItem[]; onNavigate: () => void }) {
  const pathname = usePathname();
  const row = (l: NavItem, strong: boolean) => {
    const active = isNavActive(l.href, pathname);
    return (
      <li key={l.href}>
        <Link href={l.href} aria-current={active ? "page" : undefined} onClick={onNavigate} className={`block border-b border-line py-3 text-sm ${strong ? "font-medium" : ""} ${active ? "text-primary" : "text-ink"}`}>{l.label}</Link>
      </li>
    );
  };
  return (
    <nav id="mobile-nav" aria-label="Mobile" className="border-t border-line bg-canvas px-4 pb-5 lg:hidden">
      <ul className="flex flex-col pt-1">{primary.map((l) => row(l, true))}</ul>
      <p className="type-eyebrow mt-4 !text-ink-muted">More</p>
      <ul className="flex flex-col">{more.map((l) => row(l, false))}</ul>
      <div className="mt-5 flex gap-3">
        <Link href="/login" onClick={onNavigate} className={buttonClass("secondary", "md", "flex-1")}>Log in</Link>
        <Link href="/register" onClick={onNavigate} className={buttonClass("primary", "md", "flex-1")}>Get started</Link>
      </div>
    </nav>
  );
}

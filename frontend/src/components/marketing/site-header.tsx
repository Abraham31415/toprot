"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { ActiveNavLink, MobileNavigation, NavigationDropdown } from "@/components/ds/nav";
import { buttonClass } from "@/components/ds/button";
import { MORE_NAV, PRIMARY_NAV } from "@/lib/site";

/** The public header: logo, five primary links, a More menu, and Log in / Get started. Sticky, one height on every page. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="print:hidden sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="rounded-control text-lg font-semibold tracking-tight text-ink" onClick={() => setOpen(false)}>ToProt</Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {PRIMARY_NAV.map((l) => <ActiveNavLink key={l.href} href={l.href}>{l.label}</ActiveNavLink>)}
          <NavigationDropdown label="More" items={MORE_NAV} />
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/login" className="type-nav rounded-control px-3 py-1.5 text-ink-soft hover:text-primary">Log in</Link>
          <Link href="/register" className={buttonClass("primary", "sm")}>Get started</Link>
        </div>

        <button type="button" className={`${buttonClass("secondary", "sm")} lg:hidden`} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((v) => !v)}>
          {open ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open && <MobileNavigation primary={PRIMARY_NAV} more={MORE_NAV} onNavigate={() => setOpen(false)} />}
    </header>
  );
}

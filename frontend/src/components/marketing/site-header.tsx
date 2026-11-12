"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { MORE_NAV, PRIMARY_NAV, isNavActive } from "@/lib/site";

const linkBase = "rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt";
const linkCls = (active: boolean) => `${linkBase} ${active ? "bg-soft text-navy" : "text-navy/75 hover:bg-white hover:text-cobalt"}`;

/** The secondary pages. A simple disclosure: a button that opens a short list of links, closes on Escape, on an outside click and on navigation. */
function MoreMenu({ pathname }: { pathname: string | null }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const active = MORE_NAV.some((l) => isNavActive(l.href, pathname));

  useEffect(() => setOpen(false), [pathname]);
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
      <button
        ref={button} type="button" aria-expanded={open} aria-controls="more-menu" onClick={() => setOpen((v) => !v)}
        className={`${linkCls(active)} inline-flex items-center gap-1`}
      >
        More
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <ul id="more-menu" className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-line bg-white p-1.5 shadow-lg">
          {MORE_NAV.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href} aria-current={isNavActive(l.href, pathname) ? "page" : undefined}
                className={`block rounded-lg px-3 py-2 focus-visible:outline-2 focus-visible:outline-cobalt ${isNavActive(l.href, pathname) ? "bg-soft" : "hover:bg-paper"}`}
              >
                <span className="block text-sm font-medium text-navy">{l.label}</span>
                <span className="block text-xs text-navy/60">{l.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
    <header className="print:hidden sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight text-navy" onClick={() => setOpen(false)}>
          ToProt
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {PRIMARY_NAV.map((l) => {
            const active = isNavActive(l.href, pathname);
            return (
              <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={linkCls(active)}>
                {l.label}
              </Link>
            );
          })}
          <MoreMenu pathname={pathname} />
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/login" className="text-sm font-medium text-navy/80 hover:text-cobalt">
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt"
          >
            Get started
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-navy lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-line bg-paper px-4 pb-4 lg:hidden">
          <ul className="flex flex-col pt-1">
            {PRIMARY_NAV.map((l) => {
              const active = isNavActive(l.href, pathname);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}
                    className={`block border-b border-line py-3 text-sm font-medium ${active ? "text-cobalt" : "text-navy"}`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-navy/55">More</p>
          <ul className="flex flex-col">
            {MORE_NAV.map((l) => {
              const active = isNavActive(l.href, pathname);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}
                    className={`block border-b border-line py-2.5 text-sm ${active ? "font-medium text-cobalt" : "text-navy/80"}`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex gap-3">
            <Link href="/login" onClick={() => setOpen(false)} className="flex-1 rounded-md border border-line bg-white py-2.5 text-center text-sm font-medium text-navy">
              Log in
            </Link>
            <Link href="/register" onClick={() => setOpen(false)} className="flex-1 rounded-md bg-cobalt py-2.5 text-center text-sm font-medium text-white">
              Get started
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, CreditCard, LayoutDashboard, Library, LogOut, Menu, PenLine, Quote, Sparkles, Users, Wrench, X, type LucideIcon } from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon; /** Other paths that belong to this item, so it stays highlighted there. */ also?: string[] };
type NavGroup = { label: string; items: NavItem[] };

// Only routes that exist. Settings and a separate projects page are not listed because there is no page behind them; projects are on the dashboard.
function navFor(role: string | null): NavGroup[] {
  const home: NavItem =
    role === "supervisor"
      ? { href: "/supervisor", label: "Supervision", icon: Users }
      : { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, also: ["/studies"] };
  return [
    { label: "Workspace", items: [home, { href: "/writing", label: "Writing", icon: PenLine }, { href: "/library", label: "PDF library", icon: Library }] },
    {
      label: "Research",
      items: [
        { href: "/tools", label: "Research tools", icon: Wrench, also: ["/calculator"] },
        { href: "/literature", label: "Literature", icon: BookOpen },
        { href: "/citations", label: "Citations", icon: Quote },
        { href: "/assistant", label: "AI assistant", icon: Sparkles },
      ],
    },
    { label: "Account", items: [{ href: "/billing", label: "Billing and credits", icon: CreditCard }] },
  ];
}

const ROLE_NAME: Record<string, string> = { student: "Researcher", supervisor: "Supervisor" };

/** Signed-in chrome: grouped sidebar on desktop, top bar with a drawer on mobile. */
export function AppShell({ fullName, role, children }: { fullName: string; role: string | null; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const groups = navFor(role);
  const isActive = (item: NavItem) => [item.href, ...(item.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) { setSeenPath(pathname); setOpen(false); }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const nav = (
    <>
      <Link href="/" className="rounded-control px-3 text-lg font-semibold tracking-tight text-ink" onClick={() => setOpen(false)}>
        ToProt
      </Link>
      <nav aria-label="App" className="mt-5 flex flex-col gap-5">
        {groups.map((g) => (
          <div key={g.label}>
            <p aria-hidden="true" className="type-eyebrow px-3 pb-1.5">{g.label}</p>
            <ul aria-label={g.label} className="flex flex-col gap-0.5">
              {g.items.map((item) => {
                const active = isActive(item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`type-nav flex items-center gap-3 rounded-control px-3 py-2 transition-colors ${active ? "bg-surface-soft text-primary-hover" : "text-ink-soft hover:bg-hover hover:text-ink"}`}
                    >
                      <item.icon className="h-4 w-4 flex-none" aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="mt-auto border-t border-line pt-4">
        <p className="truncate px-3 text-sm font-medium text-ink" title={fullName}>{fullName}</p>
        <p className="type-caption px-3">{role ? ROLE_NAME[role] ?? role : ""}</p>
        <form action="/logout" method="post" className="mt-3">
          <button type="submit" className="type-nav flex w-full items-center gap-3 rounded-control px-3 py-2 text-ink-soft hover:bg-hover hover:text-ink">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Log out
          </button>
        </form>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink lg:flex">
      <a href="#app-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:shadow-raised">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface p-4 lg:flex">{nav}</aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <Link href="/" className="rounded-control text-lg font-semibold tracking-tight text-ink">ToProt</Link>
        <button
          ref={toggle} type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="app-drawer"
          onClick={() => setOpen((v) => !v)} className="rounded-control border border-line-strong bg-surface p-2 text-ink"
        >
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </header>

      {open && (
        <div id="app-drawer" className="fixed inset-x-0 bottom-0 top-[57px] z-20 flex flex-col overflow-y-auto bg-surface p-4 lg:hidden">{nav}</div>
      )}

      <div id="app-main" className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

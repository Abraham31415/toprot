"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BrainCircuit, Calculator, LayoutDashboard, BookOpen, Library, LogOut, Menu, PenLine, Quote, Sparkles, Users, Wrench, X, type LucideIcon } from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon };

function navFor(role: string | null): NavItem[] {
  const home: NavItem =
    role === "supervisor"
      ? { href: "/supervisor", label: "Supervision", icon: Users }
      : { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard };
  return [
    home,
    { href: "/tools", label: "Research tools", icon: Wrench },
    { href: "/literature", label: "Literature", icon: BookOpen },
    { href: "/citations", label: "Citations", icon: Quote },
    { href: "/writing", label: "Writing", icon: PenLine },
    { href: "/library", label: "PDF library", icon: Library },
    { href: "/calculator", label: "Sample size", icon: Calculator },
    { href: "/assistant", label: "AI assistant", icon: Sparkles },
    { href: "/billing", label: "Billing and credits", icon: BrainCircuit },
  ];
}

/** Signed-in chrome: sidebar on desktop, top bar with a drawer on mobile. */
export function AppShell({
  fullName,
  role,
  children,
}: {
  fullName: string;
  role: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = navFor(role);
  const isActive = (href: string) =>
    pathname === href || (href !== "/calculator" && href !== "/billing" && pathname.startsWith("/studies/") && href === items[0].href);

  const nav = (
    <>
      <Link href="/" className="rounded-control px-3 text-lg font-semibold tracking-tight text-ink" onClick={() => setOpen(false)}>
        ToProt
      </Link>
      <nav aria-label="App" className="mt-6 flex flex-col gap-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={`type-nav flex items-center gap-3 rounded-control px-3 py-2 transition-colors ${
              isActive(item.href) ? "bg-surface-soft text-primary-hover" : "text-ink-soft hover:bg-hover hover:text-ink"
            }`}
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto border-t border-line pt-4">
        <p className="truncate px-3 text-sm font-medium text-ink">{fullName}</p>
        <p className="type-caption px-3 capitalize">{role}</p>
        <form action="/logout" method="post" className="mt-3">
          <button
            type="submit"
            className="type-nav flex w-full items-center gap-3 rounded-control px-3 py-2 text-ink-soft hover:bg-hover hover:text-ink"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Log out
          </button>
        </form>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink lg:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
        {nav}
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <Link href="/" className="rounded-control text-lg font-semibold tracking-tight text-ink">
          ToProt
        </Link>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="app-drawer"
          onClick={() => setOpen((v) => !v)}
          className="rounded-control border border-line-strong bg-surface p-2 text-ink"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {open && (
        <div id="app-drawer" className="fixed inset-x-0 top-[57px] bottom-0 z-20 flex flex-col overflow-y-auto bg-surface p-4 lg:hidden">
          {nav}
        </div>
      )}

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

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
      <Link href="/" className="px-3 text-lg font-semibold tracking-tight text-navy" onClick={() => setOpen(false)}>
        ToProt
      </Link>
      <nav aria-label="App" className="mt-6 flex flex-col gap-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive(item.href) ? "bg-soft text-cobalt-dark" : "text-navy/75 hover:bg-navy/5 hover:text-navy"
            }`}
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto border-t border-line pt-4">
        <p className="truncate px-3 text-sm font-medium text-navy">{fullName}</p>
        <p className="px-3 text-xs capitalize text-navy/60">{role}</p>
        <form action="/logout" method="post" className="mt-3">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-navy/75 hover:bg-navy/5 hover:text-navy"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Log out
          </button>
        </form>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-paper text-navy lg:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-white p-4 lg:flex">
        {nav}
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-white px-4 py-3 lg:hidden">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          ToProt
        </Link>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="app-drawer"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-line p-2"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {open && (
        <div id="app-drawer" className="fixed inset-x-0 top-[57px] bottom-0 z-20 flex flex-col bg-white p-4 lg:hidden">
          {nav}
        </div>
      )}

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

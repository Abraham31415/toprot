"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity, BookOpen, Brain, ChartColumn, ChevronsLeft, ChevronsRight, CircleDollarSign, FlaskConical, HeartPulse, LayoutDashboard, LogOut, Menu, ScrollText,
  Settings, ShieldCheck, Users, UsersRound, WalletCards, X, Globe, type LucideIcon,
} from "lucide-react";

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean };
const GROUPS: { label: string; items: Item[] }[] = [
  { label: "Overview", items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true }] },
  { label: "People", items: [{ href: "/admin/users", label: "Users", icon: Users }, { href: "/admin/subscriptions", label: "Subscriptions", icon: WalletCards }, { href: "/admin/teams", label: "Teams", icon: UsersRound }] },
  { label: "Financial", items: [{ href: "/admin/revenue", label: "Revenue", icon: CircleDollarSign }, { href: "/admin/credits", label: "AI Credits", icon: Activity }, { href: "/admin/ai-usage", label: "AI Costs", icon: Brain }] },
  { label: "Analytics", items: [{ href: "/admin/analytics", label: "Traffic and funnel", icon: Globe }, { href: "/admin/research", label: "Research Activity", icon: FlaskConical }] },
  { label: "Management", items: [{ href: "/admin/system", label: "System Health", icon: HeartPulse }, { href: "/admin/audit", label: "Audit Logs", icon: ScrollText }, { href: "/admin/guides", label: "Guides", icon: BookOpen }, { href: "/admin/settings", label: "Settings", icon: Settings }] },
];

/** The admin frame: a collapsible sidebar on desktop, a drawer on phones, and a compact top bar. No data is loaded here. */
export function AdminShell({ email, role, openAlerts, mfaWarning, children }: { email: string; role: string; openAlerts: number; mfaWarning: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) { setSeenPath(pathname); setDrawer(false); }

  useEffect(() => { try { setCollapsed(localStorage.getItem("admin-nav-collapsed") === "1"); } catch { /* ignore */ } }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("admin-nav-collapsed", c ? "0" : "1"); } catch { /* ignore */ } return !c; });
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  const active = (i: Item) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`));
  const nav = (compact: boolean) => (
    <nav aria-label="Admin" className="flex flex-col gap-4">
      {GROUPS.map((g) => (
        <div key={g.label}>
          {!compact && <p aria-hidden="true" className="type-eyebrow px-3 pb-1">{g.label}</p>}
          <ul aria-label={g.label} className="flex flex-col gap-0.5">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href} aria-current={active(i) ? "page" : undefined} title={compact ? i.label : undefined}
                  className={`type-nav flex items-center gap-3 rounded-control px-3 py-2 ${compact ? "justify-center" : ""} ${active(i) ? "bg-surface-soft text-primary-hover" : "text-ink-soft hover:bg-hover hover:text-ink"}`}
                >
                  <i.icon className="h-4 w-4 flex-none" aria-hidden="true" />
                  <span className={compact ? "sr-only" : ""}>{i.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink lg:flex">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:shadow-raised">Skip to content</a>
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-line bg-surface p-3 lg:flex ${collapsed ? "w-16" : "w-60"}`}>
        <div className="flex items-center justify-between px-1 pb-4">
          {!collapsed && <Link href="/admin" className="rounded-control px-2 text-lg font-semibold tracking-tight text-ink">ToProt Admin</Link>}
          <button type="button" onClick={toggle} aria-pressed={collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="rounded-control p-2 text-ink-muted hover:bg-hover hover:text-ink">
            {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden="true" /> : <ChevronsLeft className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        {nav(collapsed)}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur-sm">
          <div className="flex items-center gap-2 lg:hidden">
            <button type="button" onClick={() => setDrawer((v) => !v)} aria-expanded={drawer} aria-controls="admin-drawer" aria-label={drawer ? "Close menu" : "Open menu"} className="rounded-control border border-line-strong p-2">
              {drawer ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
            </button>
            <span className="font-semibold">ToProt Admin</span>
          </div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3">
            {openAlerts > 0 && (
              <Link href="/admin/system" className="inline-flex items-center gap-1.5 rounded-full border border-warning-line bg-warning-bg px-2.5 py-1 text-xs font-medium text-warning-ink">
                <ChartColumn className="h-3.5 w-3.5" aria-hidden="true" />{openAlerts} open {openAlerts === 1 ? "alert" : "alerts"}
              </Link>
            )}
            <Link href="/admin/security" className={`inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-xs ${mfaWarning ? "text-warning-ink" : "text-ink-muted hover:text-ink"}`}>
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{mfaWarning ? "MFA is off" : "Security"}
            </Link>
            <span className="hidden text-xs text-ink-muted sm:inline" title={email}>{role}</span>
            <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-xs text-ink-muted hover:text-ink"><LogOut className="h-3.5 w-3.5" aria-hidden="true" />Back to app</Link>
          </div>
        </header>

        {drawer && <div id="admin-drawer" className="fixed inset-x-0 bottom-0 top-14 z-20 overflow-y-auto bg-surface p-4 lg:hidden">{nav(false)}</div>}
        <div id="admin-main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { slug: "", label: "Overview", paidOnly: true },
  { slug: "projects", label: "Projects", paidOnly: false },
  { slug: "members", label: "People", paidOnly: false },
  { slug: "documents", label: "Documents", paidOnly: false },
  { slug: "references", label: "References", paidOnly: true },
  { slug: "chat", label: "Chat", paidOnly: true },
  { slug: "activity", label: "Activity", paidOnly: true },
];

export function TeamTabs({ teamId, showAll }: { teamId: string; showAll: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Team" className="mb-6 mt-4 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.filter((t) => showAll || !t.paidOnly).map((t) => {
        const href = `/teams/${teamId}${t.slug ? `/${t.slug}` : ""}`;
        const active = path === href;
        return <Link key={t.slug} href={href} aria-current={active ? "page" : undefined} className={`whitespace-nowrap px-3 py-2 text-sm font-medium ${active ? "border-b-2 border-primary text-primary-hover" : "text-ink-soft hover:text-ink"}`}>{t.label}</Link>;
      })}
    </nav>
  );
}

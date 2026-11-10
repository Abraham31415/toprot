"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { CATEGORIES, type ToolCategory, type ToolMeta } from "@/lib/tools/types";

type Item = Omit<ToolMeta, "href"> & { href: string | null };

const KIND_LABEL: Record<ToolMeta["kind"], { text: string; cls: string }> = {
  calculator: { text: "Free, no account", cls: "bg-teal/10 text-teal-ink" },
  external: { text: "Free, no account", cls: "bg-teal/10 text-teal-ink" },
  workspace: { text: "Free account", cls: "bg-soft text-cobalt-dark" },
  planned: { text: "Planned", cls: "bg-gold/15 text-[#8a5d1c]" },
};

export function ToolDirectory({ tools }: { tools: Item[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<ToolCategory | "all">("all");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return tools.filter((t) => {
      if (cat !== "all" && t.category !== cat) return false;
      if (!term) return true;
      return [t.name, t.summary, ...t.keywords].some((s) => s.toLowerCase().includes(term));
    });
  }, [tools, q, cat]);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/45" aria-hidden="true" />
        <label htmlFor="tool-search" className="sr-only">Search research tools</label>
        <input
          id="tool-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search tools, e.g. odds ratio, power, t-test"
          className="w-full rounded-lg border border-navy/25 bg-white py-2.5 pl-9 pr-3 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        {[{ id: "all" as const, name: "All" }, ...CATEGORIES].map((c) => (
          <button
            key={c.id} type="button" onClick={() => setCat(c.id)} aria-pressed={cat === c.id}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${cat === c.id ? "border-cobalt bg-cobalt text-white" : "border-navy/25 bg-white text-navy hover:border-cobalt"}`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <p className="mt-4 text-sm text-navy/65" aria-live="polite">{filtered.length} {filtered.length === 1 ? "tool" : "tools"}</p>

      {CATEGORIES.filter((c) => filtered.some((t) => t.category === c.id)).map((c) => (
        <section key={c.id} className="mt-8" aria-labelledby={`cat-${c.id}`}>
          <h2 id={`cat-${c.id}`} className="text-lg font-semibold text-navy">{c.name}</h2>
          <p className="text-sm text-navy/65">{c.blurb}</p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.filter((t) => t.category === c.id).map((t) => {
              const badge = KIND_LABEL[t.kind];
              const body = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-navy">{t.name}</h3>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.text}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-navy/70">{t.summary}</p>
                </>
              );
              return (
                <li key={t.slug}>
                  {t.href ? (
                    <Link href={t.href} className="block h-full rounded-lg border border-line bg-white p-4 transition-colors hover:border-cobalt">{body}</Link>
                  ) : (
                    <div className="h-full rounded-lg border border-dashed border-navy/25 bg-paper p-4">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!filtered.length && <p className="mt-8 rounded-lg border border-dashed border-navy/25 p-6 text-center text-sm text-navy/65">No tools match. Try another term or category.</p>}
    </div>
  );
}

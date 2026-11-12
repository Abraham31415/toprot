"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Lock, Search, SearchX, X } from "lucide-react";
import {
  DIR_CATEGORIES, FEATURED, countByCategory, dirStateToSearch, filterItems, groupItems, parseDirState,
  type DirCategoryId, type DirFilter, type DirItem,
} from "@/lib/tools/directory-core";
import { TOOL_ICONS } from "./tool-icons";

const PREVIEW = 6; // tools shown per category before "Show all"
const catOf = (id: DirCategoryId) => DIR_CATEGORIES.find((c) => c.id === id)!;

function ToolCard({ item, showCategory = false, hidden = false }: { item: DirItem; showCategory?: boolean; hidden?: boolean }) {
  const cat = catOf(item.category);
  const Icon = TOOL_ICONS[item.icon];
  const body = (
    <>
      <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${cat.accent.tile}`}>
        <Icon className={`h-[18px] w-[18px] ${cat.accent.ink}`} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-5 text-navy">
          {item.label}
          {item.label !== item.fullName && <span className="sr-only"> ({item.fullName})</span>}
        </span>
        <span className="mt-0.5 block text-[13px] leading-[18px] text-navy/70">{item.blurb}</span>
        {showCategory && <span className={`mt-1.5 block text-[11px] font-medium ${cat.accent.ink}`}>{cat.name}</span>}
      </span>
      <span className="flex flex-none items-center gap-1.5 pt-0.5">
        {item.account && (
          <>
            <Lock className="h-3.5 w-3.5 text-navy/45" aria-hidden="true" />
            <span className="sr-only">Needs a free account</span>
          </>
        )}
        <ArrowUpRight className="h-4 w-4 text-navy/30 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-cobalt" aria-hidden="true" />
      </span>
    </>
  );
  const cls = `group flex h-full items-start gap-3 rounded-xl border border-line bg-white p-3.5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt hover:shadow-sm ${cat.accent.ring}`;
  return (
    <li className={hidden ? "hidden" : undefined}>
      {item.href ? (
        <Link href={item.href} className={cls}>{body}</Link>
      ) : (
        <div className="flex h-full items-start gap-3 rounded-xl border border-dashed border-navy/25 bg-paper p-3.5">{body}</div>
      )}
    </li>
  );
}

function CategoryNavButton({ id, name, count, active, onSelect, variant }: { id: DirCategoryId | "all"; name: string; count: number; active: boolean; onSelect: () => void; variant: "side" | "chip" }) {
  const Icon = id === "all" ? TOOL_ICONS["boxes"] : TOOL_ICONS[catOf(id).icon];
  const accent = id === "all" ? "text-navy" : catOf(id).accent.ink;
  if (variant === "chip") {
    return (
      <button
        type="button" onClick={onSelect} aria-pressed={active}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt ${active ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-cobalt"}`}
      >
        {name}
        <span className={`tabular-nums ${active ? "text-white/85" : "text-navy/70"}`}>{count}</span>
      </button>
    );
  }
  return (
    <button
      type="button" onClick={onSelect} aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt ${active ? "bg-soft font-semibold text-navy" : "text-navy/80 hover:bg-white"}`}
    >
      <Icon className={`h-4 w-4 flex-none ${active ? accent : "text-navy/50"}`} aria-hidden="true" />
      <span className="flex-1">{name}</span>
      <span className="text-xs tabular-nums text-navy/70">{count}</span>
    </button>
  );
}

function Grid({ items, showCategory }: { items: DirItem[]; showCategory?: boolean }) {
  return <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((i) => <ToolCard key={i.slug} item={i} showCategory={showCategory} />)}</ul>;
}

export function ToolDirectory({ items }: { items: DirItem[] }) {
  const [filter, setFilter] = useState<DirFilter>({ category: "all", query: "" });
  const [expanded, setExpanded] = useState<Set<DirCategoryId>>(new Set());

  // The address holds the state (?category=...&q=...), so links can be shared and back and forward work. The first render
  // always shows everything, which is also what search engines see.
  useEffect(() => {
    const sync = () => setFilter(parseDirState(window.location.search));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const write = (next: DirFilter, mode: "push" | "replace") => {
    setFilter(next);
    const url = `${window.location.pathname}${dirStateToSearch(next)}`;
    if (mode === "push") window.history.pushState(null, "", url); else window.history.replaceState(null, "", url);
  };
  const setCategory = (category: DirFilter["category"]) => { if (category !== filter.category) write({ ...filter, category }, "push"); };
  const setQuery = (query: string) => write({ ...filter, query }, "replace");

  const searching = filter.query.trim().length > 0;
  const counts = useMemo(() => countByCategory(items, filter.query), [items, filter.query]);
  const results = useMemo(() => filterItems(items, filter), [items, filter]);
  const elsewhere = searching && filter.category !== "all" ? counts.all - results.length : 0;
  const toggle = (id: DirCategoryId) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const navButtons = (variant: "side" | "chip") => (
    <>
      <CategoryNavButton id="all" name="All Tools" count={counts.all} active={filter.category === "all"} onSelect={() => setCategory("all")} variant={variant} />
      {DIR_CATEGORIES.map((c) => (
        <CategoryNavButton key={c.id} id={c.id} name={c.name} count={counts[c.id]} active={filter.category === c.id} onSelect={() => setCategory(c.id)} variant={variant} />
      ))}
    </>
  );

  const cat = filter.category === "all" ? null : catOf(filter.category);
  const summary = searching
    ? `${results.length} ${results.length === 1 ? "result" : "results"} for "${filter.query.trim()}"${cat ? ` in ${cat.name}` : ""}`
    : cat ? `${results.length} ${cat.name} tools` : `${results.length} tools in ${DIR_CATEGORIES.length} categories`;

  return (
    <div>
      <form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-navy/45" aria-hidden="true" />
        <label htmlFor="tool-search" className="sr-only">Search research tools</label>
        <input
          id="tool-search" type="search" value={filter.query} autoComplete="off" spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape" && filter.query) setQuery(""); }}
          placeholder="Search tools or methods"
          className="w-full rounded-xl border border-navy/20 bg-white py-3 pl-11 pr-10 text-[15px] text-navy shadow-sm outline-none placeholder:text-navy/65 focus:border-cobalt focus:ring-2 focus:ring-cobalt/25 [&::-webkit-search-cancel-button]:hidden"
        />
        {filter.query && (
          <button type="button" onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-navy/70 hover:bg-soft hover:text-navy focus-visible:outline-2 focus-visible:outline-cobalt">
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Clear search</span>
          </button>
        )}
      </form>

      {!filter.query && <p className="mt-1.5 px-1 text-xs text-navy/70">Try odds ratio, OR, t-test, ANCOVA or power.</p>}

      <div className="mt-4 flex flex-wrap gap-2 lg:hidden" role="group" aria-label="Filter by category">{navButtons("chip")}</div>

      <div className="mt-6 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Tool categories" className="sticky top-20 hidden self-start lg:block">
          <p className="px-2.5 pb-2 text-xs font-semibold uppercase tracking-wide text-navy/70">Categories</p>
          <div className="space-y-0.5">{navButtons("side")}</div>
        </nav>

        <div className="min-w-0">
          <p className="text-sm text-navy/65" aria-live="polite" role="status">{summary}</p>

          {!searching && filter.category === "all" && (
            <section aria-labelledby="featured-h" className="mt-3">
              <h2 id="featured-h" className="text-xs font-semibold uppercase tracking-wide text-navy/70">Most used</h2>
              <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {FEATURED.map((f) => {
                  const c = catOf(f.category);
                  const Icon = TOOL_ICONS[f.icon];
                  return (
                    <li key={f.slug}>
                      <Link href={f.href} className={`group flex h-full items-center gap-3 rounded-xl border border-line bg-white p-4 shadow-sm transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt sm:flex-col sm:items-stretch sm:gap-0 ${c.accent.ring}`}>
                        <span className="flex items-start justify-between sm:w-full">
                          <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.accent.tile}`}><Icon className={`h-5 w-5 ${c.accent.ink}`} aria-hidden="true" /></span>
                          <ArrowUpRight className="hidden h-4 w-4 text-navy/30 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-cobalt sm:block" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1 sm:mt-3 sm:flex-none">
                          <span className="block text-sm font-semibold text-navy">{f.label}</span>
                          <span className="mt-0.5 block text-[13px] leading-[18px] text-navy/70">{f.blurb}</span>
                        </span>
                        <ArrowUpRight className="h-4 w-4 flex-none text-navy/30 transition group-hover:text-cobalt sm:hidden" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {searching && (
            results.length > 0 ? (
              <div className="mt-4">
                <Grid items={results} showCategory />
                {elsewhere > 0 && (
                  <p className="mt-4 text-sm text-navy/70">
                    {elsewhere} more {elsewhere === 1 ? "match" : "matches"} in other categories.{" "}
                    <button type="button" onClick={() => setCategory("all")} className="font-medium text-cobalt underline underline-offset-2">Search all tools</button>
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-navy/25 bg-white px-6 py-10 text-center">
                <SearchX className="mx-auto h-8 w-8 text-navy/35" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-navy">No tools match &ldquo;{filter.query.trim()}&rdquo;</p>
                <p className="mt-1 text-sm text-navy/70">Try a method or abbreviation such as OR, RR, t-test, ANOVA or power, or{" "}
                  {cat && counts.all > 0 ? <button type="button" onClick={() => setCategory("all")} className="font-medium text-cobalt underline underline-offset-2">search all {counts.all} matching tools</button> : "clear the search"}.
                </p>
                <button type="button" onClick={() => write({ category: "all", query: "" }, "push")} className="mt-4 rounded-md border border-navy/25 bg-white px-3 py-1.5 text-sm font-medium text-navy hover:border-cobalt">Clear search and filters</button>
              </div>
            )
          )}

          {!searching && filter.category === "all" && (
            <div className="mt-8 space-y-10">
              {DIR_CATEGORIES.map((c) => {
                const list = results.filter((i) => i.category === c.id);
                if (list.length === 0) return null;
                const open = expanded.has(c.id);
                const extra = list.length - PREVIEW;
                const Icon = TOOL_ICONS[c.icon];
                return (
                  <section key={c.id} aria-labelledby={`cat-${c.id}`}>
                    <div className="flex items-end justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.accent.tile}`}><Icon className={`h-4 w-4 ${c.accent.ink}`} aria-hidden="true" /></span>
                        <div>
                          <h2 id={`cat-${c.id}`} className="text-base font-semibold leading-5 text-navy">{c.name} <span className="font-normal text-navy/70">({list.length})</span></h2>
                          <p className="text-xs text-navy/65">{c.blurb}</p>
                        </div>
                      </div>
                      <button type="button" onClick={() => setCategory(c.id)} className="flex-none text-sm font-medium text-cobalt hover:underline focus-visible:outline-2 focus-visible:outline-cobalt">
                        View category<span className="sr-only"> {c.name}</span>
                      </button>
                    </div>
                    {/* Every card is in the page so search engines and keyboard users reach every tool; extras are only hidden until expanded. */}
                    <ul id={`list-${c.id}`} className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {list.map((i, n) => <ToolCard key={i.slug} item={i} hidden={n >= PREVIEW && !open} />)}
                    </ul>
                    {extra > 0 && (
                      <button
                        type="button" onClick={() => toggle(c.id)} aria-expanded={open} aria-controls={`list-${c.id}`}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-navy hover:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt"
                      >
                        {open ? "Show fewer" : `Show all ${list.length}`}
                        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                      </button>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {!searching && cat && (
            <section aria-labelledby="cat-view-h" className="mt-4">
              <h2 id="cat-view-h" className="sr-only">{cat.name}</h2>
              <p className="text-sm text-navy/70">{cat.blurb}</p>
              <div className="mt-5 space-y-8">
                {groupItems(results).map((g) => (
                  <div key={g.name ?? "other"}>
                    {g.name && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy/70">{g.name}</h3>}
                    <Grid items={g.items} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

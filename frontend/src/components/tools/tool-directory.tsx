"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Search, SearchX, X } from "lucide-react";
import {
  DIR_CATEGORIES, FEATURED, countByCategory, dirStateToSearch, filterItems, groupItems, parseDirState,
  type DirCategoryId, type DirFilter, type DirItem,
} from "@/lib/tools/directory-core";
import { TOOL_ICONS } from "./tool-icons";
import { FeaturedToolCard, ToolCard } from "@/components/ds/card";
import { TONES } from "@/components/ds/icons";

const PREVIEW = 6; // tools shown per category before "Show all"
const catOf = (id: DirCategoryId) => DIR_CATEGORIES.find((c) => c.id === id)!;

function DirectoryToolCard({ item, showCategory = false, hidden = false }: { item: DirItem; showCategory?: boolean; hidden?: boolean }) {
  const cat = catOf(item.category);
  return (
    <li className={hidden ? "hidden" : undefined}>
      <ToolCard icon={TOOL_ICONS[item.icon]} tone={cat.tone} label={item.label} fullName={item.fullName} description={item.blurb} href={item.href} account={item.account} category={showCategory ? cat.name : undefined} />
    </li>
  );
}

function CategoryNavButton({ id, name, count, active, onSelect, variant }: { id: DirCategoryId | "all"; name: string; count: number; active: boolean; onSelect: () => void; variant: "side" | "chip" }) {
  const Icon = id === "all" ? TOOL_ICONS["boxes"] : TOOL_ICONS[catOf(id).icon];
  const accent = id === "all" ? "text-ink" : TONES[catOf(id).tone].ink;
  if (variant === "chip") {
    return (
      <button
        type="button" onClick={onSelect} aria-pressed={active}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${active ? "border-navy bg-navy text-white" : "border-line bg-surface text-ink hover:border-primary"}`}
      >
        {name}
        <span className={`tabular-nums ${active ? "text-white/85" : "text-ink-soft"}`}>{count}</span>
      </button>
    );
  }
  return (
    <button
      type="button" onClick={onSelect} aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${active ? "bg-surface-soft font-semibold text-ink" : "text-ink-soft hover:bg-surface"}`}
    >
      <Icon className={`h-4 w-4 flex-none ${active ? accent : "text-ink-muted"}`} aria-hidden="true" />
      <span className="flex-1">{name}</span>
      <span className="text-xs tabular-nums text-ink-soft">{count}</span>
    </button>
  );
}

function Grid({ items, showCategory }: { items: DirItem[]; showCategory?: boolean }) {
  return <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((i) => <DirectoryToolCard key={i.slug} item={i} showCategory={showCategory} />)}</ul>;
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
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <label htmlFor="tool-search" className="sr-only">Search research tools</label>
        <input
          id="tool-search" type="search" value={filter.query} autoComplete="off" spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape" && filter.query) setQuery(""); }}
          placeholder="Search tools or methods"
          className="w-full rounded-xl border border-line-strong bg-surface py-3 pl-11 pr-10 text-[15px] text-ink shadow-sm outline-none placeholder:text-ink-soft focus:border-primary focus:ring-2 focus:ring-primary/25 [&::-webkit-search-cancel-button]:hidden"
        />
        {filter.query && (
          <button type="button" onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-soft hover:bg-surface-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Clear search</span>
          </button>
        )}
      </form>

      {!filter.query && <p className="mt-1.5 px-1 text-xs text-ink-soft">Try odds ratio, OR, t-test, ANCOVA or power.</p>}

      <div className="mt-4 flex flex-wrap gap-2 lg:hidden" role="group" aria-label="Filter by category">{navButtons("chip")}</div>

      <div className="mt-6 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Tool categories" className="sticky top-20 hidden self-start lg:block">
          <p className="px-2.5 pb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Categories</p>
          <div className="space-y-0.5">{navButtons("side")}</div>
        </nav>

        <div className="min-w-0">
          <p className="text-sm text-ink-soft" aria-live="polite" role="status">{summary}</p>

          {!searching && filter.category === "all" && (
            <section aria-labelledby="featured-h" className="mt-3">
              <h2 id="featured-h" className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Most used</h2>
              <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {FEATURED.map((f) => (
                  <li key={f.slug}><FeaturedToolCard icon={TOOL_ICONS[f.icon]} tone={catOf(f.category).tone} label={f.label} description={f.blurb} href={f.href} /></li>
                ))}
              </ul>
            </section>
          )}

          {searching && (
            results.length > 0 ? (
              <div className="mt-4">
                <Grid items={results} showCategory />
                {elsewhere > 0 && (
                  <p className="mt-4 text-sm text-ink-soft">
                    {elsewhere} more {elsewhere === 1 ? "match" : "matches"} in other categories.{" "}
                    <button type="button" onClick={() => setCategory("all")} className="font-medium text-primary underline underline-offset-2">Search all tools</button>
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
                <SearchX className="mx-auto h-8 w-8 text-ink-muted" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-ink">No tools match &ldquo;{filter.query.trim()}&rdquo;</p>
                <p className="mt-1 text-sm text-ink-soft">Try a method or abbreviation such as OR, RR, t-test, ANOVA or power, or{" "}
                  {cat && counts.all > 0 ? <button type="button" onClick={() => setCategory("all")} className="font-medium text-primary underline underline-offset-2">search all {counts.all} matching tools</button> : "clear the search"}.
                </p>
                <button type="button" onClick={() => write({ category: "all", query: "" }, "push")} className="mt-4 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:border-primary">Clear search and filters</button>
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
                        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TONES[c.tone].tile}`}><Icon className={`h-4 w-4 ${TONES[c.tone].ink}`} aria-hidden="true" /></span>
                        <div>
                          <h2 id={`cat-${c.id}`} className="text-base font-semibold leading-5 text-ink">{c.name} <span className="font-normal text-ink-soft">({list.length})</span></h2>
                          <p className="text-xs text-ink-soft">{c.blurb}</p>
                        </div>
                      </div>
                      <button type="button" onClick={() => setCategory(c.id)} className="flex-none text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                        View category<span className="sr-only"> {c.name}</span>
                      </button>
                    </div>
                    {/* Every card is in the page so search engines and keyboard users reach every tool; extras are only hidden until expanded. */}
                    <ul id={`list-${c.id}`} className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {list.map((i, n) => <DirectoryToolCard key={i.slug} item={i} hidden={n >= PREVIEW && !open} />)}
                    </ul>
                    {extra > 0 && (
                      <button
                        type="button" onClick={() => toggle(c.id)} aria-expanded={open} aria-controls={`list-${c.id}`}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
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
              <p className="text-sm text-ink-soft">{cat.blurb}</p>
              <div className="mt-5 space-y-8">
                {groupItems(results).map((g) => (
                  <div key={g.name ?? "other"}>
                    {g.name && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">{g.name}</h3>}
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

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, BookOpen, Clock, Database, FlaskConical, PenLine, Search, SearchX, Sigma, X, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ds/card";
import { IconWrapper, type Tone } from "@/components/ds/icons";
import { categoryFromSearch, countByCategory, searchGuides, type GuideCard } from "@/lib/resources/browse";

// The Resources page body: search, the category cards and the guide cards. It receives only guides that are published, so there is
// nothing here that could show a draft.

type Category = { id: string; name: string; blurb: string; icon: string };

const ICON: Record<string, { icon: LucideIcon; tone: Tone }> = {
  flask: { icon: FlaskConical, tone: "cobalt" },
  sigma: { icon: Sigma, tone: "teal" },
  activity: { icon: Activity, tone: "gold" },
  book: { icon: BookOpen, tone: "violet" },
  pen: { icon: PenLine, tone: "ocean" },
  database: { icon: Database, tone: "terracotta" },
};

const dateFmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

function GuideCardView({ g, category }: { g: GuideCard; category: Category | undefined }) {
  const meta = ICON[category?.icon ?? "flask"] ?? ICON.flask;
  return (
    <Card as="article" interactive padding="md" className="flex h-full flex-col">
      <p className="flex items-center gap-2 type-eyebrow"><IconWrapper icon={meta.icon} tone={meta.tone} size="sm" />{category?.name}</p>
      <h3 className="mt-3 text-lg font-semibold leading-snug text-ink">
        <Link href={`/resources/${g.slug}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">{g.title}</Link>
      </h3>
      <p className="type-body mt-2">{g.summary}</p>
      <p className="type-caption mt-auto flex items-center gap-3 pt-4"><span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{g.minutes} min read</span><span>Updated {dateFmt(g.updatedOn)}</span></p>
    </Card>
  );
}

export function GuideBrowser({ guides, categories }: { guides: GuideCard[]; categories: Category[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "";

  // The address holds the category (?category=...), so a link to a category works and back and forward behave. The first render shows everything.
  useEffect(() => {
    const sync = () => setCategory(categoryFromSearch(window.location.search, categories.map((c) => c.id)));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [categories]);

  const choose = (id: string) => {
    setCategory(id);
    window.history.pushState(null, "", id === "all" ? window.location.pathname : `${window.location.pathname}?category=${id}`);
  };

  const counts = useMemo(() => countByCategory(guides), [guides]);
  const results = useMemo(() => searchGuides(guides, query, category, catName), [guides, query, category]); // eslint-disable-line react-hooks/exhaustive-deps
  const featured = guides.filter((g) => g.featured);
  const browsing = !query.trim() && category === "all";

  return (
    <div>
      {guides.length > 0 && (
        <form role="search" onSubmit={(e) => e.preventDefault()} className="relative max-w-2xl">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <label htmlFor="guide-search" className="sr-only">Search guides</label>
          <input
            id="guide-search" type="search" value={query} autoComplete="off" spellCheck={false} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && query) setQuery(""); }}
            placeholder="Search guides, for example sample size or p-value"
            className="h-12 w-full rounded-card border border-line-strong bg-surface pl-11 pr-10 text-base text-ink shadow-card outline-none placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary/25 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-control p-1.5 text-ink-muted hover:bg-hover hover:text-ink">
              <X className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Clear search</span>
            </button>
          )}
        </form>
      )}

      <section aria-labelledby="cats-h" className={guides.length > 0 ? "mt-8" : ""}>
        <h2 id="cats-h" className="type-label">Browse by topic</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => {
            const meta = ICON[c.icon] ?? ICON.flask;
            const n = counts[c.id] ?? 0;
            const active = category === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button" disabled={n === 0} aria-pressed={active} onClick={() => choose(active ? "all" : c.id)}
                  className={`flex h-full w-full items-start gap-3 rounded-card border p-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${active ? "border-primary bg-surface-soft" : "border-line bg-surface shadow-card"} ${n === 0 ? "cursor-default opacity-80" : "hover:border-primary/60"}`}
                >
                  <IconWrapper icon={meta.icon} tone={meta.tone} />
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{c.name}</span>
                    <span className="type-support mt-0.5 block">{c.blurb}</span>
                    <span className="type-caption mt-1.5 block">{n === 0 ? "No published guides yet" : `${n} ${n === 1 ? "guide" : "guides"}`}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {guides.length > 0 && (
        <>
          {browsing && featured.length > 0 && (
            <section aria-labelledby="featured-h" className="mt-10">
              <h2 id="featured-h" className="type-section !text-xl">Featured guides</h2>
              <ul className="mt-4 grid gap-4 md:grid-cols-2">
                {featured.map((g) => <li key={g.slug}><GuideCardView g={g} category={categories.find((c) => c.id === g.category)} /></li>)}
              </ul>
            </section>
          )}

          <section aria-labelledby="all-h" className="mt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="all-h" className="type-section !text-xl">{category === "all" ? "All guides" : catName(category)}</h2>
              <p className="type-support" role="status" aria-live="polite">{results.length} {results.length === 1 ? "guide" : "guides"}{query.trim() ? ` for "${query.trim()}"` : ""}</p>
            </div>
            {results.length > 0 ? (
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {results.map((g) => <li key={g.slug}><GuideCardView g={g} category={categories.find((c) => c.id === g.category)} /></li>)}
              </ul>
            ) : (
              <div className="mt-4 rounded-card border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
                <SearchX className="mx-auto h-8 w-8 text-ink-muted" aria-hidden="true" />
                <p className="mt-3 font-medium text-ink">No guides match</p>
                <button type="button" onClick={() => { setQuery(""); choose("all"); }} className="mt-3 rounded-control border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:border-primary">Clear search and filters</button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

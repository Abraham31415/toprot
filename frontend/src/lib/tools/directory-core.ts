import type { ToolCategory } from "./types";

// How the tools are presented on the /tools directory. This file changes nothing about a calculator: formulas, inputs, URLs
// and the full technical names on each tool's own page all stay as they are. Here each tool only gets a short label, a one
// line description, an icon, a group and search aliases for the directory cards and search.

export type DirCategoryId = "sample-size" | "statistics" | "epidemiology" | "design" | "literature" | "data" | "writing";
export type IconKey =
  | "calculator" | "sigma" | "percent" | "users" | "users-round" | "scale" | "activity" | "trending-up" | "stethoscope" | "flask" | "clipboard-list"
  | "clipboard-check" | "file-text" | "book-open" | "library" | "search" | "quote" | "pen-line" | "sparkles" | "table" | "grid" | "git-compare" | "link"
  | "target" | "timer" | "calendar-clock" | "shield-check" | "list-checks" | "layers" | "network" | "dices" | "gauge" | "hourglass" | "repeat" | "shuffle"
  | "boxes" | "lightbulb" | "filter" | "microscope" | "heart-pulse" | "ruler" | "sliders" | "variable" | "chart-column" | "chart-line" | "chart-scatter"
  | "file-question" | "message-text" | "circle-dot" | "split" | "file-spreadsheet" | "form-input" | "file-search" | "bot";

export type DirTone = "cobalt" | "teal" | "navy" | "gold" | "violet" | "terracotta" | "ocean";

/** Each category has one restrained accent tone. The tones are design tokens (see globals.css and components/ds/icons). */
export const DIR_CATEGORIES: { id: DirCategoryId; name: string; blurb: string; icon: IconKey; tone: DirTone; from: ToolCategory[] }[] = [
  { id: "sample-size", name: "Sample Size & Power", blurb: "Work out how many participants you need.", icon: "users", tone: "cobalt", from: ["sample-size"] },
  { id: "statistics", name: "Statistical Analysis", blurb: "Tests, intervals, correlation and regression.", icon: "sigma", tone: "teal", from: ["statistical"] },
  { id: "epidemiology", name: "Epidemiology", blurb: "Risk, odds, rates and diagnostic accuracy.", icon: "activity", tone: "gold", from: ["epidemiology"] },
  { id: "design", name: "Study Design", blurb: "Frame the question, population and protocol.", icon: "layers", tone: "navy", from: ["study-design"] },
  { id: "literature", name: "Literature & References", blurb: "Find, organise and read the evidence.", icon: "library", tone: "violet", from: ["literature"] },
  { id: "data", name: "Data Collection", blurb: "Instruments, forms and data dictionaries.", icon: "clipboard-list", tone: "terracotta", from: ["data-collection"] },
  { id: "writing", name: "Writing & Reporting", blurb: "Draft, cite and track your study.", icon: "pen-line", tone: "ocean", from: ["writing", "reporting"] },
];

export const categoryOf = (c: ToolCategory): DirCategoryId => DIR_CATEGORIES.find((d) => d.from.includes(c))!.id;

export type DirItem = {
  slug: string;
  href: string | null;
  label: string;
  /** The tool's complete name, kept for the accessible name and search. */
  fullName: string;
  blurb: string;
  icon: IconKey;
  category: DirCategoryId;
  group: string | null;
  keywords: string[];
  /** Needs a free account: tools that live inside a study. */
  account: boolean;
};

export const FEATURED: { slug: string; label: string; blurb: string; icon: IconKey; category: DirCategoryId; href: string }[] = [
  { slug: "sample-size-calculator", label: "Sample Size Calculator", blurb: "Find how many participants your design needs.", icon: "calculator", category: "sample-size", href: "/tools/sample-size-calculator" },
  { slug: "chi-square-calculator", label: "Chi-Square Calculator", blurb: "Test for association in a 2x2 table.", icon: "grid", category: "statistics", href: "/tools/chi-square-calculator" },
  { slug: "odds-ratio-calculator", label: "Odds Ratio Calculator", blurb: "Odds ratio with a confidence interval.", icon: "git-compare", category: "epidemiology", href: "/tools/odds-ratio-calculator" },
  { slug: "diagnostic-accuracy-calculator", label: "Diagnostic Accuracy Calculator", blurb: "Sensitivity, specificity and likelihood ratios.", icon: "stethoscope", category: "epidemiology", href: "/tools/diagnostic-accuracy-calculator" },
];

// ---------- Search and filtering (pure, so it can be tested without a browser) ----------

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’`]/g, "").replace(/[^a-z0-9%:+]+/g, " ").trim();
const words = (s: string) => norm(s).split(" ").filter(Boolean);

const SKIP_WORDS = new Set(["of", "and", "for", "the", "a", "to", "in"]);
const FILLER = new Set(["or", "and", "of", "in", "to", "a", "the", "for", "vs"]);
/** Initials of a label: "Odds Ratio" is OR, "Relative Risk" is RR, "Risk Difference & NNT" is RDN. */
const acronym = (label: string) => label.split(/[^A-Za-z0-9]+/).filter((w) => w && !SKIP_WORDS.has(w.toLowerCase())).map((w) => w[0]).join("").toLowerCase();

/** How well an item matches a search, 0 for no match. Every word the user typed must match something. */
export function scoreItem(item: DirItem, query: string): number {
  const typed = words(query);
  if (typed.length === 0) return 1;
  // Filler words ("or", "and", "of") carry no meaning inside a longer search such as a tool's full name. A search that is only
  // such a word, like "OR", is an abbreviation and is handled below.
  const meaningful = typed.filter((t) => !FILLER.has(t));
  const tokens = meaningful.length > 0 ? meaningful : typed;
  const cat = DIR_CATEGORIES.find((c) => c.id === item.category)!;
  const fields: { text: string; weight: number }[] = [
    { text: item.label, weight: 100 }, { text: item.fullName, weight: 80 }, { text: item.keywords.join(" "), weight: 50 },
    { text: item.blurb, weight: 25 }, { text: `${cat.name} ${item.group ?? ""}`, weight: 15 },
  ];
  const initials = acronym(item.label);
  let total = 0;
  for (const tok of tokens) {
    let best = 0;
    if (tok.length <= 2) {
      // One- and two-letter words such as OR, RR, CI or r are abbreviations. Matching them inside descriptions would find the
      // English word "or", so they match only an explicit alias, or the initials of the tool's name (Odds Ratio is OR).
      if (initials === tok) best = 90;
      if (norm(item.keywords.join(" ")).split(" ").includes(tok)) best = Math.max(best, 50);
    } else {
      for (const f of fields) {
        const n = norm(f.text);
        if (!n.includes(tok)) continue;
        const bonus = n.startsWith(tok) ? 10 : n.split(" ").some((x) => x.startsWith(tok)) ? 5 : 0;
        best = Math.max(best, f.weight + bonus);
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

export type DirFilter = { category: DirCategoryId | "all"; query: string };

/** Items for a filter: search results ranked by relevance, otherwise in the directory's own order. */
export function filterItems(items: DirItem[], { category, query }: DirFilter): DirItem[] {
  const inCat = category === "all" ? items : items.filter((i) => i.category === category);
  if (!query.trim()) return inCat;
  return inCat.map((i, idx) => ({ i, s: scoreItem(i, query), idx })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.idx - b.idx).map((x) => x.i);
}

export const countByCategory = (items: DirItem[], query = ""): Record<DirCategoryId | "all", number> => {
  const out = { all: 0 } as Record<DirCategoryId | "all", number>;
  for (const c of DIR_CATEGORIES) out[c.id] = 0;
  for (const i of filterItems(items, { category: "all", query })) { out.all += 1; out[i.category] += 1; }
  return out;
};

/** Items of one category split into their groups, in the order the groups first appear. Ungrouped items come last. */
export function groupItems(items: DirItem[]): { name: string | null; items: DirItem[] }[] {
  const order: (string | null)[] = [];
  for (const i of items) if (!order.includes(i.group)) order.push(i.group);
  const named = order.filter((g): g is string => g !== null).map((g) => ({ name: g as string | null, items: items.filter((i) => i.group === g) }));
  const rest = items.filter((i) => i.group === null);
  return rest.length ? [...named, { name: null, items: rest }] : named;
}

// ---------- Address (URL) state ----------

export function parseDirState(search: string): DirFilter {
  const p = new URLSearchParams(search);
  const c = p.get("category") ?? "all";
  const category = DIR_CATEGORIES.some((d) => d.id === c) ? (c as DirCategoryId) : "all";
  return { category, query: (p.get("q") ?? "").slice(0, 80) };
}

export function dirStateToSearch({ category, query }: DirFilter): string {
  const p = new URLSearchParams();
  if (category !== "all") p.set("category", category);
  if (query.trim()) p.set("q", query.trim());
  const s = p.toString();
  return s ? `?${s}` : "";
}

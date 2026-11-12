// Searching and filtering the guide list on the Resources page. Pure functions, so they can be tested without a browser.

export type GuideCard = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  keywords: string[];
  minutes: number;
  featured: boolean;
  updatedOn: string;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9%+ ]+/g, " ").replace(/\s+/g, " ").trim();

/** Every word typed must appear in the title, summary, keywords or category name. Title matches rank first. */
export function searchGuides(guides: GuideCard[], query: string, category: string | "all", categoryName: (id: string) => string): GuideCard[] {
  const words = norm(query).split(" ").filter(Boolean);
  const inCategory = guides.filter((g) => category === "all" || g.category === category);
  if (words.length === 0) return inCategory;
  const scored: { g: GuideCard; score: number }[] = [];
  for (const g of inCategory) {
    const title = norm(g.title);
    const rest = norm([g.summary, g.keywords.join(" "), categoryName(g.category)].join(" "));
    if (!words.every((w) => title.includes(w) || rest.includes(w))) continue;
    scored.push({ g, score: words.reduce((n, w) => n + (title.includes(w) ? 3 : 0) + (rest.includes(w) ? 1 : 0), 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.g.title.localeCompare(b.g.title)).map((x) => x.g);
}

export const countByCategory = (guides: GuideCard[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const g of guides) out[g.category] = (out[g.category] ?? 0) + 1;
  return out;
};

/** The category in a query string such as ?category=biostatistics, or "all" when it is missing or unknown. */
export function categoryFromSearch(search: string, valid: string[]): string {
  const c = new URLSearchParams(search).get("category");
  return c && valid.includes(c) ? c : "all";
}

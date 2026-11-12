// Shared fixtures for the guide tests: a complete guide as a file would hold it.

export const WORDS = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} explains a method in plain words for readers of the guide.`).join(" ");

/** A complete guide as a file would hold it. Overrides replace front matter lines. */
export function guideText(over: Record<string, string> = {}, extraBody = ""): string {
  const fm: Record<string, string> = {
    title: "A guide for the tests",
    description: "A description that is long enough to satisfy the rule of ninety characters at least, and short enough for one hundred sixty.",
    summary: "A short summary.",
    category: "methodology",
    status: "draft",
    author: "A. Author",
    updatedOn: "2026-11-12",
    ...over,
  };
  const head = Object.entries(fm).map(([k, v]) => (v === "" ? null : `${k}: ${v}`)).filter(Boolean).join("\n");
  const src = (n: number) => `  - citation: "Author ${n}. A title that is long enough to count as a citation. Journal. 2020;1:1-2."\n    doi: 10.1000/test${n}\n    verified: true`;
  return `---\n${head}\nsources:\n${src(1)}\n${src(2)}\n${src(3)}\n---\n\n## First heading\n\n${WORDS}\n\n## Second heading\n\n${extraBody}\n`;
}


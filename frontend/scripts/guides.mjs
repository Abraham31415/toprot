// Editorial commands for the research guides in content/guides.
//
//   npm run guides -- list
//   npm run guides -- check [slug]
//   npm run guides -- verify-dois [slug]          looks each DOI up at Crossref and prints what it found, for you to compare
//   npm run guides -- publish <slug> --reviewer "Name" [--feature]
//   npm run guides -- unpublish <slug>
//
// "publish" uses the same rule as the website (src/lib/resources/guide-core.mjs): it refuses to change a file unless the guide has
// a reviewer, at least three sources, every source marked verified, and no [VERIFY] markers. Run it, then commit and deploy.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGuide, publishBlockers, setFrontMatter, structureProblems } from "../src/lib/resources/guide-core.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "guides");
const today = () => new Date().toISOString().slice(0, 10);
const files = () => readdirSync(DIR).filter((f) => f.endsWith(".md")).sort();
const read = (slug) => readFileSync(join(DIR, `${slug}.md`), "utf8");
const all = () => files().map((f) => { const slug = f.replace(/\.md$/, ""); return parseGuide(slug, read(slug)); });

const [, , cmd, slug, ...rest] = process.argv;
const flag = (name) => { const i = [slug, ...rest].indexOf(`--${name}`); const a = [slug, ...rest]; return i >= 0 ? (a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : true) : undefined; };
const fail = (msg) => { console.error(msg); process.exit(1); };
const need = () => { if (!slug || slug.startsWith("--")) fail("Give the guide's slug, for example: npm run guides -- publish how-to-calculate-sample-size --reviewer \"Name\""); if (!files().includes(`${slug}.md`)) fail(`No guide named ${slug}.`); };

if (cmd === "list") {
  for (const g of all()) {
    const v = g.sources.filter((s) => s.verified).length;
    console.log(`${g.status.padEnd(10)} ${String(g.words).padStart(5)} words  ${v}/${g.sources.length} sources verified  ${g.slug}`);
  }
} else if (cmd === "check") {
  const slugs = slug && !slug.startsWith("--") ? [slug] : files().map((f) => f.replace(/\.md$/, ""));
  const guideExists = (s) => files().includes(`${s}.md`);
  let bad = 0;
  for (const s of slugs) {
    const g = parseGuide(s, read(s));
    const problems = structureProblems(g, { guideExists });
    const blockers = publishBlockers(g);
    console.log(`${s}  [${g.status}]`);
    for (const p of problems) { console.log(`  problem: ${p}`); bad++; }
    for (const b of blockers) console.log(`  not publishable: ${b}`);
    if (!problems.length && !blockers.length) console.log("  ready to publish");
  }
  if (bad) process.exit(1);
} else if (cmd === "verify-dois") {
  const slugs = slug && !slug.startsWith("--") ? [slug] : files().map((f) => f.replace(/\.md$/, ""));
  for (const s of slugs) {
    const g = parseGuide(s, read(s));
    for (const src of g.sources.filter((x) => x.doi)) {
      try {
        const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(src.doi)}`, { headers: { "User-Agent": "toprot-guides-check" } });
        if (!r.ok) { console.log(`${s}  doi:${src.doi}  NOT FOUND (${r.status})`); continue; }
        const m = (await r.json()).message;
        const year = m.issued?.["date-parts"]?.[0]?.[0];
        console.log(`${s}  doi:${src.doi}\n    found: ${m.title?.[0]} (${m["container-title"]?.[0] ?? m.type}, ${year}) ${m.author?.[0]?.family ?? ""}\n    cited: ${src.citation.slice(0, 110)}`);
      } catch (e) { console.log(`${s}  doi:${src.doi}  could not check: ${e.message}`); }
    }
  }
  console.log("\nCompare each pair. Set verified: true yourself only when the citation matches the source.");
} else if (cmd === "publish") {
  need();
  const reviewer = flag("reviewer");
  if (!reviewer || reviewer === true) fail("Name the reviewer: --reviewer \"Full name\"");
  const text = read(slug);
  const g = parseGuide(slug, text);
  const date = flag("date") && flag("date") !== true ? flag("date") : today();
  const next = { ...g, status: "published", reviewedBy: reviewer, reviewedOn: date, publishedOn: g.publishedOn ?? date, updatedOn: g.updatedOn };
  const blockers = publishBlockers(next);
  if (blockers.length) { console.error(`${slug} cannot be published yet:`); for (const b of blockers) console.error(`  - ${b}`); process.exit(1); }
  const updates = { status: "published", reviewedBy: reviewer, reviewedOn: date, publishedOn: next.publishedOn };
  if (flag("feature")) updates.featured = "true";
  writeFileSync(join(DIR, `${slug}.md`), setFrontMatter(text, updates), "utf8");
  console.log(`Published ${slug}, reviewed by ${reviewer} on ${date}. Commit and deploy to make it live.`);
} else if (cmd === "unpublish") {
  need();
  writeFileSync(join(DIR, `${slug}.md`), setFrontMatter(read(slug), { status: "draft" }), "utf8");
  console.log(`${slug} is now a draft. Commit and deploy to take it down.`);
} else {
  console.log("Commands: list | check [slug] | verify-dois [slug] | publish <slug> --reviewer \"Name\" [--feature] | unpublish <slug>");
}

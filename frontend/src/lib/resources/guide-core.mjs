// Core of the guide system: front matter, a small Markdown parser, table of contents and the publication gate.
//
// This is plain JavaScript on purpose. The website imports it, and so does the command line tool (scripts/guides.mjs), so there is
// one definition of "what makes a guide publishable". It has no dependencies and does not read files.

/** @typedef {"draft" | "in_review" | "published"} GuideStatus */
/** @typedef {{ citation: string, doi?: string, url?: string, verified: boolean, note?: string }} GuideSource */

export const CATEGORIES = [
  { id: "methodology", name: "Research Methodology", blurb: "Plan a study from question to protocol.", icon: "flask" },
  { id: "biostatistics", name: "Biostatistics", blurb: "Sample size, tests, p-values and intervals.", icon: "sigma" },
  { id: "epidemiology", name: "Epidemiology", blurb: "Study designs, risk and measures of association.", icon: "activity" },
  { id: "literature-reviews", name: "Literature Reviews", blurb: "Search, screen and synthesise evidence.", icon: "book" },
  { id: "academic-writing", name: "Academic Writing", blurb: "Structure, cite and report your research.", icon: "pen" },
  { id: "data-management", name: "Research Data Management", blurb: "Collect, store, document and share data.", icon: "database" },
];

export const STATUSES = ["draft", "in_review", "published"];

/** A body marker an editor leaves where a claim still needs checking. A guide containing one cannot be published. */
export const VERIFY_MARKER = /\[VERIFY[^\]]*\]/i;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ---------- Front matter (a small, strict subset of YAML) ----------

const unquote = (v) => {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
};
const scalar = (v) => {
  const t = unquote(v);
  if (v.trim() === "true") return true;
  if (v.trim() === "false") return false;
  return t;
};
const inlineList = (v) => {
  const inner = v.trim().slice(1, -1).trim();
  return inner === "" ? [] : inner.split(",").map((x) => unquote(x));
};

/**
 * Splits "---\nkey: value\n---\nbody" into data and body. Supports: key: value, key: [a, b], and block lists of values or of
 * mappings (used for sources). Anything else is an error rather than being guessed at.
 * @returns {{ data: Record<string, any>, body: string }}
 */
export function parseFrontMatter(text) {
  const src = text.replace(/\r\n/g, "\n");
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error("Missing front matter: a guide must start with a --- block.");
  const data = {};
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const top = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (!top) throw new Error(`Front matter line ${i + 1} is not "key: value": ${line}`);
    const [, key, rest] = top;
    if (rest.trim() !== "") {
      data[key] = rest.trim().startsWith("[") ? inlineList(rest) : scalar(rest);
      continue;
    }
    // A block list: lines beginning with "  - ".
    const items = [];
    while (i + 1 < lines.length && /^\s+(- |[A-Za-z])/.test(lines[i + 1])) {
      const next = lines[++i];
      const item = next.match(/^\s+- (.*)$/);
      if (item) {
        const kv = item[1].match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
        if (kv) items.push({ [kv[1]]: scalar(kv[2]) });
        else items.push(scalar(item[1]));
      } else {
        const kv = next.match(/^\s+([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
        if (!kv || typeof items[items.length - 1] !== "object") throw new Error(`Front matter line ${i + 1} is not part of a list item: ${next}`);
        items[items.length - 1][kv[1]] = scalar(kv[2]);
      }
    }
    data[key] = items;
  }
  return { data, body: m[2] };
}

// ---------- Markdown (the subset guides use) ----------

export const slugify = (text) =>
  text.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-");

/**
 * Parses Markdown into blocks. Supported: ## and ### headings, paragraphs, bullet and numbered lists, block quotes (used for worked
 * examples and notes), tables, $$ equation blocks, fenced code and horizontal rules. Inline formatting is parsed by parseInline.
 * Raw HTML is not supported and is treated as text.
 * @returns {Array<any>}
 */
export function parseMarkdown(body) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  const used = new Map();
  const idFor = (text) => {
    const base = slugify(text) || "section";
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (h) { blocks.push({ type: "heading", level: h[1].length, text: h[2], id: idFor(h[2]) }); i++; continue; }
    if (/^#\s/.test(line)) throw new Error(`Use ## for headings; the page title comes from the front matter: ${line}`);

    if (/^---+\s*$/.test(line)) { blocks.push({ type: "rule" }); i++; continue; }

    if (line.trim() === "$$") {
      const eq = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") eq.push(lines[i++]);
      i++;
      blocks.push({ type: "math", text: eq.join("\n").trim() });
      continue;
    }

    if (line.startsWith("```")) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    if (line.startsWith(">")) {
      const q = [];
      while (i < lines.length && lines[i].startsWith(">")) q.push(lines[i++].replace(/^>\s?/, ""));
      const first = q[0]?.match(/^\*\*(.+?)\*\*\s*$/);
      blocks.push({ type: "callout", title: first ? first[1] : null, blocks: parseMarkdown(first ? q.slice(1).join("\n") : q.join("\n")) });
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const header = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const ordered = !!ol;
      const items = [];
      while (i < lines.length) {
        const cur = lines[i];
        const m2 = ordered ? cur.match(/^\d+[.)]\s+(.*)$/) : cur.match(/^[-*]\s+(.*)$/);
        if (m2) { items.push(m2[1]); i++; }
        else if (/^\s{2,}\S/.test(cur) && items.length) { items[items.length - 1] += ` ${cur.trim()}`; i++; }
        else break;
      }
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|>|```|\$\$|[-*]\s|\d+[.)]\s|---+\s*$)/.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) { para.push(lines[i++].trim()); }
    blocks.push({ type: "p", text: para.join(" ") });
  }
  return blocks;
}

/**
 * Splits inline Markdown into tokens: text, strong, em, code, link and cite. A bare [n] is a citation that points at source n.
 * @returns {Array<{ type: string, text?: string, href?: string, nums?: string[], children?: any[] }>}
 */
export function parseInline(text) {
  const out = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))|(\[\d+(?:[,-]\s*\d+)*\])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    const tok = m[0];
    if (m[1]) out.push({ type: "code", text: tok.slice(1, -1) });
    else if (m[2]) out.push({ type: "strong", children: parseInline(tok.slice(2, -2)) });
    else if (m[3]) out.push({ type: "em", children: parseInline(tok.slice(1, -1)) });
    else if (m[4]) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      out.push({ type: "link", href: lm[2], children: parseInline(lm[1]) });
    } else {
      // [1], [1,2] or [1-3]: a citation. Each number links to its source.
      const nums = tok.slice(1, -1).split(/[,]\s*/);
      out.push({ type: "cite", text: tok, nums });
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** Plain text of a block list, for word counts, search and the "unverified" check. */
export function blockText(blocks) {
  const parts = [];
  for (const b of blocks) {
    if (b.type === "heading" || b.type === "p" || b.type === "math" || b.type === "code") parts.push(b.text);
    else if (b.type === "ul" || b.type === "ol") parts.push(...b.items);
    else if (b.type === "table") parts.push(...b.header, ...b.rows.flat());
    else if (b.type === "callout") parts.push(b.title ?? "", blockText(b.blocks));
  }
  return parts.join(" ").replace(/\*\*|`/g, "");
}

export const wordCountOf = (blocks) => blockText(blocks).split(/\s+/).filter(Boolean).length;

/** Headings for the table of contents. Only second-level headings are listed. */
export const tocOf = (blocks) => blocks.filter((b) => b.type === "heading" && b.level === 2).map((b) => ({ id: b.id, text: b.text }));

/**
 * Links in the body, so a test can check that every one points somewhere that exists.
 * @returns {string[]}
 */
export function linksIn(blocks) {
  const found = [];
  const walkInline = (text) => {
    for (const t of parseInline(text)) {
      if (t.type === "link") found.push(t.href);
      if (t.children) walkInline(t.children.map((c) => c.text ?? "").join(""));
    }
  };
  for (const b of blocks) {
    if (b.type === "p") walkInline(b.text);
    else if (b.type === "ul" || b.type === "ol") b.items.forEach(walkInline);
    else if (b.type === "table") [...b.header, ...b.rows.flat()].forEach(walkInline);
    else if (b.type === "callout") found.push(...linksIn(b.blocks));
  }
  return found;
}

// ---------- A guide, and the publication gate ----------

/**
 * Builds a guide from the text of a .md file.
 * @param {string} slug taken from the file name
 * @param {string} text
 */
export function parseGuide(slug, text) {
  const { data, body } = parseFrontMatter(text);
  const sources = (Array.isArray(data.sources) ? data.sources : []).map((s) => ({
    citation: String(s.citation ?? ""),
    doi: s.doi ? String(s.doi) : undefined,
    url: s.url ? String(s.url) : undefined,
    verified: s.verified === true,
    note: s.note ? String(s.note) : undefined,
  }));
  const blocks = parseMarkdown(body);
  return {
    slug,
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    summary: String(data.summary ?? ""),
    category: String(data.category ?? ""),
    status: String(data.status ?? "draft"),
    author: String(data.author ?? ""),
    reviewedBy: data.reviewedBy ? String(data.reviewedBy) : undefined,
    reviewedOn: data.reviewedOn ? String(data.reviewedOn) : undefined,
    publishedOn: data.publishedOn ? String(data.publishedOn) : undefined,
    updatedOn: String(data.updatedOn ?? ""),
    featured: data.featured === true,
    keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
    tools: Array.isArray(data.tools) ? data.tools.map(String) : [],
    related: Array.isArray(data.related) ? data.related.map(String) : [],
    sources,
    blocks,
    toc: tocOf(blocks),
    words: wordCountOf(blocks),
  };
}

export const readingMinutesOf = (words) => Math.max(1, Math.round(words / 200));

/**
 * Everything that stops a guide being published. An empty list means it can be. This is the single rule: the website uses it to
 * decide what readers see, and the publish command uses it before it changes a file.
 */
export function publishBlockers(g) {
  const out = [];
  if (!g.reviewedBy) out.push("Name the reviewer (reviewedBy).");
  if (!g.reviewedOn || !DATE.test(g.reviewedOn)) out.push("Give the review date (reviewedOn, YYYY-MM-DD).");
  if (!g.publishedOn || !DATE.test(g.publishedOn)) out.push("Give the publication date (publishedOn, YYYY-MM-DD).");
  if (!g.author) out.push("Name the author (author).");
  if (g.sources.length < 3) out.push("List at least three sources.");
  const unverified = g.sources.filter((s) => !s.verified);
  if (unverified.length) out.push(`${unverified.length} source${unverified.length === 1 ? " is" : "s are"} not marked verified. Check each one against the original, then set verified: true.`);
  if (g.blocks && VERIFY_MARKER.test(blockText(g.blocks))) out.push("The text still contains a [VERIFY] marker. Resolve it and remove it.");
  if (g.words < 800) out.push("The guide is under 800 words, which is too short to publish as a guide.");
  return out;
}

/** A guide is visible to readers only when its status is published AND nothing blocks it. Status alone is never enough. */
export const isPublishedGuide = (g) => g.status === "published" && publishBlockers(g).length === 0;

/**
 * Structural problems in a guide file, whatever its status. Used by the tests and by `guides check`.
 * @param {any} g
 * @param {{ toolExists?: (slug: string) => boolean, guideExists?: (slug: string) => boolean }} [ctx]
 */
export function structureProblems(g, ctx = {}) {
  const out = [];
  if (!SLUG.test(g.slug)) out.push("The file name must be a lowercase slug.");
  if (!g.title || g.title.length > 70) out.push("Title is required and at most 70 characters.");
  if (g.description.length < 90 || g.description.length > 160) out.push("Description must be 90 to 160 characters.");
  if (!g.summary) out.push("Summary is required.");
  if (!CATEGORIES.some((c) => c.id === g.category)) out.push(`Unknown category "${g.category}".`);
  if (!STATUSES.includes(g.status)) out.push(`Unknown status "${g.status}".`);
  if (!DATE.test(g.updatedOn)) out.push("updatedOn must be YYYY-MM-DD.");
  if (g.status === "published" && publishBlockers(g).length) out.push("Marked published but blocked: " + publishBlockers(g).join(" "));
  for (const s of g.sources) {
    if (s.citation.length < 30) out.push(`Source too short: ${s.citation}`);
    if (s.verified && !s.doi && !s.url && !s.note) out.push(`Verified source has no DOI, URL or note saying how it was checked: ${s.citation.slice(0, 50)}`);
  }
  if (ctx.toolExists) for (const t of g.tools) if (!ctx.toolExists(t)) out.push(`Unknown tool "${t}".`);
  if (ctx.guideExists) for (const r of g.related) if (!ctx.guideExists(r) || r === g.slug) out.push(`Unknown related guide "${r}".`);
  if (/—/.test(JSON.stringify(g))) out.push("Contains an em dash.");
  return out;
}

// ---------- Editing front matter (used by the publish command) ----------

/** Sets scalar keys in a file's front matter without touching anything else. Keys that do not exist are added before the closing ---. */
export function setFrontMatter(text, updates) {
  const m = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error("Missing front matter.");
  const lines = m[1].split("\n");
  for (const [key, value] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
    const line = value === undefined || value === null ? null : `${key}: ${value}`;
    if (idx >= 0) {
      if (line === null) lines.splice(idx, 1);
      else lines[idx] = line;
    } else if (line !== null) {
      const at = lines.findIndex((l) => l.startsWith("sources:"));
      lines.splice(at >= 0 ? at : lines.length, 0, line);
    }
  }
  return `---\n${lines.join("\n")}\n---\n${m[2]}`;
}

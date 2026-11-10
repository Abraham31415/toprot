// Citation formatting with the established citeproc-js processor and CSL styles. Deterministic: no AI, no credits, no network
// once a style and locale are in hand.
import CSL from "citeproc";
import type { CslItem } from "../refs/convert";

export type StyleMeta = {
  title: string;
  /** "in-text" styles put the citation in the sentence; "note" styles use footnotes. */
  kind: "in-text" | "note";
  defaultLocale: string;
  hasBibliography: boolean;
  /** The style's own format category, such as numeric or author-date, when it declares one. */
  format?: string;
  /** Present for dependent (journal-specific) styles that borrow another style's formatting. */
  parent?: string;
};

export function parseStyleMeta(xml: string): StyleMeta {
  const title = /<info>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/.exec(xml)?.[1]?.trim() ?? "Untitled style";
  const cls = /<style[^>]*\sclass="(in-text|note)"/.exec(xml)?.[1] ?? "in-text";
  const loc = /<style[^>]*\sdefault-locale="([A-Za-z-]+)"/.exec(xml)?.[1] ?? "en-US";
  const format = /<category\s+citation-format="([a-z-]+)"/.exec(xml)?.[1];
  const parent = /<link\s+href="[^"]*\/styles\/([a-z0-9-]+)"\s+rel="independent-parent"/.exec(xml)?.[1] ?? /<link[^>]*rel="independent-parent"[^>]*href="[^"]*\/styles\/([a-z0-9-]+)"/.exec(xml)?.[1];
  return { title: decode(title), kind: cls as StyleMeta["kind"], defaultLocale: loc, hasBibliography: /<bibliography[\s>]/.test(xml), format, parent };
}

const decode = (s: string) => s.replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10))).replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/** Keep only the simple inline markup CSL produces. Everything else is removed, so output is safe to inject into a page. */
export function sanitizeCslHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (m, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!["i", "b", "sup", "sub", "span", "div", "a", "br", "u"].includes(t)) return "";
      if (m.startsWith("</")) return `</${t}>`;
      const cls = /\sclass="([a-zA-Z0-9_\- ]*)"/.exec(attrs)?.[1];
      const style = /\sstyle="((?:font-variant|font-style|font-weight|text-decoration|vertical-align):[^;"]*;?)"/.exec(attrs)?.[1];
      let href = "";
      if (t === "a") { const h = /\shref="(https?:\/\/[^"\s<>]*)"/.exec(attrs)?.[1]; if (h) href = ` href="${h}" rel="noopener noreferrer" target="_blank"`; }
      return `<${t}${cls ? ` class="${cls}"` : ""}${style ? ` style="${style}"` : ""}${href}>`;
    });
}

export const htmlToText = (html: string): string =>
  decode(html.replace(/<\/div>\s*<div/g, "</div> <div").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

export type Locales = Record<string, string>;

export function neededLocales(styleXml: string): string[] {
  const l = parseStyleMeta(styleXml).defaultLocale;
  return [...new Set([l, "en-US"])];
}

export type CitationItem = { id: string; locator?: string; label?: string; prefix?: string };

export type Processor = {
  meta: StyleMeta;
  /** Replace the reference list. Cheap, so a processor can be reused while references change. */
  setItems: (items: CslItem[]) => void;
  /** Process the clusters in document order. Returns one HTML string per cluster. */
  cite: (clusters: CitationItem[][]) => string[];
  bibliography: () => { html: string[]; text: string[] };
};

export function createProcessor(styleXml: string, locales: Locales, items: CslItem[], lang?: string): Processor {
  const meta = parseStyleMeta(styleXml);
  const byId = new Map(items.map((i) => [String(i.id), i]));
  const setItems = (next: CslItem[]) => { byId.clear(); for (const i of next) byId.set(String(i.id), i); };
  const sys = {
    retrieveLocale: (l: string) => locales[l] ?? locales[l.split("-")[0]] ?? locales["en-US"] ?? Object.values(locales)[0],
    retrieveItem: (id: string) => byId.get(id),
  };
  const engine = new CSL.Engine(sys, styleXml, lang ?? meta.defaultLocale);
  return {
    meta,
    setItems,
    cite(clusters) {
      // Start from a clean registry so numbering and disambiguation never leak between renders.
      engine.restoreProcessorState([]);
      const ids = [...new Set(clusters.flat().map((c) => c.id))].filter((id) => byId.has(id));
      engine.updateItems(ids);
      const out: string[] = [];
      const pre: [string, number][] = [];
      clusters.forEach((cluster, i) => {
        const known = cluster.filter((c) => byId.has(c.id));
        const noteIndex = meta.kind === "note" ? i + 1 : 0;
        const citation = {
          citationID: `c${i}`,
          citationItems: known.map((c) => ({ id: c.id, ...(c.locator ? { locator: c.locator, label: c.label ?? "page" } : {}), ...(c.prefix ? { prefix: c.prefix } : {}) })),
          properties: { noteIndex },
        };
        if (!known.length) { out[i] = ""; pre.push([`c${i}`, noteIndex]); return; }
        const [, updates] = engine.processCitationCluster(citation, pre.slice(), []) as [unknown, [number, string, string][]];
        for (const [idx, str] of updates) out[idx] = str;
        pre.push([`c${i}`, noteIndex]);
      });
      return out.map((s) => sanitizeCslHtml(s ?? ""));
    },
    bibliography() {
      const b = engine.makeBibliography();
      if (!b) return { html: [], text: [] };
      const html = (b[1] as string[]).map(sanitizeCslHtml);
      return { html, text: html.map(htmlToText) };
    },
  };
}

// ---- Documents with [@key] citations ----

export type DocResult = {
  html: string;
  text: string;
  bibliographyHtml: string;
  bibliographyText: string;
  /** Keys cited in the text that are not in the reference list. They are left visible so they are not lost. */
  missing: string[];
  /** Keys in the reference list that the text never cites. */
  uncited: string[];
  citationCount: number;
  notes: { n: number; html: string }[];
  meta: StyleMeta;
};

const CITE_RE = /\[((?:[^\[\]@]*@[A-Za-z0-9_:.\-]+[^\[\]]*))\]/g;
const LOCATOR_RE = /^(pp?|chap|sec|vol|fig|para|no)\.?\s*(.+)$/i;
const LABELS: Record<string, string> = { p: "page", pp: "page", chap: "chapter", sec: "section", vol: "volume", fig: "figure", para: "paragraph", no: "issue" };

/** Parse "[see @a, p. 4; @b]" into cluster items. Returns null when the bracket holds no valid citation. */
export function parseCluster(inner: string): CitationItem[] | null {
  const items: CitationItem[] = [];
  for (const part of inner.split(";")) {
    const m = /^\s*(.*?)@([A-Za-z0-9_:.\-]+?)[.:]?\s*(?:,\s*(.+?))?\s*$/.exec(part);
    if (!m) continue;
    const item: CitationItem = { id: m[2] };
    if (m[1].trim()) item.prefix = m[1].trim() + " ";
    if (m[3]) {
      const loc = LOCATOR_RE.exec(m[3].trim());
      if (loc) { item.label = LABELS[loc[1].toLowerCase()]; item.locator = loc[2].trim(); } else { item.locator = m[3].trim(); item.label = "page"; }
    }
    items.push(item);
  }
  return items.length ? items : null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const cache = new Map<string, Processor>();

/**
 * Building a processor parses the whole style, which takes seconds for large styles such as APA or Chicago.
 * Reuse one per style and locale and swap the references in, so editing text stays responsive.
 */
export function getProcessor(key: string, styleXml: string, locales: Locales, items: CslItem[], lang?: string): Processor {
  let p = cache.get(key);
  if (!p) {
    p = createProcessor(styleXml, locales, items, lang);
    if (cache.size >= 6) cache.delete(cache.keys().next().value as string);
    cache.set(key, p);
  } else p.setItems(items);
  return p;
}

export function renderDocument(source: string, items: CslItem[], styleXml: string, locales: Locales, lang?: string, processor?: Processor): DocResult {
  const proc = processor ?? createProcessor(styleXml, locales, items, lang);
  if (processor) processor.setItems(items);
  const known = new Set(items.map((i) => String(i.id)));
  const found: { start: number; end: number; cluster: CitationItem[] }[] = [];
  for (const m of source.matchAll(CITE_RE)) {
    const cluster = parseCluster(m[1]);
    if (cluster) found.push({ start: m.index!, end: m.index! + m[0].length, cluster });
  }
  const rendered = proc.cite(found.map((f) => f.cluster));
  const cited = new Set(found.flatMap((f) => f.cluster.map((c) => c.id)).filter((id) => known.has(id)));
  const missing = [...new Set(found.flatMap((f) => f.cluster.map((c) => c.id)).filter((id) => !known.has(id)))];
  const isNote = proc.meta.kind === "note";
  const notes: DocResult["notes"] = [];
  let html = "", text = "", at = 0, n = 0;
  found.forEach((f, i) => {
    const before = source.slice(at, f.start);
    html += esc(before); text += before;
    const markup = rendered[i];
    const stillMissing = f.cluster.filter((c) => !known.has(c.id)).map((c) => c.id);
    if (isNote && markup) { n++; notes.push({ n, html: markup }); html += `<sup class="cite-note">${n}</sup>`; text += `[${n}]`; }
    else if (markup) { html += `<span class="cite">${markup}</span>`; text += htmlToText(markup); }
    if (stillMissing.length) { html += `<span class="cite-missing">[missing: ${esc(stillMissing.join(", "))}]</span>`; text += `[missing: ${stillMissing.join(", ")}]`; }
    at = f.end;
  });
  html += esc(source.slice(at)); text += source.slice(at);
  const bib = proc.bibliography();
  return {
    html: html.replace(/\n/g, "<br>"),
    text,
    bibliographyHtml: bib.html.join("\n"),
    bibliographyText: bib.text.join("\n"),
    missing,
    uncited: [...known].filter((k) => !cited.has(k)),
    citationCount: found.length,
    notes,
    meta: proc.meta,
  };
}

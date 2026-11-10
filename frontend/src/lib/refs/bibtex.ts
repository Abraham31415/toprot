import { normalizePages, parsePersonName, sanitizeRef, type Person, type Ref, type RefType } from "./model";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const TYPE_IN: Record<string, RefType> = {
  article: "article-journal", book: "book", incollection: "chapter", inbook: "chapter", inproceedings: "paper-conference", conference: "paper-conference",
  techreport: "report", report: "report", phdthesis: "thesis", mastersthesis: "thesis", thesis: "thesis", online: "webpage", electronic: "webpage", misc: "other", unpublished: "other",
};
const TYPE_OUT: Record<RefType, string> = { "article-journal": "article", book: "book", chapter: "incollection", report: "techreport", thesis: "phdthesis", "paper-conference": "inproceedings", webpage: "misc", article: "misc", other: "misc" };

const ACCENT: Record<string, Record<string, string>> = {
  "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", c: "ć", n: "ń", s: "ś", z: "ź" },
  "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È", I: "Ì", O: "Ò", U: "Ù" },
  "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê", I: "Î", O: "Ô", U: "Û" },
  '"': { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", y: "ÿ", A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü" },
  "~": { a: "ã", n: "ñ", o: "õ", A: "Ã", N: "Ñ", O: "Õ" },
  c: { c: "ç", C: "Ç", s: "ş", S: "Ş" },
  v: { c: "č", s: "š", z: "ž", e: "ě", r: "ř", n: "ň", C: "Č", S: "Š", Z: "Ž" },
  r: { a: "å", A: "Å", u: "ů" },
  "=": { a: "ā", e: "ē", i: "ī", o: "ō", u: "ū" },
};
const COMMANDS: Record<string, string> = { ss: "ß", o: "ø", O: "Ø", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", l: "ł", L: "Ł", i: "ı", j: "ȷ" };

/** Convert the common LaTeX escapes found in BibTeX fields to plain Unicode text. */
export function unlatex(s: string): string {
  let t = s;
  t = t.replace(/\\([`'^"~=])\s*\{?\\?([A-Za-z])\}?/g, (m, a: string, ch: string) => ACCENT[a]?.[ch] ?? ch);
  t = t.replace(/\\([cvr])\s*\{([A-Za-z])\}|\\([cvr])\s+([A-Za-z])/g, (m, a1: string, c1: string, a2: string, c2: string) => ACCENT[a1 ?? a2]?.[c1 ?? c2] ?? (c1 ?? c2));
  t = t.replace(/\\(ss|oe|OE|ae|AE|aa|AA|o|O|l|L|i|j)(?![A-Za-z])\s*/g, (m, c: string) => COMMANDS[c] ?? "");
  t = t.replace(/\\([&%_$#])/g, "$1");
  t = t.replace(/---/g, "—").replace(/--/g, "–").replace(/~/g, " ");
  t = t.replace(/\\[A-Za-z]+\s*/g, "");
  t = t.replace(/[{}]/g, "");
  return t.replace(/\s+/g, " ").trim();
}

type Fields = Record<string, string>;

/** Read one balanced {..} or "..".. value starting at i. Returns [value, nextIndex]. */
function readDelimited(src: string, i: number): [string, number] {
  const open = src[i];
  if (open === "{") {
    let depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === "\\") { j++; continue; }
      if (src[j] === "{") depth++;
      else if (src[j] === "}") { depth--; if (depth === 0) break; }
    }
    return [src.slice(i + 1, j), j + 1];
  }
  let depth = 0, j = i + 1;
  for (; j < src.length; j++) {
    if (src[j] === "\\") { j++; continue; }
    if (src[j] === "{") depth++;
    else if (src[j] === "}") depth--;
    else if (src[j] === '"' && depth === 0) break;
  }
  return [src.slice(i + 1, j), j + 1];
}

export function parseBibtex(text: string): { refs: Ref[]; warnings: string[] } {
  const src = text.replace(/^\uFEFF/, "");
  const refs: Ref[] = [];
  const warnings: string[] = [];
  const macros: Record<string, string> = Object.fromEntries(MONTHS.map((m, i) => [m, String(i + 1)]));
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf("@", i);
    if (at < 0) break;
    const head = /^@\s*([A-Za-z]+)\s*([({])/.exec(src.slice(at, at + 40));
    if (!head) { i = at + 1; continue; }
    const type = head[1].toLowerCase();
    let p = at + head[0].length;
    const closer = head[2] === "(" ? ")" : "}";
    if (type === "comment" || type === "preamble") {
      // Skip to the matching closer.
      let depth = 1;
      for (; p < src.length && depth > 0; p++) { if (src[p] === head[2]) depth++; else if (src[p] === closer) depth--; }
      i = p; continue;
    }
    // Citation key. For @string the "key" is really the first macro name, so leave it for the field reader.
    let key = "";
    if (type !== "string") {
      let keyEnd = p;
      while (keyEnd < src.length && src[keyEnd] !== "," && src[keyEnd] !== "=" && src[keyEnd] !== closer) keyEnd++;
      key = src.slice(p, keyEnd).trim();
      p = keyEnd + (src[keyEnd] === "," ? 1 : 0);
    }
    const fields: Fields = {};
    while (p < src.length) {
      while (p < src.length && /[\s,]/.test(src[p])) p++;
      if (src[p] === closer) { p++; break; }
      const nm = /^[A-Za-z][A-Za-z0-9_:-]*/.exec(src.slice(p, p + 60));
      if (!nm) { p++; continue; }
      const name = nm[0].toLowerCase();
      p += nm[0].length;
      while (p < src.length && /\s/.test(src[p])) p++;
      if (src[p] !== "=") continue;
      p++;
      let value = "";
      for (;;) {
        while (p < src.length && /\s/.test(src[p])) p++;
        if (src[p] === "{" || src[p] === '"') { const [v, n] = readDelimited(src, p); value += v; p = n; }
        else { const t = /^[A-Za-z0-9_:.-]+/.exec(src.slice(p, p + 60)); if (t) { value += macros[t[0].toLowerCase()] ?? t[0]; p += t[0].length; } }
        while (p < src.length && /\s/.test(src[p])) p++;
        if (src[p] === "#") { p++; continue; }
        break;
      }
      fields[name] = value;
    }
    if (type === "string") {
      for (const [k, v] of Object.entries(fields)) macros[k] = unlatex(v);
      i = p; continue;
    }
    i = p;
    const ref = fromFields(type, fields);
    if (ref) refs.push(ref); else warnings.push(`Skipped entry "${key || type}": it has no title.`);
  }
  return { refs, warnings };
}

function splitNames(raw: string): Person[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (let k = 0; k < raw.length; k++) {
    const c = raw[k];
    if (c === "{") depth++; else if (c === "}") depth--;
    if (depth === 0 && /^ and /i.test(raw.slice(k, k + 5))) { parts.push(cur); cur = ""; k += 4; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => {
    if (/^\{[^{}]*\}$/.test(p)) return { literal: unlatex(p) };
    return parsePersonName(unlatex(p));
  });
}

function fromFields(type: string, f: Fields): Ref | null {
  const get = (...k: string[]) => { for (const n of k) if (f[n] && f[n].trim()) return unlatex(f[n]); return undefined; };
  const title = get("title");
  if (!title) return null;
  const date = get("date");
  const ym = /^(\d{4})(?:-(\d{1,2}))?/.exec(date ?? "");
  const year = get("year") ? parseInt(get("year")!, 10) : ym ? parseInt(ym[1], 10) : undefined;
  const mRaw = get("month")?.toLowerCase();
  const month = mRaw ? (/^\d{1,2}$/.test(mRaw) ? parseInt(mRaw, 10) : MONTHS.indexOf(mRaw.slice(0, 3)) >= 0 ? MONTHS.indexOf(mRaw.slice(0, 3)) + 1 : MONTH_NAMES.indexOf(mRaw) + 1 || undefined) : ym?.[2] ? parseInt(ym[2], 10) : undefined;
  const t = TYPE_IN[type] ?? "other";
  const ref: Ref = {
    type: t, title,
    authors: f.author ? splitNames(f.author) : [],
    editors: f.editor ? splitNames(f.editor) : undefined,
    journal: get("journal", "journaltitle"),
    containerTitle: get("booktitle"),
    year: Number.isFinite(year) ? year : undefined, month,
    volume: get("volume"), issue: get("number", "issue"), pages: get("pages"),
    publisher: get("publisher", "organization", "institution"),
    doi: get("doi"), pmid: get("pmid"), url: get("url"), abstract: get("abstract"),
    keywords: get("keywords", "keyword")?.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
    issn: get("issn"), language: get("language", "langid"), notes: get("note", "annote"),
  };
  if (!ref.editors?.length) delete ref.editors;
  return sanitizeRef(ref);
}

const asciiKey = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "");
const STOP = new Set(["a", "an", "the", "of", "on", "in", "for", "and", "to", "with", "from", "by"]);

export function citationKey(r: Ref, taken: Set<string>): string {
  const fam = asciiKey(r.authors[0]?.family ?? r.authors[0]?.literal ?? "anon").toLowerCase() || "anon";
  const word = asciiKey(r.title.split(/\s+/).find((w) => !STOP.has(w.toLowerCase()) && asciiKey(w)) ?? "").toLowerCase();
  const base = `${fam}${r.year ?? ""}${word}`;
  let k = base, n = 2;
  while (taken.has(k)) k = `${base}${String.fromCharCode(96 + n++)}`;
  taken.add(k);
  return k;
}

const esc = (s: string) => s.replace(/\\/g, "\\textbackslash{}").replace(/([&%_$#])/g, "\\$1");

export function writeBibtex(refs: Ref[]): string {
  const taken = new Set<string>();
  return refs.map((r) => {
    const f: [string, string | undefined][] = [
      ["author", r.authors.length ? r.authors.map((a) => (a.literal ? `{${esc(a.literal)}}` : [a.family, a.given].filter(Boolean).map((x) => esc(x!)).join(", "))).join(" and ") : undefined],
      ["editor", r.editors?.length ? r.editors.map((a) => (a.literal ? `{${esc(a.literal)}}` : [a.family, a.given].filter(Boolean).map((x) => esc(x!)).join(", "))).join(" and ") : undefined],
      ["title", esc(r.title)],
      [r.type === "article-journal" ? "journal" : "booktitle", r.type === "article-journal" || r.type === "article" ? (r.journal ? esc(r.journal) : undefined) : r.containerTitle ? esc(r.containerTitle) : undefined],
      ["year", r.year?.toString()],
      ["month", r.month ? MONTHS[r.month - 1] : undefined],
      ["volume", r.volume], ["number", r.issue],
      ["pages", r.pages ? normalizePages(r.pages)!.replace("–", "--") : undefined],
      ["publisher", r.publisher ? esc(r.publisher) : undefined],
      ["doi", r.doi], ["pmid", r.pmid], ["url", r.url],
      ["issn", r.issn], ["language", r.language],
      ["keywords", r.keywords?.length ? r.keywords.map(esc).join(", ") : undefined],
      ["abstract", r.abstract ? esc(r.abstract) : undefined],
      ["note", r.notes ? esc(r.notes) : undefined],
    ];
    const body = f.filter(([, v]) => v).map(([k, v]) => (k === "month" ? `  month = ${v}` : `  ${k} = {${v}}`)).join(",\n");
    return `@${TYPE_OUT[r.type]}{${citationKey(r, taken)},\n${body}\n}`;
  }).join("\n\n") + "\n";
}

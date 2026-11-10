import index from "./style-index.json";
import { parseStyleMeta } from "./engine";
import { isLocaleId, isStyleId } from "./styles";

const STYLES_RAW = "https://raw.githubusercontent.com/citation-style-language/styles/master";
const LOCALES_RAW = "https://raw.githubusercontent.com/citation-style-language/locales/master";
const MAX_BYTES = 600_000;

type IndexRow = [string, string, number, string];
const ROWS = (index as unknown as { styles: IndexRow[] }).styles;
const DEPENDENT = new Set(ROWS.filter((r) => r[2]).map((r) => r[0]));
export const STYLE_INDEX_INFO = { generated: (index as { generated: string }).generated, count: ROWS.length, independent: ROWS.filter((r) => !r[2]).length };

export type StyleHit = { id: string; title: string; dependent: boolean; format: string };

/** Search the official style list by title or id. Every word must match. Exact and prefix matches rank first. */
export function searchStyles(query: string, limit = 30): StyleHit[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  const scored: [number, IndexRow][] = [];
  for (const r of ROWS) {
    const hay = `${r[1]} ${r[0]}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    let score = 0;
    if (r[0] === words.join("-")) score += 100;
    if (r[1].toLowerCase().startsWith(words[0])) score += 20;
    if (!r[2]) score += 10;
    score -= r[1].length / 100;
    scored.push([score, r]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, r]) => ({ id: r[0], title: r[1], dependent: !!r[2], format: r[3] }));
}

export class CslFetchError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

async function fetchText(url: string, f: typeof fetch): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await f(url, { signal: ctl.signal, headers: { "User-Agent": "ToProt/1.0 (https://toprot.vercel.app)" } });
    if (res.status === 404) throw new CslFetchError("That style or locale does not exist in the official repository.", 404);
    if (!res.ok) throw new CslFetchError(`The style repository returned an error (${res.status}).`, 502);
    const len = parseInt(res.headers.get("content-length") ?? "0", 10);
    if (len > MAX_BYTES) throw new CslFetchError("That style file is too large.", 413);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new CslFetchError("That style file is too large.", 413);
    return text;
  } catch (e) {
    if (e instanceof CslFetchError) throw e;
    throw new CslFetchError("Could not reach the style repository.", 504);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch an official style. A dependent (journal-specific) style borrows its parent's formatting, so the parent is returned. */
/**
 * Independent styles live at the top of the official repository and dependent (journal-specific) styles in its
 * dependent/ folder. The bundled index says which a style is; if the first location has no such file, try the other.
 */
async function fetchStyleFile(id: string, f: typeof fetch): Promise<string> {
  const paths = DEPENDENT.has(id) ? [`dependent/${id}.csl`, `${id}.csl`] : [`${id}.csl`, `dependent/${id}.csl`];
  try {
    return await fetchText(`${STYLES_RAW}/${paths[0]}`, f);
  } catch (e) {
    if (e instanceof CslFetchError && e.status === 404) return fetchText(`${STYLES_RAW}/${paths[1]}`, f);
    throw e;
  }
}

export async function fetchOfficialStyle(id: string, f: typeof fetch = fetch): Promise<{ id: string; title: string; xml: string; parent?: string }> {
  if (!isStyleId(id)) throw new CslFetchError("That is not a valid style name.", 400);
  const xml = await fetchStyleFile(id, f);
  if (!/<style[\s>]/.test(xml) || !/<info>/.test(xml)) throw new CslFetchError("That file is not a CSL style.", 502);
  const meta = parseStyleMeta(xml);
  if (!meta.parent) return { id, title: meta.title, xml };
  if (!isStyleId(meta.parent)) throw new CslFetchError("That style points to an invalid parent.", 502);
  const parentXml = await fetchStyleFile(meta.parent, f);
  if (!/<style[\s>]/.test(parentXml) || /rel="independent-parent"/.test(parentXml)) throw new CslFetchError("The parent style could not be used.", 502);
  return { id, title: meta.title, xml: parentXml, parent: meta.parent };
}

export async function fetchLocale(lang: string, f: typeof fetch = fetch): Promise<string> {
  if (!isLocaleId(lang)) throw new CslFetchError("That is not a valid locale.", 400);
  const xml = await fetchText(`${LOCALES_RAW}/locales-${lang}.xml`, f);
  if (!/<locale[\s>]/.test(xml)) throw new CslFetchError("That file is not a CSL locale.", 502);
  return xml;
}

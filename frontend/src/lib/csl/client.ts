import { neededLocales, parseStyleMeta, type Locales } from "./engine";
import { BUNDLED_LOCALES, isBundledStyle } from "./styles";

export type LoadedStyle = { id: string; xml: string; title: string; parent?: string; locales: Locales };

const cache = new Map<string, LoadedStyle>();

/** Load a style (bundled, or any official style through the site's cached route) together with the locales it needs. */
export async function loadStyle(id: string, f: typeof fetch = fetch): Promise<LoadedStyle> {
  const hit = cache.get(id);
  if (hit) return hit;
  let xml: string, title: string, parent: string | undefined;
  if (isBundledStyle(id)) {
    const res = await f(`/csl/styles/${id}.csl`);
    if (!res.ok) throw new Error("Could not load that style.");
    xml = await res.text();
    title = parseStyleMeta(xml).title;
  } else {
    const res = await f(`/api/csl/style?id=${encodeURIComponent(id)}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error ?? "Could not load that style.");
    ({ xml, title, parent } = d as { xml: string; title: string; parent?: string });
  }
  const locales: Locales = {};
  for (const l of neededLocales(xml)) {
    const url = BUNDLED_LOCALES.includes(l) ? `/csl/locales/locales-${l}.xml` : `/api/csl/locale?lang=${encodeURIComponent(l)}`;
    try {
      const r = await f(url);
      if (r.ok) locales[l] = BUNDLED_LOCALES.includes(l) ? await r.text() : ((await r.json()) as { xml: string }).xml;
    } catch { /* fall back to en-US below */ }
  }
  if (!locales["en-US"]) {
    const r = await f("/csl/locales/locales-en-US.xml");
    if (r.ok) locales["en-US"] = await r.text();
  }
  const loaded = { id, xml, title, parent, locales };
  cache.set(id, loaded);
  return loaded;
}

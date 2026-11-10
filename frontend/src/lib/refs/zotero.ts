import { normalizeDoi, sanitizeRef, type Ref, type RefType } from "./model";

// Zotero's Web API v3 (https://www.zotero.org/support/dev/web_api/v3/start). The user creates a read-only private key at
// zotero.org/settings/keys and pastes it here. Requests go from the user's browser straight to api.zotero.org (which allows
// that with CORS), so the key never reaches ToProt's servers and is not stored.

const API = "https://api.zotero.org";

const TYPE_IN: Record<string, RefType> = {
  journalArticle: "article-journal", magazineArticle: "article-journal", newspaperArticle: "article", preprint: "article", book: "book", bookSection: "chapter",
  report: "report", thesis: "thesis", conferencePaper: "paper-conference", webpage: "webpage", document: "other",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export type ZoteroData = {
  itemType?: string; title?: string; creators?: { creatorType?: string; firstName?: string; lastName?: string; name?: string }[];
  publicationTitle?: string; bookTitle?: string; proceedingsTitle?: string; volume?: string; issue?: string; pages?: string; date?: string; DOI?: string; url?: string;
  abstractNote?: string; ISSN?: string; language?: string; publisher?: string; institution?: string; university?: string; extra?: string; tags?: { tag?: string }[]; shortTitle?: string;
};

export type ZoteroImport = { ref: Ref; tags: string[] };

/** A Zotero item as a reference. Returns null for attachments, notes and items without a title. */
export function zoteroToRef(d: ZoteroData): ZoteroImport | null {
  const type = d.itemType ? TYPE_IN[d.itemType] : undefined;
  if (d.itemType === "attachment" || d.itemType === "note" || d.itemType === "annotation") return null;
  const title = (d.title ?? "").trim();
  if (!title) return null;
  const ym = /(\d{4})/.exec(d.date ?? "");
  const mm = /^\d{4}-(\d{1,2})/.exec(d.date ?? "")?.[1] ?? (() => { const i = MONTHS.indexOf((/\b([A-Za-z]{3})[a-z]*\b/.exec(d.date ?? "")?.[1] ?? "").toLowerCase()); return i >= 0 ? String(i + 1) : undefined; })();
  const person = (c: NonNullable<ZoteroData["creators"]>[number]) => (c.name ? { literal: c.name.trim() } : { family: (c.lastName ?? "").trim(), ...(c.firstName?.trim() ? { given: c.firstName.trim() } : {}) });
  const people = (kind: string) => (d.creators ?? []).filter((c) => (c.creatorType ?? "author") === kind).map(person).filter((p) => ("family" in p && p.family) || ("literal" in p && p.literal));
  const extra = d.extra ?? "";
  const pmid = /^PMID:\s*(\d+)\s*$/im.exec(extra)?.[1];
  const ref: Ref = {
    type: type ?? "other", title, authors: people("author"), editors: people("editor").length ? people("editor") : undefined,
    journal: type === "article-journal" || type === "article" ? d.publicationTitle : undefined,
    containerTitle: type === "chapter" ? d.bookTitle : type === "paper-conference" ? d.proceedingsTitle ?? d.publicationTitle : undefined,
    year: ym ? parseInt(ym[1], 10) : undefined, month: mm ? parseInt(mm, 10) : undefined,
    volume: d.volume || undefined, issue: d.issue || undefined, pages: d.pages || undefined,
    publisher: d.publisher || d.institution || d.university || undefined,
    doi: normalizeDoi(d.DOI), pmid, url: d.url || undefined, abstract: d.abstractNote || undefined, issn: d.ISSN || undefined, language: d.language || undefined,
  };
  if (!ref.editors) delete ref.editors;
  return { ref: sanitizeRef(ref), tags: (d.tags ?? []).map((t) => (t.tag ?? "").trim()).filter(Boolean).slice(0, 30) };
}

export class ZoteroError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

export type ZoteroSource = { kind: "user" | "group"; id: string; apiKey: string; collectionKey?: string };

export const isZoteroKey = (k: string) => /^[A-Za-z0-9]{16,40}$/.test(k);
export const isZoteroId = (k: string) => /^\d{1,12}$/.test(k);
const isCollectionKey = (k: string) => /^[A-Z0-9]{8}$/.test(k);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read items from a Zotero library or collection. Respects the API's Backoff header, stops with a clear message on rate limits,
 * and reads at most `max` items. The key is sent only to api.zotero.org.
 */
export async function fetchZoteroItems(src: ZoteroSource, opts: { f?: typeof fetch; max?: number; pageSize?: number; wait?: (ms: number) => Promise<void> } = {}): Promise<{ items: ZoteroImport[]; total: number; skipped: number }> {
  const f = opts.f ?? fetch, max = opts.max ?? 500, pageSize = Math.min(100, opts.pageSize ?? 100), wait = opts.wait ?? sleep;
  if (!isZoteroId(src.id)) throw new ZoteroError("The Zotero user or group ID must be a number (find it at zotero.org/settings/keys).");
  if (!isZoteroKey(src.apiKey)) throw new ZoteroError("That does not look like a Zotero API key. Create one at zotero.org/settings/keys with read access.");
  if (src.collectionKey && !isCollectionKey(src.collectionKey)) throw new ZoteroError("The collection key should be 8 letters and digits.");
  const base = `${API}/${src.kind === "group" ? "groups" : "users"}/${src.id}${src.collectionKey ? `/collections/${src.collectionKey}` : ""}/items`;
  const items: ZoteroImport[] = [];
  let start = 0, total = 0, skipped = 0;
  for (;;) {
    const url = `${base}?format=json&itemType=${encodeURIComponent("-attachment || note")}&limit=${pageSize}&start=${start}`;
    const res = await f(url, { headers: { "Zotero-API-Key": src.apiKey, "Zotero-API-Version": "3" } }).catch(() => { throw new ZoteroError("Could not reach Zotero. Check your connection."); });
    if (res.status === 403) throw new ZoteroError("Zotero refused the key. Check that it is correct and has read access to this library.", 403);
    if (res.status === 404) throw new ZoteroError("Zotero could not find that user, group or collection.", 404);
    if (res.status === 429) throw new ZoteroError(`Zotero is limiting requests. Try again in ${res.headers.get("Retry-After") ?? "a minute"} seconds.`, 429);
    if (!res.ok) throw new ZoteroError(`Zotero returned an error (${res.status}).`, res.status);
    total = parseInt(res.headers.get("Total-Results") ?? "0", 10) || total;
    let page: { data?: ZoteroData }[];
    try { page = await res.json(); } catch { throw new ZoteroError("Zotero returned something unreadable."); }
    for (const it of page) { const r = it.data ? zoteroToRef(it.data) : null; if (r) items.push(r); else skipped++; }
    start += page.length;
    if (!page.length || start >= total || items.length >= max) break;
    const backoff = parseInt(res.headers.get("Backoff") ?? "", 10);
    await wait(Number.isFinite(backoff) ? backoff * 1000 : 300);
  }
  return { items: items.slice(0, max), total, skipped };
}

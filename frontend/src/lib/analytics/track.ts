import { createHash } from "node:crypto";

// First-party, cookie-free page tracking. What is kept: the page (with ids removed), the referring site's name, campaign tags, the
// country the hosting platform reports, a device category, and a visitor code that changes every day. What is never kept: the address,
// the browser string, query strings other than the campaign tags, search terms, or anything typed by the person.

export const MAX_PATH = 120;

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{20,}|\d{5,})$/i;

/** The page as it should be counted: no query, no fragment, and ids replaced so /studies/<uuid>/protocol counts as one page. */
export function normalizePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  const path = raw.split(/[?#]/)[0].slice(0, 300);
  if (/^\/(?:admin|api|_next|auth|logout|suspended)(?:\/|$)/.test(path)) return null;
  const out = path.split("/").map((seg) => (ID_SEGMENT.test(seg) ? ":id" : seg)).join("/").replace(/\/+$/, "") || "/";
  return out.slice(0, MAX_PATH);
}

/** The site name of a referrer ("https://www.google.com/search?q=x" gives "google.com"). Referrers from ToProt itself are ignored. */
export function referrerHost(raw: unknown, ownHost: string): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    const own = ownHost.toLowerCase().replace(/^www\./, "").split(":")[0];
    return !host || host === own || host === "localhost" ? null : host.slice(0, 80);
  } catch { return null; }
}

export type Utm = { source: string | null; medium: string | null; campaign: string | null };
const UTM_OK = /^[A-Za-z0-9 _.\-+%]{1,60}$/;
/** Campaign tags from a query string. Anything that is not a short plain label is dropped. */
export function parseUtm(search: unknown): Utm {
  const p = new URLSearchParams(typeof search === "string" ? search.slice(0, 600) : "");
  const get = (k: string) => { const v = p.get(k)?.trim(); return v && UTM_OK.test(v) ? v.toLowerCase().slice(0, 60) : null; };
  return { source: get("utm_source"), medium: get("utm_medium"), campaign: get("utm_campaign") };
}

export type Device = "desktop" | "mobile" | "tablet" | "other";
export function deviceFromUserAgent(ua: string | null | undefined): Device {
  if (!ua) return "other";
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return "mobile";
  if (/windows|macintosh|x11|linux|cros/i.test(ua)) return "desktop";
  return "other";
}

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|node-fetch|axios|go-http-client|vercel/i;
export const isBot = (ua: string | null | undefined): boolean => !ua || BOT.test(ua);

/** A code for "this visitor today". It cannot be reversed to an address and it differs every day, so it never follows a person. */
export function visitorCode(ip: string, ua: string, salt: string, day: string): string {
  return createHash("sha256").update(`${salt}|${day}|${ip}|${ua}`).digest("hex").slice(0, 24);
}

/** Do Not Track or Global Privacy Control: either one switches tracking off for that request. */
export const optedOut = (h: { get(name: string): string | null }): boolean => h.get("dnt") === "1" || h.get("sec-gpc") === "1";

export const EVENTS = ["page_view", "calculator_completed", "literature_search"] as const;
export type BrowserEvent = (typeof EVENTS)[number];
/** Only a short tool name is accepted as a property of a calculator event. */
export const toolName = (raw: unknown): string | null => (typeof raw === "string" && /^[a-z0-9-]{2,60}$/.test(raw) ? raw : null);

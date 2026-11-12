import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { limitRequest, clientKey } from "@/lib/rate-limit";
import { EVENTS, deviceFromUserAgent, isBot, normalizePath, optedOut, parseUtm, referrerHost, toolName, visitorCode } from "@/lib/analytics/track";

// Receives the small page-view and calculator events sent by the browser. Public by design, so it is strict: a short JSON body, a
// fixed list of event names, a rate limit per address, and bots, Do Not Track and Global Privacy Control are ignored. It answers 204
// whatever happens, so tracking can never slow down or break a page.

export const dynamic = "force-dynamic";
const OK = () => new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
const Body = z.object({ e: z.enum(EVENTS), p: z.string().max(400), r: z.string().max(400).optional(), q: z.string().max(600).optional(), t: z.string().max(80).optional() });

export async function POST(req: Request) {
  try {
    if (limitRequest(req, "events", { limit: 120, windowMs: 60_000 })) return OK();
    if (optedOut(req.headers)) return OK();
    const ua = req.headers.get("user-agent");
    if (isBot(ua)) return OK();
    const raw = await req.text();
    if (raw.length > 2000) return OK();
    const parsed = Body.safeParse(JSON.parse(raw));
    if (!parsed.success) return OK();
    const { e, p, r, q, t } = parsed.data;
    const path = normalizePath(p);
    if (!path) return OK();

    const day = new Date().toISOString().slice(0, 10);
    const salt = process.env.ANALYTICS_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(-24) || "toprot";
    const host = req.headers.get("host") ?? "";
    const utm = parseUtm(q);
    const cookie = req.headers.get("cookie") ?? "";
    const row = {
      event: e,
      path,
      visitor: visitorCode(clientKey(req), ua ?? "", salt, day),
      authenticated: /(?:^|;\s*)sb-[^=]+-auth-token/.test(cookie),
      referrer_host: referrerHost(r, host),
      utm_source: utm.source, utm_medium: utm.medium, utm_campaign: utm.campaign,
      country: (req.headers.get("x-vercel-ip-country") ?? "").slice(0, 2).toUpperCase() || null,
      device: deviceFromUserAgent(ua),
      props: e === "calculator_completed" && toolName(t) ? { tool: toolName(t) } : {},
    };
    if (e === "calculator_completed" && !toolName(t)) return OK();
    await createAdminClient().from("product_events").insert(row);

    // Remember the first campaign for 30 days, so a later registration can be credited to it. HttpOnly: scripts cannot read it.
    const res = OK();
    const hasTag = utm.source || utm.campaign || row.referrer_host;
    if (e === "page_view" && hasTag && !/(?:^|;\s*)tp_attr=/.test(cookie)) {
      res.cookies.set("tp_attr", JSON.stringify({ s: utm.source, m: utm.medium, c: utm.campaign, r: row.referrer_host }), { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 30 * 86400 });
    }
    return res;
  } catch {
    return OK();
  }
}

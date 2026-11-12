import { limitRequest } from "@/lib/rate-limit";
import { NextResponse, type NextRequest } from "next/server";
import { CslFetchError, fetchLocale } from "@/lib/csl/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limited = limitRequest(req, "csl-locale", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const lang = req.nextUrl.searchParams.get("lang") ?? "";
  try {
    return NextResponse.json({ lang, xml: await fetchLocale(lang) }, { headers: { "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000" } });
  } catch (e) {
    const status = e instanceof CslFetchError ? e.status : 500;
    return NextResponse.json({ error: e instanceof CslFetchError ? e.message : "Could not load that locale." }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

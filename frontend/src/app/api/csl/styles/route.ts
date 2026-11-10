import { NextResponse, type NextRequest } from "next/server";
import { STYLE_INDEX_INFO, searchStyles } from "@/lib/csl/server";

export const runtime = "nodejs";

/** Search the official CSL style list. The list is bundled, so this makes no outside request. */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  return NextResponse.json({ styles: searchStyles(q), index: STYLE_INDEX_INFO }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}

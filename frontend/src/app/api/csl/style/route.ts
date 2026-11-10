import { NextResponse, type NextRequest } from "next/server";
import { CslFetchError, fetchOfficialStyle } from "@/lib/csl/server";

export const runtime = "nodejs";

/** One style from the official CSL repository. Dependent styles are returned with their parent's formatting. Cached for a day. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  try {
    const style = await fetchOfficialStyle(id);
    return NextResponse.json(style, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch (e) {
    const status = e instanceof CslFetchError ? e.status : 500;
    return NextResponse.json({ error: e instanceof CslFetchError ? e.message : "Could not load that style." }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

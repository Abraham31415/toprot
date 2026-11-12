import { limitRequest } from "@/lib/rate-limit";
import { NextResponse, type NextRequest } from "next/server";
import { LiteratureError, SOURCE_INFO, type LitSource, type SearchParams, type SortKey } from "@/lib/literature/types";
import { searchLiterature } from "@/lib/literature/search";

export const runtime = "nodejs";

const text = (v: string | null, max = 200) => (v ? v.slice(0, max) : undefined);
const num = (v: string | null) => { const n = v ? parseInt(v, 10) : NaN; return Number.isFinite(n) ? n : undefined; };

/** Public metadata search. Successful responses are cached at the edge so repeat searches do not use up the sources' request limits. */
export async function GET(req: NextRequest) {
  const limited = limitRequest(req, "lit-search", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const s = req.nextUrl.searchParams;
  const source = (s.get("source") ?? "openalex") as LitSource;
  if (!(source in SOURCE_INFO)) return NextResponse.json({ error: "Unknown source." }, { status: 400 });
  const sort = s.get("sort");
  const params: SearchParams = {
    source, keywords: text(s.get("keywords")), title: text(s.get("title")), author: text(s.get("author")), journal: text(s.get("journal")), doi: text(s.get("doi")),
    yearFrom: num(s.get("yearFrom")), yearTo: num(s.get("yearTo")), openAccess: s.get("openAccess") === "1", articleType: text(s.get("articleType"), 40), studyType: text(s.get("studyType"), 60),
    sort: sort === "cited" || sort === "newest" ? (sort as SortKey) : "relevance", page: num(s.get("page")), pageSize: num(s.get("pageSize")),
  };
  try {
    const result = await searchLiterature(params);
    return NextResponse.json(result, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } });
  } catch (e) {
    if (e instanceof LiteratureError) {
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      if (e.retryAfter) headers["Retry-After"] = String(e.retryAfter);
      return NextResponse.json({ error: e.message, retryAfter: e.retryAfter }, { status: e.status, headers });
    }
    return NextResponse.json({ error: "The search failed. Try again." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

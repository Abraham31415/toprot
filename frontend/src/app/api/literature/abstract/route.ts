import { limitRequest } from "@/lib/rate-limit";
import { NextResponse, type NextRequest } from "next/server";
import { LiteratureError } from "@/lib/literature/types";
import { fetchPubmedAbstract } from "@/lib/literature/search";

export const runtime = "nodejs";

/** The abstract of one PubMed record, fetched only when the user opens it. */
export async function GET(req: NextRequest) {
  const limited = limitRequest(req, "lit-abstract", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const pmid = req.nextUrl.searchParams.get("pmid") ?? "";
  try {
    const abstract = await fetchPubmedAbstract(pmid);
    return NextResponse.json({ abstract: abstract ?? null }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch (e) {
    if (e instanceof LiteratureError) return NextResponse.json({ error: e.message }, { status: e.status, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "Could not load the abstract." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

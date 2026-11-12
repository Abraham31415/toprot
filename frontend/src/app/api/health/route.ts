import { NextResponse } from "next/server";
import { limitRequest } from "@/lib/rate-limit";

// Public status check. It answers "is it up", never why: no environment variable names, error text or response bodies from
// other services are returned, because anyone can call this address. Details for operators go to the server logs.

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const isTimeout = (err: unknown) => err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");

async function checkSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error(JSON.stringify({ evt: "health_misconfigured", service: "supabase" }));
    return { ok: false, detail: "Not configured" };
  }
  try {
    const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, detail: `Responded with HTTP ${res.status}` };
    return { ok: true, detail: "Reachable" };
  } catch (err) {
    console.error(JSON.stringify({ evt: "health_unreachable", service: "supabase", err: err instanceof Error ? err.name : "unknown" }));
    return { ok: false, detail: isTimeout(err) ? "Not responding yet" : "Unreachable" };
  }
}

async function checkDocService() {
  const url = process.env.NEXT_PUBLIC_DOC_SERVICE_URL;
  if (!url) {
    console.error(JSON.stringify({ evt: "health_misconfigured", service: "doc_service" }));
    return { ok: false, detail: "Not configured" };
  }
  try {
    const res = await fetch(`${url}/health`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, detail: `Responded with HTTP ${res.status}` };
    return { ok: true, detail: "Reachable" };
  } catch (err) {
    console.error(JSON.stringify({ evt: "health_unreachable", service: "doc_service", err: err instanceof Error ? err.name : "unknown" }));
    // A free-tier service that has been idle sleeps and takes a while to wake, so a timeout is not the same as being down.
    return { ok: false, detail: isTimeout(err) ? "Not responding yet (it may be waking up)" : "Unreachable" };
  }
}

export async function GET(req: Request) {
  const limited = limitRequest(req, "health", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const [supabase, docService] = await Promise.all([checkSupabase(), checkDocService()]);
  return NextResponse.json({ supabase, docService }, { headers: NO_STORE });
}

import { NextResponse } from "next/server";

async function checkSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return { ok: false, detail: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY" };
  }

  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey },
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, detail: `Supabase responded with HTTP ${res.status}` };
    }
    return { ok: true, detail: "Reached Supabase auth service" };
  } catch (err) {
    return { ok: false, detail: `Could not reach Supabase: ${(err as Error).message}` };
  }
}

async function checkDocService() {
  const url = process.env.NEXT_PUBLIC_DOC_SERVICE_URL;

  if (!url) {
    return { ok: false, detail: "Missing NEXT_PUBLIC_DOC_SERVICE_URL" };
  }

  try {
    const res = await fetch(`${url}/health`, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, detail: `Document service responded with HTTP ${res.status}` };
    }
    const body = await res.json();
    return { ok: true, detail: body };
  } catch (err) {
    return { ok: false, detail: `Could not reach document service: ${(err as Error).message}` };
  }
}

export async function GET() {
  const [supabase, docService] = await Promise.all([checkSupabase(), checkDocService()]);

  return NextResponse.json({ supabase, docService });
}

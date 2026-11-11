import { createClient } from "@/lib/supabase/client";

// Figure images live in a private bucket, so each is shown through a short-lived signed URL.
// URLs are cached for most of their lifetime so scrolling and re-rendering do not re-sign them.
const TTL_S = 3600;
const cache = new Map<string, { url: string; expires: number }>();

export async function signedFigureUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now() + 60_000) return hit.url;
  const { data, error } = await createClient().storage.from("manuscript-figures").createSignedUrl(path, TTL_S);
  if (error || !data?.signedUrl) return null;
  cache.set(path, { url: data.signedUrl, expires: Date.now() + TTL_S * 1000 });
  return data.signedUrl;
}

export async function signedFigureUrls(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all([...new Set(paths)].map(async (p) => { const u = await signedFigureUrl(p); if (u) out[p] = u; }));
  return out;
}

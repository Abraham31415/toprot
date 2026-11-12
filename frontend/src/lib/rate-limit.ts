import { NextResponse } from "next/server";

// A small fixed-window limiter for the public API routes. It is best-effort: each serverless instance keeps its own counts, so
// the limit is per instance rather than global. That is enough to stop a single client from hammering a route, and these routes
// are also cached at the edge so most repeat requests never reach them. Per-user limits for AI and payments live in the
// database and are unaffected by this file.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export type RateLimit = { limit: number; windowMs: number };
export type RateResult = { ok: boolean; remaining: number; retryAfterSeconds: number };

/** Count one request for a key. `now` is injectable for tests. */
export function checkRateLimit(key: string, { limit, windowMs }: RateLimit, now = Date.now()): RateResult {
  if (buckets.size > MAX_KEYS) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  if (buckets.size > MAX_KEYS * 2) buckets.clear(); // a flood of distinct keys: start over rather than grow without bound
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
  b.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), retryAfterSeconds };
}

/** The caller's address as the platform reports it, or a shared bucket when it is missing. Never trusted for anything but limiting. */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || req.headers.get("x-real-ip")?.trim() || "unknown";
  return ip.slice(0, 64);
}

/** A ready-made 429 response for a limited request, or null when the request may proceed. */
export function limitRequest(req: Request, name: string, rule: RateLimit): NextResponse | null {
  const r = checkRateLimit(`${name}:${clientKey(req)}`, rule);
  if (r.ok) return null;
  return NextResponse.json(
    { error: "Too many requests. Please wait a moment and try again.", retryAfter: r.retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}

/** Test helper. */
export function resetRateLimits(): void {
  buckets.clear();
}

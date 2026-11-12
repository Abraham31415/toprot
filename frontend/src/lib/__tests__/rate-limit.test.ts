import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientKey, limitRequest, resetRateLimits } from "../rate-limit";

const rule = { limit: 3, windowMs: 60_000 };
const req = (headers: Record<string, string> = {}) => new Request("https://toprot.test/api/x", { headers });

beforeEach(() => resetRateLimits());

describe("rate limiter", () => {
  it("allows up to the limit, then refuses, and says how long to wait", () => {
    const t = 1_000_000;
    expect([1, 2, 3].map(() => checkRateLimit("k", rule, t).ok)).toEqual([true, true, true]);
    const fourth = checkRateLimit("k", rule, t + 10_000);
    expect(fourth.ok).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBe(50);
  });

  it("starts a fresh window once the old one has passed", () => {
    const t = 5_000_000;
    for (let i = 0; i < 4; i++) checkRateLimit("k", rule, t);
    expect(checkRateLimit("k", rule, t + 59_999).ok).toBe(false);
    expect(checkRateLimit("k", rule, t + 60_000).ok).toBe(true);
  });

  it("counts each caller and each route separately", () => {
    const t = 9_000_000;
    for (let i = 0; i < 4; i++) checkRateLimit("search:1.1.1.1", rule, t);
    expect(checkRateLimit("search:1.1.1.1", rule, t).ok).toBe(false);
    expect(checkRateLimit("search:2.2.2.2", rule, t).ok).toBe(true);
    expect(checkRateLimit("abstract:1.1.1.1", rule, t).ok).toBe(true);
  });

  it("does not grow without bound under a flood of different callers", () => {
    const t = 2_000_000;
    for (let i = 0; i < 12_000; i++) checkRateLimit(`flood:${i}`, rule, t);
    expect(checkRateLimit("after", rule, t).ok).toBe(true);
  });

  it("identifies the caller from the platform's forwarded address, and tolerates its absence", () => {
    expect(clientKey(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientKey(req({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientKey(req())).toBe("unknown");
    expect(clientKey(req({ "x-forwarded-for": "x".repeat(500) })).length).toBeLessThanOrEqual(64);
  });

  it("returns a 429 with Retry-After that is never cached, and null while within the limit", async () => {
    const r = req({ "x-forwarded-for": "203.0.113.50" });
    for (let i = 0; i < 3; i++) expect(limitRequest(r, "t", rule)).toBeNull();
    const blocked = limitRequest(r, "t", rule)!;
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(blocked.headers.get("Cache-Control")).toBe("no-store");
    expect((await blocked.json()).error).toMatch(/too many requests/i);
  });
});

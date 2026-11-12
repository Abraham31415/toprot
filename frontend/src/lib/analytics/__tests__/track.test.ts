import { describe, expect, it } from "vitest";
import { deviceFromUserAgent, isBot, normalizePath, optedOut, parseUtm, referrerHost, toolName, visitorCode } from "../track";

describe("page tracking helpers", () => {
  it("counts a page once whatever its ids, and drops queries and fragments", () => {
    expect(normalizePath("/studies/2fa32650-4eb2-42e1-b391-4ab12a9c6ed7/protocol?x=1#top")).toBe("/studies/:id/protocol");
    expect(normalizePath("/resources/how-to-calculate-sample-size/")).toBe("/resources/how-to-calculate-sample-size");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/tools/odds-ratio-calculator?utm_source=x")).toBe("/tools/odds-ratio-calculator");
  });
  it("ignores private and non-page paths and anything that is not a local path", () => {
    for (const p of ["/admin/users", "/api/e", "/_next/x", "/auth/callback", "/logout", "/suspended", "//evil.com", "https://evil.com", "pricing", "", 5, null]) expect(normalizePath(p as never)).toBeNull();
  });
  it("keeps only a plain site name from the referrer, and ignores ToProt itself", () => {
    expect(referrerHost("https://www.google.com/search?q=secret+term", "toprot.vercel.app")).toBe("google.com");
    expect(referrerHost("https://toprot.vercel.app/pricing", "toprot.vercel.app")).toBeNull();
    expect(referrerHost("not a url", "toprot.vercel.app")).toBeNull();
    expect(referrerHost(undefined, "x")).toBeNull();
  });
  it("accepts short plain campaign labels and drops anything else", () => {
    expect(parseUtm("?utm_source=Newsletter&utm_medium=email&utm_campaign=Launch-2026&q=secret")).toEqual({ source: "newsletter", medium: "email", campaign: "launch-2026" });
    expect(parseUtm("?utm_source=<script>alert(1)</script>&utm_campaign=" + "x".repeat(200))).toEqual({ source: null, medium: null, campaign: null });
    expect(parseUtm(undefined)).toEqual({ source: null, medium: null, campaign: null });
  });
  it("classifies devices and recognises bots", () => {
    expect(deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(deviceFromUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(deviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")).toBe("desktop");
    expect(deviceFromUserAgent(null)).toBe("other");
    expect(isBot("Googlebot/2.1")).toBe(true);
    expect(isBot("curl/8.0")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot("Mozilla/5.0 (Windows NT 10.0) Chrome/120")).toBe(false);
  });
  it("makes a visitor code that changes daily, differs per visitor and reveals neither the address nor the browser", () => {
    const a = visitorCode("203.0.113.5", "Mozilla/5.0 Chrome", "salt", "2026-11-12");
    expect(a).toHaveLength(24);
    expect(a).toBe(visitorCode("203.0.113.5", "Mozilla/5.0 Chrome", "salt", "2026-11-12"));
    expect(a).not.toBe(visitorCode("203.0.113.5", "Mozilla/5.0 Chrome", "salt", "2026-11-13"));
    expect(a).not.toBe(visitorCode("203.0.113.6", "Mozilla/5.0 Chrome", "salt", "2026-11-12"));
    expect(a).not.toContain("203");
  });
  it("respects Do Not Track and Global Privacy Control", () => {
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
    expect(optedOut(h({ dnt: "1" }))).toBe(true);
    expect(optedOut(h({ "sec-gpc": "1" }))).toBe(true);
    expect(optedOut(h({}))).toBe(false);
  });
  it("accepts only a short tool name on a calculator event", () => {
    expect(toolName("sample-size-proportion")).toBe("sample-size-proportion");
    for (const bad of ["Has Spaces", "x", "a".repeat(80), "<b>", 5, null]) expect(toolName(bad)).toBeNull();
  });
});

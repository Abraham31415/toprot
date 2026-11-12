import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/rate-limit";

const call = async () => {
  const { GET } = await import("../route");
  return GET(new Request("https://toprot.test/api/health", { headers: { "x-forwarded-for": "203.0.113.7" } }));
};

beforeEach(() => { resetRateLimits(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; delete process.env.NEXT_PUBLIC_DOC_SERVICE_URL; });

describe("GET /api/health", () => {
  it("says whether services are up, without revealing configuration or internal error text", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-value";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connect ECONNREFUSED 10.1.2.3:5432 secret-host"); }));
    const res = await call();
    const text = JSON.stringify(await res.json());
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(text).toContain("Unreachable");
    expect(text).toContain("Not configured");
    for (const leak of ["10.1.2.3", "secret-host", "ECONNREFUSED", "NEXT_PUBLIC", "anon-key-value", "project.supabase.test"]) expect(text, leak).not.toContain(leak);
  });

  it("reports healthy services plainly and never passes through another service's response body", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "k";
    process.env.NEXT_PUBLIC_DOC_SERVICE_URL = "https://docs.test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok", internal: "private-build-info" }), { status: 200 })));
    const body = await (await call()).json();
    expect(body.supabase).toEqual({ ok: true, detail: "Reachable" });
    expect(body.docService).toEqual({ ok: true, detail: "Reachable" });
    expect(JSON.stringify(body)).not.toContain("private-build-info");
  });

  it("limits how often one caller may ask", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await call()).status);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes.slice(30)).toEqual([429, 429]);
  });

  it("says a service that timed out may be waking up, rather than calling it unreachable", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "k";
    process.env.NEXT_PUBLIC_DOC_SERVICE_URL = "https://docs.test";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).startsWith("https://docs.test")) throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      return new Response("{}", { status: 200 });
    }));
    const body = await (await call()).json();
    expect(body.docService).toEqual({ ok: false, detail: "Not responding yet (it may be waking up)" });
    expect(body.supabase.ok).toBe(true);
  });
});

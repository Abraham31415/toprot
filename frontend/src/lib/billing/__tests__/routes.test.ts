import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real route handlers, with the database and Flutterwave replaced by fakes.

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcResult: (fn: string) => { data: unknown; error: { message: string } | null } = () => ({ data: { ok: true, status: "succeeded", kind: "pack" }, error: null });

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: async (fn: string, args: Record<string, unknown> = {}) => { rpcCalls.push({ fn, args }); return rpcResult(fn); } }),
}));

const ENV = { FLW_SECRET_KEY: "FLWSECK_TEST-abc", FLW_WEBHOOK_HASH: "hash-1234567890", CRON_SECRET: "cron-secret-0123456789" };
const txn = (over: Record<string, unknown> = {}) => ({ status: "success", data: { id: 777, tx_ref: "toprot-1111-2222-3333", status: "successful", amount: 4.99, currency: "USD", payment_type: "card", ...over } });
let fetchImpl: (url: string) => Response | Promise<Response> = () => new Response(JSON.stringify(txn()), { status: 200 });

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult = () => ({ data: { ok: true, status: "succeeded", kind: "pack" }, error: null });
  fetchImpl = () => new Response(JSON.stringify(txn()), { status: 200 });
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  vi.stubGlobal("fetch", vi.fn(async (u: string) => fetchImpl(String(u))));
});
afterEach(() => { vi.unstubAllGlobals(); for (const k of Object.keys(ENV)) delete process.env[k]; });

const post = (body: unknown, headers: Record<string, string> = { "verif-hash": ENV.FLW_WEBHOOK_HASH }) =>
  new Request("https://toprot.test/api/billing/webhook", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const event = (over: Record<string, unknown> = {}) => ({ event: "charge.completed", data: { id: 777, tx_ref: "toprot-1111-2222-3333", status: "successful", amount: 999999, currency: "USD", ...over } });

describe("POST /api/billing/webhook", () => {
  it("is closed when payments are not configured", async () => {
    delete process.env.FLW_WEBHOOK_HASH;
    const { POST } = await import("@/app/api/billing/webhook/route");
    expect((await POST(post(event()))).status).toBe(503);
    expect(rpcCalls).toHaveLength(0);
  });
  it("rejects a missing or wrong secret hash without touching the database", async () => {
    const { POST } = await import("@/app/api/billing/webhook/route");
    expect((await POST(post(event(), {}))).status).toBe(401);
    expect((await POST(post(event(), { "verif-hash": "wrong" }))).status).toBe(401);
    expect((await POST(post(event(), { "flutterwave-signature": ENV.FLW_WEBHOOK_HASH }))).status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("verifies with Flutterwave and grants what Flutterwave reports, ignoring amounts in the webhook body", async () => {
    const { POST } = await import("@/app/api/billing/webhook/route");
    const res = await POST(post(event({ amount: 999999 })));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("fulfilled");
    expect((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]).toBe("https://api.flutterwave.com/v3/transactions/777/verify");
    expect(rpcCalls[0].args).toMatchObject({ p_tx_ref: "toprot-1111-2222-3333", p_amount: 4.99, p_provider_txn: "777", p_event_key: "charge.completed:777" });
  });
  it("does not grant when the webhook claims success but Flutterwave says the payment failed", async () => {
    fetchImpl = () => new Response(JSON.stringify(txn({ status: "failed" })), { status: 200 });
    rpcResult = () => ({ data: { ok: true, status: "failed" }, error: null });
    const { POST } = await import("@/app/api/billing/webhook/route");
    const res = await POST(post(event({ status: "successful" })));
    expect((await res.json()).outcome).toBe("failed");
    expect(rpcCalls[0].args.p_provider_status).toBe("failed");
  });
  it("does not grant when the webhook reference differs from the verified transaction's reference", async () => {
    fetchImpl = () => new Response(JSON.stringify(txn({ tx_ref: "toprot-other-order-9999" })), { status: 200 });
    const { POST } = await import("@/app/api/billing/webhook/route");
    const res = await POST(post(event()));
    expect((await res.json()).outcome).toBe("rejected");
    expect(rpcCalls).toHaveLength(0);
  });
  it("answers 200 and ignores other events and references that are not ours", async () => {
    const { POST } = await import("@/app/api/billing/webhook/route");
    expect((await (await POST(post({ event: "transfer.completed", data: {} }))).json()).ignored).toBe(true);
    expect((await (await POST(post(event({ tx_ref: "someone-elses-ref" })))).json()).ignored).toBe(true);
    expect((await (await POST(post(event({ id: "../x" })))).json()).ignored).toBe(true);
    expect(rpcCalls).toHaveLength(0);
  });
  it("rejects malformed and oversize bodies", async () => {
    const { POST } = await import("@/app/api/billing/webhook/route");
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post("x".repeat(100_001)))).status).toBe(413);
  });
  it("asks Flutterwave to retry when verification fails temporarily, and not when it cannot succeed", async () => {
    const { POST } = await import("@/app/api/billing/webhook/route");
    fetchImpl = () => new Response("{}", { status: 503 });
    expect((await POST(post(event()))).status).toBe(500);
    fetchImpl = () => new Response(JSON.stringify({ status: "error", message: "bad" }), { status: 400 });
    const res = await POST(post(event()));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("unverifiable");
    fetchImpl = () => new Response(JSON.stringify(txn()), { status: 200 });
    rpcResult = () => ({ data: null, error: { message: "db down" } });
    expect((await POST(post(event()))).status).toBe(500);
  });
  it("is safe to deliver twice", async () => {
    const { POST } = await import("@/app/api/billing/webhook/route");
    await POST(post(event()));
    rpcResult = () => ({ data: { ok: true, duplicate: true, status: "succeeded" }, error: null });
    const res = await POST(post(event()));
    expect((await res.json()).outcome).toBe("duplicate");
  });
});

describe("GET /api/billing/maintenance", () => {
  const get = (auth?: string) => new Request("https://toprot.test/api/billing/maintenance", { headers: auth ? { authorization: auth } : {} });
  it("only runs for the scheduler's secret", async () => {
    const { GET } = await import("@/app/api/billing/maintenance/route");
    expect((await GET(get())).status).toBe(401);
    expect((await GET(get("Bearer nope"))).status).toBe(401);
    expect((await GET(get(`Bearer ${ENV.CRON_SECRET}x`))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(get("Bearer "))).status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });
  it("re-checks pending payments, closes stale ones and expires credits", async () => {
    rpcResult = (fn) => fn === "billing_pending_to_check" ? { data: [{ tx_ref: "toprot-1111-2222-3333" }], error: null }
      : fn === "billing_fulfill_payment" ? { data: { ok: true, status: "succeeded", kind: "pack" }, error: null }
      : fn === "billing_close_stale_payments" ? { data: 2, error: null } : { data: 3, error: null };
    const { GET } = await import("@/app/api/billing/maintenance/route");
    const res = await GET(get(`Bearer ${ENV.CRON_SECRET}`));
    expect(await res.json()).toMatchObject({ ok: true, rechecked: 1, fulfilled: 1, closed: 2, expiredLots: 3 });
  });
  it("keeps going when one payment cannot be re-checked", async () => {
    rpcResult = (fn) => fn === "billing_pending_to_check" ? { data: [{ tx_ref: "toprot-a" }, { tx_ref: "toprot-b" }], error: null } : { data: 0, error: null };
    fetchImpl = () => new Response("{}", { status: 503 });
    const { GET } = await import("@/app/api/billing/maintenance/route");
    const body = await (await GET(get(`Bearer ${ENV.CRON_SECRET}`))).json();
    expect(body).toMatchObject({ ok: true, rechecked: 2, fulfilled: 0 });
  });
});

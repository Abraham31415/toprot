import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real Dodo webhook route, with the database and Dodo's API replaced by fakes and real Standard Webhooks signatures.

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown> = {}) => { rpcCalls.push({ fn, args }); return { data: { ok: true, status: args.p_provider_status === "failed" ? "failed" : "succeeded", kind: "pack" }, error: null }; },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q;
      q.maybeSingle = async () => ({ data: table === "payments" ? { kind: "pack", product_key: "credits_2000" } : { product_id: "pdt_pack2000" }, error: null });
      return q;
    },
  }),
}));

let recentPayment: { status: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "a@b.org" } } }) },
    from: () => { const q: Record<string, unknown> = {}; for (const m of ["select", "eq", "gte", "order", "limit"]) q[m] = () => q; q.maybeSingle = async () => ({ data: recentPayment }); return q; },
  }),
}));

const SECRET = "whsec_" + Buffer.from("a-test-webhook-secret-value-0123456789").toString("base64");
const REF = "toprot-11111111-2222-3333-4444-555555555555";
const payment = (over: Record<string, unknown> = {}) => ({ payment_id: "pay_1", status: "succeeded", total_amount: 499, tax: 0, currency: "USD", metadata: { toprot_tx_ref: REF }, subscription_id: null, product_cart: [{ product_id: "pdt_pack2000", quantity: 1 }], payment_method: "card", ...over });
let fetchImpl: (url: string) => Response = () => new Response(JSON.stringify(payment()), { status: 200 });

beforeEach(() => {
  recentPayment = null;
  rpcCalls.length = 0;
  fetchImpl = () => new Response(JSON.stringify(payment()), { status: 200 });
  process.env.DODO_PAYMENTS_API_KEY = "dodo_test_abc123";
  process.env.DODO_PAYMENTS_WEBHOOK_SECRET = SECRET;
  vi.stubGlobal("fetch", vi.fn(async (u: string) => fetchImpl(String(u))));
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.DODO_PAYMENTS_API_KEY; delete process.env.DODO_PAYMENTS_WEBHOOK_SECRET; });

function signed(body: unknown, over: { id?: string; ts?: number; secret?: string; badSig?: boolean } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const id = over.id ?? "msg_abc123", ts = String(over.ts ?? Math.floor(Date.now() / 1000));
  const key = Buffer.from((over.secret ?? SECRET).slice(6), "base64");
  const sig = over.badSig ? "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" : `v1,${createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64")}`;
  return new Request("https://toprot.test/api/billing/dodo-webhook", { method: "POST", headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sig }, body: raw });
}
const evt = (type: string, data: Record<string, unknown>) => ({ type, data });

describe("POST /api/billing/dodo-webhook", () => {
  it("is closed when payments are not configured", async () => {
    delete process.env.DODO_PAYMENTS_WEBHOOK_SECRET;
    const { POST } = await import("@/app/api/billing/dodo-webhook/route");
    expect((await POST(signed(evt("payment.succeeded", { payment_id: "pay_1" })))).status).toBe(503);
    expect(rpcCalls).toHaveLength(0);
  });
  it("rejects bad signatures, wrong secrets, stale timestamps and unsigned requests without touching Dodo or the database", async () => {
    const { POST } = await import("@/app/api/billing/dodo-webhook/route");
    const e = evt("payment.succeeded", { payment_id: "pay_1" });
    expect((await POST(signed(e, { badSig: true }))).status).toBe(401);
    expect((await POST(signed(e, { secret: "whsec_" + Buffer.from("some-other-secret-0123456789abcdef").toString("base64") }))).status).toBe(401);
    expect((await POST(signed(e, { ts: Math.floor(Date.now() / 1000) - 3600 }))).status).toBe(401);
    expect((await POST(new Request("https://toprot.test/x", { method: "POST", body: JSON.stringify(e) }))).status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("re-fetches the payment from Dodo and grants what Dodo reports, ignoring amounts in the webhook body", async () => {
    const { POST } = await import("@/app/api/billing/dodo-webhook/route");
    const res = await POST(signed(evt("payment.succeeded", { payment_id: "pay_1", total_amount: 99999999, status: "succeeded" })));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("fulfilled");
    expect((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]).toBe("https://test.dodopayments.com/payments/pay_1");
    expect(rpcCalls[0].args).toMatchObject({ p_tx_ref: REF, p_amount: 4.99, p_provider_txn: "pay_1", p_event_key: "dodo:msg_abc123" });
  });
  it("does not grant when the webhook claims success but Dodo says the payment failed", async () => {
    fetchImpl = () => new Response(JSON.stringify(payment({ status: "failed" })), { status: 200 });
    const { POST } = await import("@/app/api/billing/dodo-webhook/route");
    await POST(signed(evt("payment.succeeded", { payment_id: "pay_1", status: "succeeded" })));
    expect(rpcCalls.every((c) => c.args.p_provider_status !== "successful")).toBe(true);
  });
  it("asks Dodo to retry when Dodo is down, and acknowledges payments it cannot verify at all", async () => {
    const { POST } = await import("@/app/api/billing/dodo-webhook/route");
    fetchImpl = () => new Response("{}", { status: 503 });
    expect((await POST(signed(evt("payment.succeeded", { payment_id: "pay_1" })))).status).toBe(500);
    fetchImpl = () => new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    const r = await POST(signed(evt("payment.succeeded", { payment_id: "pay_missing" })));
    expect(r.status).toBe(200);
    expect(rpcCalls).toHaveLength(0);
  });
  it("syncs subscription cancellation state from Dodo", async () => {
    fetchImpl = () => new Response(JSON.stringify({ subscription_id: "sub_1", status: "active", product_id: "pdt_pro", cancel_at_next_billing_date: true }), { status: 200 });
    const { POST } = await import("@/app/api/billing/dodo-webhook/route");
    const res = await POST(signed(evt("subscription.cancelled", { subscription_id: "sub_1" })));
    expect(res.status).toBe(200);
    expect(rpcCalls[0]).toEqual({ fn: "billing_mark_subscription_cancel", args: { p_provider: "dodo", p_provider_subscription_id: "sub_1", p_cancel: true } });
  });
  it("ignores unknown events, malformed ids and bad JSON", async () => {
    const { POST } = await import("@/app/api/billing/dodo-webhook/route");
    expect((await (await POST(signed(evt("dispute.opened", { x: 1 })))).json()).ignored).toBe(true);
    expect((await (await POST(signed(evt("payment.succeeded", { payment_id: "../subscriptions" })))).json()).ignored).toBe(true);
    expect((await POST(signed("not json"))).status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses oversized bodies", async () => {
    const { POST } = await import("@/app/api/billing/dodo-webhook/route");
    expect((await POST(signed("x".repeat(250_000)))).status).toBe(413);
  });
});

describe("GET /billing/return (Dodo)", () => {
  const get = (qs: string) => new (require("next/server").NextRequest)(`https://toprot.test/billing/return${qs}`);
  it("confirms a purchase from Dodo's payment id alone, when Dodo does not pass our reference back", async () => {
    const { GET } = await import("@/app/billing/return/route");
    const res = await GET(get("?payment_id=pay_1&status=succeeded"));
    expect(res.headers.get("location")).toMatch(/\/billing\?checkout=success$/);
    expect((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]).toBe("https://test.dodopayments.com/payments/pay_1");
    expect(rpcCalls.find((c) => c.fn === "billing_fulfill_payment")?.args).toMatchObject({ p_tx_ref: REF, p_amount: 4.99 });
  });
  it("does not trust the status in the URL: a failed payment at Dodo is not shown as success", async () => {
    fetchImpl = () => new Response(JSON.stringify(payment({ status: "failed" })), { status: 200 });
    const { GET } = await import("@/app/billing/return/route");
    const res = await GET(get("?payment_id=pay_1&status=succeeded"));
    expect(res.headers.get("location")).not.toMatch(/success/);
  });
  it("shows unknown for a request with neither our reference nor a usable payment id", async () => {
    const { GET } = await import("@/app/billing/return/route");
    expect((await GET(get("?payment_id=../x"))).headers.get("location")).toMatch(/checkout=unknown$/);
    expect((await GET(get(""))).headers.get("location")).toMatch(/checkout=unknown$/);
  });
  it("with no reference and no payment id, shows the outcome of the customer's own most recent payment", async () => {
    const { GET } = await import("@/app/billing/return/route");
    recentPayment = { status: "succeeded" };
    expect((await GET(get("?subscription_id=sub_1&status=active"))).headers.get("location")).toMatch(/checkout=success$/);
    recentPayment = { status: "pending" };
    expect((await GET(get("?status=active"))).headers.get("location")).toMatch(/checkout=pending$/);
    recentPayment = { status: "failed" };
    expect((await GET(get(""))).headers.get("location")).toMatch(/checkout=failed$/);
    recentPayment = null;
    expect((await GET(get(""))).headers.get("location")).toMatch(/checkout=unknown$/);
    expect(rpcCalls).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("when Dodo's payment id does not match one of our orders, shows the latest payment instead of 'not found'", async () => {
    const { GET } = await import("@/app/billing/return/route");
    fetchImpl = () => new Response(JSON.stringify(payment({ metadata: {} })), { status: 200 });
    recentPayment = { status: "succeeded" };
    expect((await GET(get("?payment_id=pay_unrelated"))).headers.get("location")).toMatch(/checkout=success$/);
    recentPayment = null;
    expect((await GET(get("?payment_id=pay_unrelated"))).headers.get("location")).toMatch(/checkout=unknown$/);
  });
});

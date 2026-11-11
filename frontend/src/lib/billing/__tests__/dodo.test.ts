import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { cancelAtPeriodEnd, createCheckout, DodoError, dodoCheckoutReady, getPayment, getSubscription, loadDodoConfig, newDodoTxRef, verifyDodoWebhook, type DodoConfig } from "../dodo";
import { activeProvider, providerInfo, providerReady } from "../provider";
import { fulfilDodoPayment, syncDodoSubscription } from "../dodo-fulfil";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const CFG: DodoConfig = { apiKey: "dodo_test_abc123", webhookSecret: SECRET, baseUrl: "https://test.dodopayments.com", mode: "test", liveEnabled: false };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchOf = (...responses: (Response | Error)[]) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r.clone();
  }) as unknown as typeof fetch;
  return { f, calls };
};
const sign = (id: string, ts: string, body: string, secret = SECRET) => `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;

describe("configuration and provider selection", () => {
  it("is off without a key, and detects test and live keys with the matching base URL", () => {
    expect(loadDodoConfig({})).toBeNull();
    expect(loadDodoConfig({ DODO_PAYMENTS_API_KEY: "dodo_test_x" })).toMatchObject({ mode: "test", baseUrl: "https://test.dodopayments.com" });
    expect(loadDodoConfig({ DODO_PAYMENTS_API_KEY: "dodo_live_x" })).toMatchObject({ mode: "live", baseUrl: "https://live.dodopayments.com" });
  });
  it("refuses live payments unless explicitly enabled, and needs the webhook secret", () => {
    expect(dodoCheckoutReady(null)).toMatchObject({ ok: false });
    expect(dodoCheckoutReady({ ...CFG, webhookSecret: null })).toMatchObject({ ok: false });
    expect(dodoCheckoutReady({ ...CFG, mode: "live" })).toMatchObject({ ok: false, message: "Payments are not open yet." });
    expect(dodoCheckoutReady({ ...CFG, mode: "live", liveEnabled: true })).toEqual({ ok: true });
    expect(dodoCheckoutReady(CFG)).toEqual({ ok: true });
  });
  it("makes unique unpredictable references", () => {
    expect(newDodoTxRef()).toMatch(/^toprot-[0-9a-f-]{36}$/);
    expect(newDodoTxRef()).not.toBe(newDodoTxRef());
  });
  it("prefers Dodo when its key is set, and reports readiness honestly", () => {
    expect(activeProvider({})).toBeNull();
    expect(activeProvider({ FLW_SECRET_KEY: "x" })).toBe("flutterwave");
    expect(activeProvider({ FLW_SECRET_KEY: "x", DODO_PAYMENTS_API_KEY: "dodo_test_x" })).toBe("dodo");
    expect(providerReady({})).toEqual({ ok: false, message: "Payments are not switched on yet." });
    expect(providerReady({ DODO_PAYMENTS_API_KEY: "dodo_test_x" })).toMatchObject({ ok: false });
    expect(providerReady({ DODO_PAYMENTS_API_KEY: "dodo_test_x", DODO_PAYMENTS_WEBHOOK_SECRET: SECRET })).toEqual({ ok: true, provider: "dodo" });
    expect(providerInfo({ DODO_PAYMENTS_API_KEY: "dodo_test_x" })).toMatchObject({ name: "Dodo Payments", currencies: ["USD"], autoRenews: true });
    expect(providerInfo({})).toMatchObject({ id: "dodo" });
  });
});

describe("createCheckout", () => {
  const input = { productId: "pdt_abc", returnUrl: "https://toprot.vercel.app/billing/return?tx_ref=toprot-x", email: "a@b.org", metadata: { toprot_tx_ref: "toprot-x" } };
  it("posts the order with our key, locks USD, and returns the hosted link", async () => {
    const { f, calls } = fetchOf(json({ session_id: "cks_1", checkout_url: "https://test.checkout.dodopayments.com/session/cks_1" }));
    const r = await createCheckout(CFG, input, f);
    expect(r).toEqual({ link: "https://test.checkout.dodopayments.com/session/cks_1", sessionId: "cks_1" });
    expect(calls[0].url).toBe("https://test.dodopayments.com/checkouts");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer dodo_test_abc123");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ product_cart: [{ product_id: "pdt_abc", quantity: 1 }], customer: { email: "a@b.org" }, return_url: input.returnUrl, billing_currency: "USD", metadata: { toprot_tx_ref: "toprot-x" } });
    expect(JSON.stringify(body)).not.toContain("dodo_test_abc123");
  });
  it("never sends a customer anywhere except Dodo's own checkout", async () => {
    for (const link of ["https://evil.example/pay", "http://checkout.dodopayments.com/x", "https://dodopayments.com.evil.example/x", "javascript:alert(1)"]) {
      await expect(createCheckout(CFG, input, fetchOf(json({ session_id: "s", checkout_url: link })).f), link).rejects.toThrow(DodoError);
    }
  });
  it("classifies failures as retryable or final", async () => {
    await expect(createCheckout(CFG, input, fetchOf(json({ message: "x" }, 503)).f)).rejects.toMatchObject({ retryable: true });
    await expect(createCheckout(CFG, input, fetchOf(json({}, 429)).f)).rejects.toMatchObject({ retryable: true });
    await expect(createCheckout(CFG, input, fetchOf(new Error("ECONNRESET")).f)).rejects.toMatchObject({ retryable: true });
    await expect(createCheckout(CFG, input, fetchOf(json({ message: "Invalid product" }, 422)).f)).rejects.toMatchObject({ retryable: false, message: "Invalid product" });
    await expect(createCheckout(CFG, input, fetchOf(json({ nope: 1 })).f)).rejects.toMatchObject({ retryable: false });
  });
});

describe("getPayment", () => {
  const body = (over: Record<string, unknown> = {}) => ({ payment_id: "pay_123", status: "succeeded", total_amount: 879, tax: 80, currency: "USD", metadata: { toprot_tx_ref: "toprot-x" }, subscription_id: null, product_cart: [{ product_id: "pdt_abc", quantity: 1 }], payment_method: "card", ...over });
  it("reads the payment and works out the amount before tax in major units", async () => {
    const { f, calls } = fetchOf(json(body()));
    const p = await getPayment(CFG, "pay_123", f);
    expect(p).toEqual({ paymentId: "pay_123", status: "succeeded", preTaxAmount: 7.99, currency: "USD", metadata: { toprot_tx_ref: "toprot-x" }, subscriptionId: null, productIds: ["pdt_abc"], method: "card" });
    expect(calls[0].url).toBe("https://test.dodopayments.com/payments/pay_123");
    expect(calls[0].init.method).toBe("GET");
  });
  it("treats a missing tax as zero and handles zero-decimal currencies", async () => {
    expect((await getPayment(CFG, "pay_1", fetchOf(json(body({ tax: null, total_amount: 799 }))).f)).preTaxAmount).toBe(7.99);
    expect((await getPayment(CFG, "pay_1", fetchOf(json(body({ tax: 0, total_amount: 29000, currency: "UGX" }))).f)).preTaxAmount).toBe(29000);
  });
  it("lists only products actually in the cart", async () => {
    const p = await getPayment(CFG, "pay_1", fetchOf(json(body({ product_cart: [{ product_id: "a", quantity: 0 }, { product_id: "b", quantity: 2 }] }))).f);
    expect(p.productIds).toEqual(["b"]);
  });
  it("rejects ids that could change the request path and malformed responses", async () => {
    for (const id of ["../subscriptions", "pay/1", "pay 1", "", "x".repeat(200)]) await expect(getPayment(CFG, id, fetchOf(json(body())).f), id).rejects.toThrow(DodoError);
    await expect(getPayment(CFG, "pay_1", fetchOf(json({ payment_id: "x" })).f)).rejects.toThrow(DodoError);
  });
});

describe("subscriptions", () => {
  const sub = (over: Record<string, unknown> = {}) => ({ subscription_id: "sub_1", status: "active", product_id: "pdt_pro", cancel_at_next_billing_date: false, next_billing_date: "2026-12-01T00:00:00Z", ...over });
  it("reads a subscription", async () => {
    const { f, calls } = fetchOf(json(sub()));
    expect(await getSubscription(CFG, "sub_1", f)).toEqual({ subscriptionId: "sub_1", status: "active", productId: "pdt_pro", cancelAtPeriodEnd: false, nextBillingDate: "2026-12-01T00:00:00Z" });
    expect(calls[0].url).toBe("https://test.dodopayments.com/subscriptions/sub_1");
  });
  it("cancels at the end of the period, not immediately", async () => {
    const { f, calls } = fetchOf(json(sub({ cancel_at_next_billing_date: true })));
    const r = await cancelAtPeriodEnd(CFG, "sub_1", f);
    expect(r.cancelAtPeriodEnd).toBe(true);
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ cancel_at_next_billing_date: true, status: "cancelled" });
  });
  it("rejects bad ids", async () => {
    await expect(cancelAtPeriodEnd(CFG, "../x", fetchOf(json(sub())).f)).rejects.toThrow(DodoError);
    await expect(getSubscription(CFG, "a b", fetchOf(json(sub())).f)).rejects.toThrow(DodoError);
  });
});

describe("verifyDodoWebhook (Standard Webhooks)", () => {
  const BODY = '{"test": 2432232314}';
  const ID = "msg_p5jXN8AQM9LWM0D4loKWxJek", TS = "1614265330";
  const now = Number(TS) * 1000;

  it("matches the published Standard Webhooks example (a known answer from outside this code)", () => {
    const sig = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";
    expect(verifyDodoWebhook(CFG, { id: ID, timestamp: TS, signature: sig }, BODY, now)).toBe(true);
    expect(sign(ID, TS, BODY)).toBe(sig);
  });
  it("rejects a changed body, id, timestamp or secret", () => {
    const good = sign(ID, TS, BODY);
    expect(verifyDodoWebhook(CFG, { id: ID, timestamp: TS, signature: good }, BODY + " ", now)).toBe(false);
    expect(verifyDodoWebhook(CFG, { id: "msg_other", timestamp: TS, signature: good }, BODY, now)).toBe(false);
    expect(verifyDodoWebhook(CFG, { id: ID, timestamp: String(Number(TS) + 1), signature: good }, BODY, now)).toBe(false);
    expect(verifyDodoWebhook({ ...CFG, webhookSecret: "whsec_" + Buffer.from("another secret value").toString("base64") }, { id: ID, timestamp: TS, signature: good }, BODY, now)).toBe(false);
  });
  it("accepts any matching signature among several, and ignores other versions", () => {
    const good = sign(ID, TS, BODY);
    expect(verifyDodoWebhook(CFG, { id: ID, timestamp: TS, signature: `v1,AAAA ${good}` }, BODY, now)).toBe(true);
    expect(verifyDodoWebhook(CFG, { id: ID, timestamp: TS, signature: good.replace("v1,", "v2,") }, BODY, now)).toBe(false);
    expect(verifyDodoWebhook(CFG, { id: ID, timestamp: TS, signature: "v1,notbase64!!" }, BODY, now)).toBe(false);
  });
  it("rejects missing headers, a missing secret, and anything outside the five minute window (replays)", () => {
    const good = sign(ID, TS, BODY);
    expect(verifyDodoWebhook(CFG, { id: null, timestamp: TS, signature: good }, BODY, now)).toBe(false);
    expect(verifyDodoWebhook(CFG, { id: ID, timestamp: null, signature: good }, BODY, now)).toBe(false);
    expect(verifyDodoWebhook(CFG, { id: ID, timestamp: TS, signature: null }, BODY, now)).toBe(false);
    expect(verifyDodoWebhook({ ...CFG, webhookSecret: null }, { id: ID, timestamp: TS, signature: good }, BODY, now)).toBe(false);
    expect(verifyDodoWebhook(CFG, { id: ID, timestamp: TS, signature: good }, BODY, now + 301_000)).toBe(false);
    expect(verifyDodoWebhook(CFG, { id: ID, timestamp: TS, signature: good }, BODY, now - 301_000)).toBe(false);
    expect(verifyDodoWebhook(CFG, { id: ID, timestamp: TS, signature: good }, BODY, now + 299_000)).toBe(true);
    expect(verifyDodoWebhook(CFG, { id: ID, timestamp: "not-a-number", signature: good }, BODY, now)).toBe(false);
  });
});

// ---- Fulfilment ----

type Order = { kind: string; product_key: string } | null;
function fakeDb(opts: { order?: Order; productId?: string | null; rpc?: Record<string, unknown>; rpcError?: string } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    calls,
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      if (opts.rpcError === fn) return { data: null, error: { message: "db down" } };
      return { data: opts.rpc?.[fn] ?? { ok: true, status: "succeeded", kind: "pack" }, error: null };
    },
    from: (table: string) => ({
      select: () => {
        const q: Record<string, unknown> = {};
        q.eq = () => q;
        q.maybeSingle = async () => ({ data: table === "payments" ? (opts.order === undefined ? { kind: "pack", product_key: "credits_2000" } : opts.order) : opts.productId === undefined ? { product_id: "pdt_pack2000" } : opts.productId ? { product_id: opts.productId } : null });
        return q;
      },
    }),
  };
  return db as unknown as Parameters<typeof fulfilDodoPayment>[0] & { calls: typeof calls };
}
const REF = "toprot-11111111-2222-3333-4444-555555555555";
const pay = (over: Record<string, unknown> = {}) => json({ payment_id: "pay_1", status: "succeeded", total_amount: 499, tax: 0, currency: "USD", metadata: { toprot_tx_ref: REF }, subscription_id: null, product_cart: [{ product_id: "pdt_pack2000", quantity: 1 }], payment_method: "card", ...over });

describe("fulfilDodoPayment", () => {
  it("grants only after re-fetching the payment, passing what Dodo reports (before tax), and the webhook id for idempotency", async () => {
    const db = fakeDb();
    const r = await fulfilDodoPayment(db, CFG, { paymentId: "pay_1", eventKey: "dodo:evt1" }, fetchOf(pay({ total_amount: 549, tax: 50 })).f);
    expect(r).toEqual({ outcome: "fulfilled", kind: "pack" });
    expect(db.calls[0]).toEqual({ fn: "billing_fulfill_payment", args: { p_tx_ref: REF, p_provider_txn: "pay_1", p_provider_status: "successful", p_amount: 4.99, p_currency: "USD", p_method: "card", p_event_key: "dodo:evt1" } });
  });
  it("rejects a payment for a different product than the one sold, or extra items, without granting", async () => {
    for (const cart of [[{ product_id: "pdt_cheap", quantity: 1 }], [{ product_id: "pdt_pack2000", quantity: 1 }, { product_id: "pdt_x", quantity: 1 }], []]) {
      const db = fakeDb();
      expect(await fulfilDodoPayment(db, CFG, { paymentId: "pay_1" }, fetchOf(pay({ product_cart: cart })).f)).toEqual({ outcome: "rejected", code: "product_mismatch" });
      expect(db.calls).toHaveLength(0);
    }
  });
  it("rejects when no Dodo product is configured for the order", async () => {
    const db = fakeDb({ productId: null });
    expect(await fulfilDodoPayment(db, CFG, { paymentId: "pay_1" }, fetchOf(pay()).f)).toEqual({ outcome: "rejected", code: "product_not_configured" });
    expect(db.calls).toHaveLength(0);
  });
  it("waits for a payment that is still processing, and records a failed one as failed", async () => {
    const a = fakeDb();
    expect(await fulfilDodoPayment(a, CFG, { paymentId: "pay_1" }, fetchOf(pay({ status: "processing" })).f)).toEqual({ outcome: "pending" });
    expect(a.calls).toHaveLength(0);
    const b = fakeDb({ rpc: { billing_fulfill_payment: { ok: true, status: "failed" } } });
    expect(await fulfilDodoPayment(b, CFG, { paymentId: "pay_1" }, fetchOf(pay({ status: "failed" })).f)).toEqual({ outcome: "failed" });
    expect(b.calls[0].args.p_provider_status).toBe("failed");
  });
  it("ignores payments that are not ours: no reference and no subscription, an unknown order", async () => {
    const a = fakeDb();
    expect(await fulfilDodoPayment(a, CFG, { paymentId: "pay_1" }, fetchOf(pay({ metadata: {} })).f)).toEqual({ outcome: "ignored" });
    expect(await fulfilDodoPayment(a, CFG, { paymentId: "pay_1" }, fetchOf(pay({ metadata: { toprot_tx_ref: "not-our-format" } })).f)).toEqual({ outcome: "ignored" });
    expect(await fulfilDodoPayment(fakeDb({ order: null }), CFG, { paymentId: "pay_1" }, fetchOf(pay()).f)).toEqual({ outcome: "ignored" });
    expect(a.calls).toHaveLength(0);
  });
  it("is safe to repeat", async () => {
    const db = fakeDb({ rpc: { billing_fulfill_payment: { ok: true, duplicate: true, status: "succeeded" } } });
    expect(await fulfilDodoPayment(db, CFG, { paymentId: "pay_1" }, fetchOf(pay()).f)).toEqual({ outcome: "duplicate" });
  });
  it("passes the database's refusals through (amount mismatch) and retries on database trouble", async () => {
    expect(await fulfilDodoPayment(fakeDb({ rpc: { billing_fulfill_payment: { ok: false, code: "mismatch" } } }), CFG, { paymentId: "pay_1" }, fetchOf(pay({ total_amount: 100 })).f)).toEqual({ outcome: "rejected", code: "mismatch" });
    await expect(fulfilDodoPayment(fakeDb({ rpcError: "billing_fulfill_payment" }), CFG, { paymentId: "pay_1" }, fetchOf(pay()).f)).rejects.toMatchObject({ retryable: true });
    await expect(fulfilDodoPayment(fakeDb(), CFG, { paymentId: "pay_1" }, fetchOf(json({}, 503)).f)).rejects.toMatchObject({ retryable: true });
  });

  describe("subscriptions", () => {
    const order: Order = { kind: "subscription", product_key: "pro" };
    const subResp = (productId = "pdt_pro") => json({ subscription_id: "sub_1", status: "active", product_id: productId, cancel_at_next_billing_date: false });
    it("verifies the subscription's product, grants the period, and links the subscription id to the customer", async () => {
      const db = fakeDb({ order, productId: "pdt_pro", rpc: { billing_fulfill_payment: { ok: true, status: "succeeded", kind: "subscription" } } });
      const r = await fulfilDodoPayment(db, CFG, { paymentId: "pay_1" }, fetchOf(pay({ total_amount: 799, subscription_id: "sub_1", product_cart: null }), subResp()).f);
      expect(r).toEqual({ outcome: "fulfilled", kind: "subscription" });
      expect(db.calls.map((c) => c.fn)).toEqual(["billing_fulfill_payment", "billing_link_provider_subscription"]);
      expect(db.calls[1].args).toEqual({ p_tx_ref: REF, p_provider_subscription_id: "sub_1" });
    });
    it("rejects a subscription to a different product than Pro", async () => {
      const db = fakeDb({ order, productId: "pdt_pro" });
      expect(await fulfilDodoPayment(db, CFG, { paymentId: "pay_1" }, fetchOf(pay({ subscription_id: "sub_1", product_cart: null }), subResp("pdt_other")).f)).toEqual({ outcome: "rejected", code: "product_mismatch" });
      expect(db.calls).toHaveLength(0);
    });
    it("rejects an order for a subscription whose payment is not a subscription payment", async () => {
      const db = fakeDb({ order, productId: "pdt_pro" });
      expect(await fulfilDodoPayment(db, CFG, { paymentId: "pay_1" }, fetchOf(pay({ subscription_id: null })).f)).toEqual({ outcome: "rejected", code: "not_a_subscription_payment" });
    });
    it("turns an automatic renewal (no reference of ours, but a known subscription) into a verified payment", async () => {
      const db = fakeDb({ order, productId: "pdt_pro", rpc: { billing_start_renewal_payment: { ok: true, tx_ref: "renewal-dodo-pay_2" + "0".repeat(8) }, billing_fulfill_payment: { ok: true, status: "succeeded", kind: "subscription" } } });
      const r = await fulfilDodoPayment(db, CFG, { paymentId: "pay_2" }, fetchOf(pay({ payment_id: "pay_2", metadata: {}, total_amount: 799, subscription_id: "sub_1", product_cart: null }), subResp()).f);
      expect(r).toEqual({ outcome: "fulfilled", kind: "subscription" });
      expect(db.calls.map((c) => c.fn)).toEqual(["billing_start_renewal_payment", "billing_fulfill_payment"]);
      expect(db.calls[0].args).toEqual({ p_provider: "dodo", p_provider_subscription_id: "sub_1", p_provider_payment_id: "pay_2" });
    });
    it("ignores a renewal for a subscription we do not know", async () => {
      const db = fakeDb({ rpc: { billing_start_renewal_payment: { ok: false, code: "unknown_subscription" } } });
      expect(await fulfilDodoPayment(db, CFG, { paymentId: "pay_2" }, fetchOf(pay({ metadata: {}, subscription_id: "sub_zzz" })).f)).toEqual({ outcome: "ignored" });
    });
    it("does not start a renewal for a payment that did not succeed", async () => {
      const db = fakeDb();
      expect(await fulfilDodoPayment(db, CFG, { paymentId: "pay_2" }, fetchOf(pay({ metadata: {}, subscription_id: "sub_1", status: "failed" })).f)).toEqual({ outcome: "ignored" });
      expect(db.calls).toHaveLength(0);
    });
  });
});

describe("syncDodoSubscription", () => {
  it("marks renewal as stopped when Dodo says it will not renew, and as continuing otherwise", async () => {
    const run = async (sub: Record<string, unknown>) => { const db = fakeDb(); await syncDodoSubscription(db, CFG, "sub_1", fetchOf(json({ subscription_id: "sub_1", product_id: "p", ...sub })).f); return db.calls[0].args.p_cancel; };
    expect(await run({ status: "active", cancel_at_next_billing_date: false })).toBe(false);
    expect(await run({ status: "active", cancel_at_next_billing_date: true })).toBe(true);
    for (const status of ["cancelled", "expired", "failed", "on_hold"]) expect(await run({ status })).toBe(true);
  });
  it("retries on database trouble", async () => {
    await expect(syncDodoSubscription(fakeDb({ rpcError: "billing_mark_subscription_cancel" }), CFG, "sub_1", fetchOf(json({ subscription_id: "sub_1", status: "active" })).f)).rejects.toMatchObject({ retryable: true });
  });
});

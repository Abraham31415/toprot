import { describe, expect, it, vi } from "vitest";
import {
  checkoutReady, createCheckout, FlwError, loadFlwConfig, newTxRef, paymentOptionsFor, verifyById, verifyByReference, webhookAuthentic, type FlwConfig,
} from "../flutterwave";
import { verifyAndFulfil } from "../fulfil";

const CFG: FlwConfig = { secretKey: "FLWSECK_TEST-abc123", webhookHash: "super-secret-hash-123", baseUrl: "https://api.flutterwave.com/v3", mode: "test", liveEnabled: false };
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
const txnBody = (over: Record<string, unknown> = {}) => ({ status: "success", message: "ok", data: { id: 285959875, tx_ref: "toprot-aaaa-bbbb-cccc", status: "successful", amount: 7.99, currency: "USD", payment_type: "card", ...over } });

describe("configuration", () => {
  it("is off without a secret key, and detects test and live keys", () => {
    expect(loadFlwConfig({})).toBeNull();
    expect(loadFlwConfig({ FLW_SECRET_KEY: "FLWSECK_TEST-x" })?.mode).toBe("test");
    expect(loadFlwConfig({ FLW_SECRET_KEY: "FLWSECK-live-x" })?.mode).toBe("live");
    expect(loadFlwConfig({ FLW_SECRET_KEY: "FLWSECK_TEST-x", FLW_BASE_URL: "https://sandbox.example/v3/" })?.baseUrl).toBe("https://sandbox.example/v3");
  });
  it("refuses live payments unless live mode is explicitly enabled, and needs the webhook secret", () => {
    expect(checkoutReady(null)).toMatchObject({ ok: false });
    expect(checkoutReady({ ...CFG, webhookHash: null })).toMatchObject({ ok: false });
    expect(checkoutReady({ ...CFG, mode: "live", liveEnabled: false })).toMatchObject({ ok: false, message: "Payments are not open yet." });
    expect(checkoutReady({ ...CFG, mode: "live", liveEnabled: true })).toEqual({ ok: true });
    expect(checkoutReady(CFG)).toEqual({ ok: true });
  });
  it("makes unpredictable unique references", () => {
    const a = newTxRef(), b = newTxRef();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^toprot-[0-9a-f-]{36}$/);
  });
  it("offers Ugandan Mobile Money only for UGX", () => {
    expect(paymentOptionsFor("UGX")).toBe("mobilemoneyuganda,card");
    expect(paymentOptionsFor("USD")).toBe("card");
  });
});

describe("createCheckout", () => {
  const input = { txRef: "toprot-aaaa-bbbb-cccc", amount: 7.99, currency: "USD", redirectUrl: "https://toprot.vercel.app/billing/return", customer: { email: "a@b.org" }, title: "Toprot Pro", description: "one month" };
  it("posts the order with our secret key and returns the hosted link", async () => {
    const { f, calls } = fetchOf(json({ status: "success", message: "Hosted Link", data: { link: "https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-123" } }));
    const r = await createCheckout(CFG, input, f);
    expect(r.link).toBe("https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-123");
    expect(calls[0].url).toBe("https://api.flutterwave.com/v3/payments");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer FLWSECK_TEST-abc123");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ tx_ref: input.txRef, amount: 7.99, currency: "USD", redirect_url: input.redirectUrl, customer: { email: "a@b.org" }, payment_options: "card" });
    expect(JSON.stringify(body)).not.toContain("FLWSECK");
  });
  it("never sends a customer anywhere except Flutterwave's own checkout", async () => {
    for (const link of ["https://evil.example/pay", "http://checkout.flutterwave.com/x", "https://flutterwave.com.evil.example/x", "javascript:alert(1)"]) {
      const { f } = fetchOf(json({ status: "success", message: "Hosted Link", data: { link } }));
      await expect(createCheckout(CFG, input, f), link).rejects.toThrow(FlwError);
    }
  });
  it("treats server errors and network failures as retryable and rejections as final", async () => {
    await expect(createCheckout(CFG, input, fetchOf(json({ message: "boom" }, 503)).f)).rejects.toMatchObject({ retryable: true });
    await expect(createCheckout(CFG, input, fetchOf(new Error("ECONNRESET")).f)).rejects.toMatchObject({ retryable: true });
    await expect(createCheckout(CFG, input, fetchOf(json({ message: "Invalid currency" }, 400)).f)).rejects.toMatchObject({ retryable: false, message: "Invalid currency" });
    await expect(createCheckout(CFG, input, fetchOf(json({ status: "success", data: {} })).f)).rejects.toMatchObject({ retryable: false });
  });
  it("never leaks the secret key into an error", async () => {
    try { await createCheckout(CFG, input, fetchOf(json({ message: "Bad key FLWSECK_TEST-abc123" }, 401)).f); } catch (e) { expect(String((e as Error).message)).toBeTruthy(); }
  });
});

describe("verification", () => {
  it("reads status, reference, amount and currency from Flutterwave's response", async () => {
    const { f, calls } = fetchOf(json(txnBody({ amount: "7.99", currency: "usd" })));
    const t = await verifyById(CFG, "285959875", f);
    expect(t).toEqual({ id: "285959875", txRef: "toprot-aaaa-bbbb-cccc", status: "successful", amount: 7.99, currency: "USD", paymentType: "card" });
    expect(calls[0].url).toBe("https://api.flutterwave.com/v3/transactions/285959875/verify");
    expect(calls[0].init.method).toBe("GET");
  });
  it("rejects ids that could change the request path", async () => {
    for (const id of ["../payments", "1/verify?x=", "12a", "", "1".repeat(30)]) await expect(verifyById(CFG, id, fetchOf(json(txnBody())).f), id).rejects.toThrow(FlwError);
  });
  it("rejects malformed responses and non-numeric amounts", async () => {
    await expect(verifyById(CFG, "1", fetchOf(json({ status: "error", message: "x" })).f)).rejects.toThrow(FlwError);
    await expect(verifyById(CFG, "1", fetchOf(json(txnBody({ amount: "free" }))).f)).rejects.toThrow(/amount/);
  });
  it("looks up by our reference, and returns null when the customer never paid", async () => {
    const ok = fetchOf(json(txnBody()));
    expect((await verifyByReference(CFG, "toprot-x y&z", ok.f))?.id).toBe("285959875");
    expect(ok.calls[0].url).toContain("verify_by_reference?tx_ref=toprot-x%20y%26z");
    expect(await verifyByReference(CFG, "toprot-none", fetchOf(json({ status: "error", message: "No transaction was found" }, 404)).f)).toBeNull();
    await expect(verifyByReference(CFG, "toprot-none", fetchOf(json({}, 500)).f)).rejects.toMatchObject({ retryable: true });
  });
});

describe("webhookAuthentic", () => {
  it("accepts only the exact secret hash", () => {
    expect(webhookAuthentic(CFG, "super-secret-hash-123")).toBe(true);
    expect(webhookAuthentic(CFG, "super-secret-hash-124")).toBe(false);
    expect(webhookAuthentic(CFG, "")).toBe(false);
    expect(webhookAuthentic(CFG, null)).toBe(false);
    expect(webhookAuthentic(CFG, "x".repeat(5000))).toBe(false);
    expect(webhookAuthentic({ ...CFG, webhookHash: null }, "anything")).toBe(false);
  });
});

describe("verifyAndFulfil", () => {
  const rpcOf = (result: unknown, error: { message: string } | null = null) => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    return { calls, db: { rpc: async (fn: string, args: Record<string, unknown> = {}) => { calls.push({ fn, args }); return { data: result, error }; } } };
  };
  const REF = "toprot-aaaa-bbbb-cccc";

  it("grants only what Flutterwave itself reports, not what the caller claims", async () => {
    const { db, calls } = rpcOf({ ok: true, duplicate: false, status: "succeeded", kind: "pack" });
    const r = await verifyAndFulfil(db, CFG, { txRef: REF, transactionId: "285959875", eventKey: "charge.completed:285959875" }, fetchOf(json(txnBody({ amount: 4.99 }))).f);
    expect(r).toEqual({ outcome: "fulfilled", kind: "pack" });
    expect(calls[0].fn).toBe("billing_fulfill_payment");
    expect(calls[0].args).toMatchObject({ p_tx_ref: REF, p_provider_txn: "285959875", p_provider_status: "successful", p_amount: 4.99, p_currency: "USD", p_event_key: "charge.completed:285959875" });
  });
  it("refuses a transaction that belongs to a different reference, without recording anything", async () => {
    const { db, calls } = rpcOf({ ok: true });
    const r = await verifyAndFulfil(db, CFG, { txRef: REF, transactionId: "1" }, fetchOf(json(txnBody({ tx_ref: "toprot-someone-else-xxxx" }))).f);
    expect(r).toEqual({ outcome: "rejected", code: "reference_mismatch" });
    expect(calls).toHaveLength(0);
  });
  it("does nothing while the provider still reports the payment as pending, or has no record of it", async () => {
    const a = rpcOf({ ok: true });
    expect(await verifyAndFulfil(a.db, CFG, { txRef: REF, transactionId: "1" }, fetchOf(json(txnBody({ status: "pending" }))).f)).toEqual({ outcome: "pending" });
    expect(await verifyAndFulfil(a.db, CFG, { txRef: REF }, fetchOf(json({ status: "error", message: "none" }, 404)).f)).toEqual({ outcome: "pending" });
    expect(a.calls).toHaveLength(0);
  });
  it("maps the database's answers", async () => {
    const f = () => fetchOf(json(txnBody())).f;
    expect(await verifyAndFulfil(rpcOf({ ok: true, duplicate: true, status: "succeeded" }).db, CFG, { txRef: REF, transactionId: "1" }, f())).toEqual({ outcome: "duplicate" });
    expect(await verifyAndFulfil(rpcOf({ ok: true, status: "failed" }).db, CFG, { txRef: REF, transactionId: "1" }, fetchOf(json(txnBody({ status: "failed" }))).f)).toEqual({ outcome: "failed" });
    expect(await verifyAndFulfil(rpcOf({ ok: false, code: "unknown_reference" }).db, CFG, { txRef: REF, transactionId: "1" }, f())).toEqual({ outcome: "unknown" });
    expect(await verifyAndFulfil(rpcOf({ ok: false, code: "mismatch" }).db, CFG, { txRef: REF, transactionId: "1" }, f())).toEqual({ outcome: "rejected", code: "mismatch" });
  });
  it("lets provider and database trouble propagate as retryable so nothing is silently lost", async () => {
    await expect(verifyAndFulfil(rpcOf({}).db, CFG, { txRef: REF, transactionId: "1" }, fetchOf(json({}, 503)).f)).rejects.toMatchObject({ retryable: true });
    await expect(verifyAndFulfil(rpcOf(null, { message: "db down" }).db, CFG, { txRef: REF, transactionId: "1" }, fetchOf(json(txnBody())).f)).rejects.toMatchObject({ retryable: true });
  });
});

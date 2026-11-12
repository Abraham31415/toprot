import { describe, expect, it } from "vitest";
import { acceptingRealPayments, paymentsMode } from "../provider";

const SECRET = "whsec_" + Buffer.from("a-test-webhook-secret-value-0123456789").toString("base64");

describe("payments mode", () => {
  it("is off with nothing configured, so no purchase is offered", () => {
    expect(paymentsMode({})).toBe("off");
    expect(acceptingRealPayments({})).toBe(false);
  });

  it("is off while Dodo is only half configured", () => {
    expect(paymentsMode({ DODO_PAYMENTS_API_KEY: "dodo_test_abc" })).toBe("off");
    expect(acceptingRealPayments({ DODO_PAYMENTS_API_KEY: "dodo_test_abc" })).toBe(false);
  });

  it("is test with Dodo test keys, and does not count as accepting real payments", () => {
    const env = { DODO_PAYMENTS_API_KEY: "dodo_test_abc", DODO_PAYMENTS_WEBHOOK_SECRET: SECRET };
    expect(paymentsMode(env)).toBe("test");
    expect(acceptingRealPayments(env)).toBe(false);
  });

  it("treats a live key as off until live payments are switched on, because checkout refuses it", () => {
    const env = { DODO_PAYMENTS_API_KEY: "dodo_live_abc", DODO_PAYMENTS_WEBHOOK_SECRET: SECRET };
    expect(paymentsMode(env)).toBe("off");
    expect(acceptingRealPayments(env)).toBe(false);
  });

  it("is live only with a live key, the webhook secret and BILLING_LIVE_ENABLED=true", () => {
    const env = { DODO_PAYMENTS_API_KEY: "dodo_live_abc", DODO_PAYMENTS_WEBHOOK_SECRET: SECRET, BILLING_LIVE_ENABLED: "true" };
    expect(paymentsMode(env)).toBe("live");
    expect(acceptingRealPayments(env)).toBe(true);
    expect(acceptingRealPayments({ ...env, BILLING_LIVE_ENABLED: "yes" })).toBe(false);
  });

  it("a test key stays test even when the live flag is set", () => {
    const env = { DODO_PAYMENTS_API_KEY: "dodo_test_abc", DODO_PAYMENTS_WEBHOOK_SECRET: SECRET, BILLING_LIVE_ENABLED: "true" };
    expect(paymentsMode(env)).toBe("test");
    expect(acceptingRealPayments(env)).toBe(false);
  });

  it("applies the same rule to the Flutterwave fallback", () => {
    const base = { FLW_WEBHOOK_HASH: "hash-1234567890" };
    expect(paymentsMode({ ...base, FLW_SECRET_KEY: "FLWSECK_TEST-abc" })).toBe("test");
    expect(acceptingRealPayments({ ...base, FLW_SECRET_KEY: "FLWSECK_TEST-abc" })).toBe(false);
    expect(paymentsMode({ ...base, FLW_SECRET_KEY: "FLWSECK-abc" })).toBe("off");
    expect(acceptingRealPayments({ ...base, FLW_SECRET_KEY: "FLWSECK-abc", BILLING_LIVE_ENABLED: "true" })).toBe(true);
  });
});

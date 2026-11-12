import { describe, expect, it, vi } from "vitest";
import { onRequestError } from "../instrumentation";

describe("request error logging", () => {
  it("logs one structured line with the route pattern, not the real address, and a shortened message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("boom ".repeat(200)), { digest: "abc123" });
    await onRequestError(err, { path: "/billing/return?payment_id=pay_SECRET&token=tok_SECRET", method: "GET", headers: {} }, { routerKind: "App Router", routePath: "/billing/return", routeType: "route", renderSource: undefined, revalidateReason: undefined } as never);
    const line = String(spy.mock.calls[0][0]);
    const entry = JSON.parse(line);
    expect(entry).toMatchObject({ evt: "request_error", method: "GET", route: "/billing/return", digest: "abc123", name: "Error" });
    expect(entry.message.length).toBeLessThanOrEqual(300);
    expect(line).not.toContain("SECRET");
    spy.mockRestore();
  });
});

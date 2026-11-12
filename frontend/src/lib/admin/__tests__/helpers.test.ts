import { describe, expect, it, vi } from "vitest";
import { dayOf, parseRange, startOfDay } from "../range";
import { adminErrorMessage, money, moneyList, NA, num, pct } from "../format";
import { csvCell, toCsv } from "../csv";
import { anthropicReconciliation } from "../anthropic-cost";
import { recentDeployments } from "../deployments";
import { monthlyBudgetExceeded } from "@/lib/ai/monthly";

const NOW = new Date("2026-11-12T22:30:00Z"); // 01:30 on 13 November in Kampala (UTC+3), still the 12th in UTC

describe("date ranges", () => {
  it("works out today in the chosen timezone, not the server's", () => {
    expect(dayOf(NOW, "UTC")).toBe("2026-11-12");
    expect(dayOf(NOW, "Africa/Kampala")).toBe("2026-11-13");
    const r = parseRange({ range: "today" }, "Africa/Kampala", NOW);
    expect(r.from.toISOString()).toBe("2026-11-12T21:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-11-13T21:00:00.000Z");
    expect(r.tz).toBe("Africa/Kampala");
  });

  it("covers whole days for the 7, 30 and 90 day presets, ending with today", () => {
    for (const [key, days] of [["7d", 7], ["30d", 30], ["90d", 90]] as const) {
      const r = parseRange({ range: key }, "UTC", NOW);
      expect(r.to.toISOString()).toBe("2026-11-13T00:00:00.000Z");
      expect((r.to.getTime() - r.from.getTime()) / 86400000).toBe(days);
      expect(r.toDay).toBe("2026-11-12");
    }
  });

  it("defaults to 30 days when the preset is missing or unknown", () => {
    expect(parseRange({}, "UTC", NOW).key).toBe("30d");
    expect(parseRange({ range: "forever" }, "UTC", NOW).key).toBe("30d");
  });

  it("accepts a custom range, treating the end date as included", () => {
    const r = parseRange({ range: "custom", from: "2026-11-01", to: "2026-11-05" }, "UTC", NOW);
    expect(r.key).toBe("custom");
    expect(r.from.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-11-06T00:00:00.000Z");
    expect(r.error).toBeUndefined();
    expect(parseRange({ range: "custom", from: "2026-11-03", to: "2026-11-03" }, "UTC", NOW).label).toBe("2026-11-03");
  });

  it("rejects bad custom ranges with a message and a safe fallback", () => {
    expect(parseRange({ range: "custom", from: "2026-11-05" }, "UTC", NOW).error).toMatch(/both dates/);
    expect(parseRange({ range: "custom", from: "11/05/2026", to: "11/06/2026" }, "UTC", NOW).error).toMatch(/YYYY-MM-DD/);
    expect(parseRange({ range: "custom", from: "2026-11-09", to: "2026-11-02" }, "UTC", NOW).error).toMatch(/after the end/);
    expect(parseRange({ range: "custom", from: "2024-01-01", to: "2026-11-01" }, "UTC", NOW).error).toMatch(/at most 400 days/);
    const future = parseRange({ range: "custom", from: "2026-11-10", to: "2027-01-01" }, "UTC", NOW);
    expect(future.error).toMatch(/future/);
    expect(future.toDay).toBe("2026-11-12");
  });

  it("handles a day that is 23 or 25 hours long at a daylight saving change", () => {
    const start = startOfDay("2026-03-08", "America/New_York");
    const next = startOfDay("2026-03-09", "America/New_York");
    expect((next.getTime() - start.getTime()) / 3600000).toBe(23);
    expect((startOfDay("2026-11-02", "America/New_York").getTime() - startOfDay("2026-11-01", "America/New_York").getTime()) / 3600000).toBe(25);
  });
});

describe("formatting", () => {
  it("shows missing data as Not available and never as zero", () => {
    expect(num(null)).toBe(NA);
    expect(num(undefined)).toBe(NA);
    expect(num(0)).toBe("0");
    expect(money(null)).toBe(NA);
    expect(pct(1, 0)).toBe(NA);
  });
  it("lists currencies separately and never adds them together", () => {
    expect(moneyList([{ currency: "USD", amount: 12.98 }, { currency: "KES", amount: 1000 }])).toContain("+");
    expect(moneyList([])).toBe(money(0));
    expect(money(7.99)).toContain("7.99");
    expect(pct(25, 200)).toBe("12.5%");
  });
  it("explains database errors in plain language and never leaks the raw message for unknown ones", () => {
    expect(adminErrorMessage("ERROR: reason_required")).toMatch(/reason/i);
    expect(adminErrorMessage("read_only_admin")).toMatch(/read-only/);
    expect(adminErrorMessage("rate_limited")).toMatch(/Too many/);
    expect(adminErrorMessage("daily_limit_reached")).toMatch(/daily limit/);
    expect(adminErrorMessage("relation \"secret_table\" does not exist")).not.toContain("secret_table");
  });
});

describe("csv", () => {
  it("quotes cells with commas, quotes and line breaks", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
  it("neutralises cells a spreadsheet would run as a formula", () => {
    for (const bad of ["=SUM(A1)", "+1", "-1", "@cmd", "\tx"]) expect(csvCell(bad).startsWith("'")).toBe(true);
    expect(toCsv(["a", "b"], [["=1", "ok"]])).toBe("a,b\r\n'=1,ok\r\n");
  });
});

describe("Anthropic cost reconciliation", () => {
  const page = (cents: string[], next: string | null) => new Response(JSON.stringify({ data: [{ results: cents.map((amount) => ({ amount, currency: "USD" })) }], has_more: !!next, next_page: next }), { status: 200 });

  it("does nothing without an admin key", async () => {
    vi.stubEnv("ANTHROPIC_ADMIN_API_KEY", "");
    expect(await anthropicReconciliation(NOW, NOW)).toEqual({ status: "not_configured" });
    vi.unstubAllEnvs();
  });
  it("adds up every page, converting cents to dollars, and sends the key only as a header", async () => {
    vi.stubEnv("ANTHROPIC_ADMIN_API_KEY", "sk-ant-admin-secret");
    const calls: string[] = [];
    const f = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push(String(url));
      expect(JSON.stringify(init?.headers)).toContain("sk-ant-admin-secret");
      return calls.length === 1 ? page(["123.45", "100"], "page_2") : page(["50"], null);
    });
    const r = await anthropicReconciliation(new Date("2026-11-01Z"), new Date("2026-11-08Z"), f as unknown as typeof fetch);
    expect(r.status).toBe("ok");
    expect((r as { costUsd: number }).costUsd).toBeCloseTo(2.7345, 6);
    expect(calls[0]).toContain("/v1/organizations/cost_report");
    expect(calls[0]).not.toContain("secret");
    expect(calls[1]).toContain("page=page_2");
    vi.unstubAllEnvs();
  });
  it("reports failures without ever including the key", async () => {
    vi.stubEnv("ANTHROPIC_ADMIN_API_KEY", "sk-ant-admin-secret");
    const bad = await anthropicReconciliation(NOW, NOW, (async () => new Response("no", { status: 401 })) as unknown as typeof fetch);
    expect(bad.status).toBe("error");
    expect(JSON.stringify(bad)).not.toContain("secret");
    const down = await anthropicReconciliation(NOW, NOW, (async () => { throw new Error("connect sk-ant-admin-secret"); }) as unknown as typeof fetch);
    expect(JSON.stringify(down)).not.toContain("secret");
    vi.unstubAllEnvs();
  });
});

describe("deployments", () => {
  it("is not configured without a token and project", async () => {
    vi.stubEnv("VERCEL_API_TOKEN", ""); vi.stubEnv("VERCEL_PROJECT_ID", "");
    expect(await recentDeployments()).toEqual({ status: "not_configured" });
    vi.unstubAllEnvs();
  });
  it("lists deployments and keeps the token out of errors", async () => {
    vi.stubEnv("VERCEL_API_TOKEN", "tok_secret"); vi.stubEnv("VERCEL_PROJECT_ID", "prj_1");
    const ok = await recentDeployments((async () => new Response(JSON.stringify({ deployments: [{ uid: "d1", url: "x.vercel.app", state: "READY", target: "production", created: 1, meta: { githubCommitSha: "abcdef123456", githubCommitMessage: "feat: x\nbody" } }] }), { status: 200 })) as unknown as typeof fetch);
    expect(ok).toMatchObject({ status: "ok", items: [{ id: "d1", state: "READY", commit: "abcdef1", message: "feat: x" }] });
    const bad = await recentDeployments((async () => new Response("", { status: 403 })) as unknown as typeof fetch);
    expect(JSON.stringify(bad)).not.toContain("tok_secret");
    vi.unstubAllEnvs();
  });
});

describe("monthly AI budget guard", () => {
  const db = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) }) as never;
  it("stops requests once the month's spend reaches the ceiling", async () => {
    expect(await monthlyBudgetExceeded(db({ budget_micro_usd: 100_000_000, spent_micro_usd: 100_000_000 }))).toBe(true);
    expect(await monthlyBudgetExceeded(db({ budget_micro_usd: "100000000", spent_micro_usd: "100000001" }))).toBe(true);
  });
  it("allows requests under the ceiling, with no ceiling, and when the check cannot run", async () => {
    expect(await monthlyBudgetExceeded(db({ budget_micro_usd: 100_000_000, spent_micro_usd: 99_999_999 }))).toBe(false);
    expect(await monthlyBudgetExceeded(db({ budget_micro_usd: 0, spent_micro_usd: 5_000_000_000 }))).toBe(false);
    expect(await monthlyBudgetExceeded(db(null, { message: "function does not exist" }))).toBe(false);
    expect(await monthlyBudgetExceeded({ rpc: async () => { throw new Error("down"); } } as never)).toBe(false);
  });
});

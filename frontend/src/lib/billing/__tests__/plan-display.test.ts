import { describe, expect, it } from "vitest";
import type { Catalog, PlanView } from "../catalog";
import { comparisonTable, planCards, teamTerms } from "../plan-display";

// The catalog as the final configuration migration (20261128090000) seeds it. The database test (plans-final.db.test.ts) checks the
// database holds these values; this test checks what the pricing and billing pages show for them.
const plan = (p: Partial<PlanView> & Pick<PlanView, "key" | "name">): PlanView => ({
  tagline: "", isPaid: true, monthlyCredits: 0, introCredits: 0, maxProjects: null, aiFeatures: [], bullets: [], prices: [], active: true, audience: "individual", sort: 0, ...p,
});
const catalog: Catalog = {
  plans: [
    plan({ key: "free", name: "Free", isPaid: false, introCredits: 150, maxProjects: 3, sort: 0 }),
    plan({ key: "pro", name: "Toprot Pro", monthlyCredits: 2000, maxProjects: 25, prices: [{ currency: "USD", amount: 7.99 }], sort: 1 }),
    plan({ key: "advanced", name: "Toprot Advanced", monthlyCredits: 5000, maxProjects: 50, prices: [{ currency: "USD", amount: 15.99 }], active: false, sort: 2 }),
    plan({ key: "team", name: "Toprot Teams", monthlyCredits: 7500, maxProjects: null, prices: [{ currency: "USD", amount: 25 }], active: false, audience: "team", sort: 3 }),
  ],
  packs: [
    { key: "credits_2000", name: "2,000", credits: 2000, expiryDays: 365, prices: [{ currency: "USD", amount: 4.99 }] },
    { key: "credits_5000", name: "5,000", credits: 5000, expiryDays: 365, prices: [{ currency: "USD", amount: 9.99 }] },
    { key: "credits_10000", name: "10,000", credits: 10000, expiryDays: 365, prices: [{ currency: "USD", amount: 16.99 }] },
  ],
  currencies: ["USD"],
  seatPrices: [{ currency: "USD", amount: 6 }],
};
const team = teamTerms([{ key: "team_base_paid_seats", value_num: 3 }, { key: "team_seat_monthly_credits", value_num: 2000 }]);

describe("pricing display", () => {
  it("shows the four plans in order with their prices, credits, renewal terms and project limits", () => {
    const cards = planCards(catalog, team);
    expect(cards.map((c) => c.key)).toEqual(["free", "pro", "advanced", "team"]);
    const [free, pro, adv, tm] = cards;
    expect(free).toMatchObject({ price: "US$0.00", period: "forever", credits: "150 one-time introductory AI credits", projects: "Up to 3 projects" });
    expect(free.renewal).toMatch(/once per account and do not reset/);
    expect(pro).toMatchObject({ price: "US$7.99", period: "per month", credits: "2,000 AI credits each month", projects: "Up to 25 projects", purchasable: true });
    expect(adv).toMatchObject({ price: "US$15.99", credits: "5,000 AI credits each month", projects: "Up to 50 projects", purchasable: false });
    expect(tm).toMatchObject({ price: "US$25.00", period: "per month for 3 seats", projects: "Unlimited team projects (fair use)", purchasable: false, audience: "team" });
    expect(tm.credits).toBe("7,500 shared AI credits each month, plus 2,000 for each extra paid seat");
    expect(tm.seats).toBe("Extra seats US$6.00 per seat per month");
    expect(tm.collaboration).toMatch(/Shared projects, datasets and reports, team workspaces, role-based permissions and team administration/);
    for (const c of [pro, adv, tm]) expect(c.renewal).toMatch(/unused ones expire at the end of the period/);
  });

  it("describes Data Studio access from the statistical entitlements", () => {
    const [free, pro, adv, tm] = planCards(catalog, team);
    expect(free.statistics).toMatch(/Essential descriptive and common inferential/);
    expect(pro.statistics).toMatch(/reliability, Bland-Altman agreement, bootstrapping/);
    expect(adv.statistics).toMatch(/survival analysis, Cox regression, Mantel-Haenszel and PCA/);
    expect(tm.statistics).toBe(adv.statistics);
  });

  it("builds the comparison table with every plan as a column", () => {
    const t = comparisonTable(catalog, team);
    expect(t.columns).toEqual(["Free", "Toprot Pro", "Toprot Advanced", "Toprot Teams"]);
    const row = (label: string) => t.rows.find((r) => r.label === label)!.values;
    expect(row("Monthly price (USD)")).toEqual(["Free", "US$7.99", "US$15.99", "US$25.00 for 3 seats"]);
    expect(row("Extra seats")).toEqual([false, false, false, "Extra seats US$6.00 per seat per month"]);
    expect(row("Included AI credits")[3]).toMatch(/7,500 shared/);
    expect(row("Extra credit packs")).toEqual([false, true, true, true]);
    expect(row("Cox proportional hazards")).toEqual([false, false, true, true]);
    expect(row("Bland-Altman agreement")).toEqual([false, true, true, true]);
    expect(row("Team workspaces and role-based permissions")).toEqual([false, false, false, true]);
    for (const r of t.rows) expect(r.values).toHaveLength(4);
  });

  it("falls back to the configured Team terms when settings cannot be read", () => {
    expect(teamTerms(null)).toEqual({ baseSeats: 3, seatCredits: 2000 });
  });
});

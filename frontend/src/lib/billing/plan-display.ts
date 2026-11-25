// What the pricing page and the billing page say about each plan, built from the billing catalog (plans, prices and packs in Postgres) and
// the Data Studio entitlements (lib/datastudio/entitlements.ts). Numbers are never written here; only the wording around them is.

import { formatMoney, type Catalog, type PlanView } from "./catalog";
import { PLAN_KEYS, PLAN_METHOD_TIER, TIER_SUMMARY, planComparison, type PlanKey } from "@/lib/datastudio/entitlements";

export type TeamTerms = { baseSeats: number; seatCredits: number };

export type PlanCard = {
  key: PlanKey; name: string; tagline: string;
  /** "$7.99", or "-" when no USD price is set. */
  price: string; period: string;
  credits: string; renewal: string; projects: string; statistics: string;
  collaboration: string | null; seats: string | null;
  /** Bullet text stored with the plan in the database. */
  bullets: string[];
  /** Checkout is switched on for this plan (plans.active). */
  purchasable: boolean;
  audience: "individual" | "team";
};

const usd = (p: PlanView) => p.prices.find((x) => x.currency === "USD") ?? null;
const num = (n: number) => n.toLocaleString("en-US");

export function planCard(p: PlanView, catalog: Catalog, team: TeamTerms): PlanCard {
  const key = p.key as PlanKey;
  const price = usd(p);
  const seatPrice = key === "team" ? catalog.seatPrices.find((x) => x.currency === "USD") ?? null : null;
  const isTeam = p.audience === "team";
  return {
    key, name: p.name, tagline: p.tagline, bullets: p.bullets, purchasable: p.active, audience: p.audience,
    price: p.isPaid ? (price ? formatMoney(price.amount, price.currency) : "-") : formatMoney(0, "USD"),
    period: p.isPaid ? (isTeam ? `per month for ${team.baseSeats} seats` : "per month") : "forever",
    credits: !p.isPaid
      ? `${num(p.introCredits)} one-time introductory AI credits`
      : isTeam
        ? `${num(p.monthlyCredits)} shared AI credits each month, plus ${num(team.seatCredits)} for each extra paid seat`
        : `${num(p.monthlyCredits)} AI credits each month`,
    renewal: !p.isPaid
      ? "Introductory credits are given once per account and do not reset"
      : isTeam
        ? "Shared credits go to the team pool each paid period; unused ones expire at the end of the period"
        : "Credits renew with each paid billing period; unused ones expire at the end of the period",
    projects: p.maxProjects === null ? (isTeam ? "Unlimited team projects (fair use)" : "Unlimited projects") : `Up to ${num(p.maxProjects)} projects`,
    statistics: key in PLAN_METHOD_TIER ? TIER_SUMMARY[PLAN_METHOD_TIER[key]] : "",
    collaboration: isTeam ? "Shared projects, datasets and reports, team workspaces, role-based permissions and team administration" : null,
    seats: isTeam ? (seatPrice ? `Extra seats ${formatMoney(seatPrice.amount, seatPrice.currency)} per seat per month` : "Extra seats per month") : null,
  };
}

/** The four plans in upgrade order (Free, Pro, Advanced, Team), skipping any that are missing from the catalog. */
export function planCards(catalog: Catalog, team: TeamTerms): PlanCard[] {
  return PLAN_KEYS.map((k) => catalog.plans.find((p) => p.key === k)).filter((p): p is PlanView => !!p).map((p) => planCard(p, catalog, team));
}

export type ComparisonTable = { columns: string[]; rows: { group: string; label: string; values: (string | boolean)[] }[] };

/** The full plan comparison: price, AI credits, projects, Data Studio statistics and collaboration. Columns follow planCards(). */
export function comparisonTable(catalog: Catalog, team: TeamTerms): ComparisonTable {
  const cards = planCards(catalog, team);
  const at = (k: PlanKey) => cards.find((c) => c.key === k);
  const pick = (f: (c: PlanCard) => string | boolean) => PLAN_KEYS.filter((k) => at(k)).map((k) => f(at(k)!));
  const stats = planComparison();
  const idx = PLAN_KEYS.map((k, i) => (at(k) ? i : -1)).filter((i) => i >= 0);
  return {
    columns: cards.map((c) => c.name),
    rows: [
      { group: "Price", label: "Monthly price (USD)", values: pick((c) => c.key === "free" ? "Free" : `${c.price}${c.key === "team" ? ` for ${team.baseSeats} seats` : ""}`) },
      { group: "Price", label: "Extra seats", values: pick((c) => c.seats ?? false) },
      { group: "AI credits", label: "Included AI credits", values: pick((c) => c.credits) },
      { group: "AI credits", label: "Renewal", values: pick((c) => c.renewal) },
      { group: "AI credits", label: "Extra credit packs", values: pick((c) => c.key !== "free") },
      { group: "Workspace", label: "Projects", values: pick((c) => c.projects) },
      ...stats.rows.map((r) => ({ ...r, values: idx.map((i) => r.values[i]) })),
    ],
  };
}

/** Team terms from billing_settings rows (falls back to the configured defaults when a row cannot be read). */
export function teamTerms(rows: { key: string; value_num: number | string | null }[] | null | undefined): TeamTerms {
  const get = (k: string, d: number) => { const v = rows?.find((r) => r.key === k)?.value_num; return v === null || v === undefined || Number.isNaN(Number(v)) ? d : Number(v); };
  return { baseSeats: get("team_base_paid_seats", 3), seatCredits: get("team_seat_monthly_credits", 2000) };
}

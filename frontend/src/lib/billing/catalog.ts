import type { SupabaseClient } from "@supabase/supabase-js";

// Plans, prices and credit packs are rows in Postgres (tables plans, billing_prices, credit_packs), edited with SQL.
// Nothing about them is hard-coded in the application: the pricing page, the billing page and checkout all read this.

export type Price = { currency: string; amount: number };
export type PlanView = {
  key: string; name: string; tagline: string; isPaid: boolean; monthlyCredits: number; introCredits: number;
  maxProjects: number | null; aiFeatures: string[]; bullets: string[]; prices: Price[];
};
export type PackView = { key: string; name: string; credits: number; expiryDays: number; prices: Price[] };
export type Catalog = { plans: PlanView[]; packs: PackView[]; currencies: string[] };

type Row = Record<string, unknown>;
const prices = (rows: Row[], kind: string, key: string): Price[] =>
  rows.filter((p) => p.kind === kind && p.product_key === key).map((p) => ({ currency: String(p.currency), amount: Number(p.amount) })).sort((a, b) => (a.currency === "USD" ? -1 : b.currency === "USD" ? 1 : a.currency.localeCompare(b.currency)));

export async function loadCatalog(db: SupabaseClient): Promise<Catalog> {
  const [{ data: plans }, { data: packs }, { data: pr }] = await Promise.all([
    db.from("plans").select("*").eq("active", true).order("sort"),
    db.from("credit_packs").select("*").eq("active", true).order("sort"),
    db.from("billing_prices").select("kind, product_key, currency, amount").eq("active", true),
  ]);
  const priceRows = (pr ?? []) as Row[];
  return {
    plans: ((plans ?? []) as Row[]).map((p) => ({
      key: String(p.plan_key), name: String(p.name), tagline: String(p.tagline ?? ""), isPaid: p.is_paid === true,
      monthlyCredits: Number(p.monthly_credits), introCredits: Number(p.intro_credits), maxProjects: p.max_projects === null ? null : Number(p.max_projects),
      aiFeatures: (p.ai_features as string[]) ?? [], bullets: (p.bullets as string[]) ?? [], prices: prices(priceRows, "plan", String(p.plan_key)),
    })),
    packs: ((packs ?? []) as Row[]).map((p) => ({ key: String(p.pack_key), name: String(p.name), credits: Number(p.credits), expiryDays: Number(p.expiry_days), prices: prices(priceRows, "pack", String(p.pack_key)) })),
    currencies: [...new Set(priceRows.map((p) => String(p.currency)))].sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b))),
  };
}

export function formatMoney(amount: number, currency: string): string {
  try {
    const zeroDecimal = ["UGX", "RWF", "KES"].includes(currency) && Number.isInteger(amount);
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: zeroDecimal ? 0 : 2, maximumFractionDigits: zeroDecimal ? 0 : 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

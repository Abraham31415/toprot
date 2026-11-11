import type { SupabaseClient } from "@supabase/supabase-js";
import { getHeadroom, type Headroom } from "@/lib/ai/ledger";

// Everything the user's billing page shows. Read with the service role but ALWAYS filtered by the signed-in user's id,
// which comes from their session on the server, never from the request.

export type SubscriptionView = { planKey: string; status: string; periodStart: string | null; periodEnd: string | null; provider: string | null; /** The provider renews it automatically. */ autoRenews: boolean; cancelAtPeriodEnd: boolean };
export type LotView = { id: string; remainingMcr: number; grantedMcr: number; expiresAt: string; note: string | null };
export type OperationView = { id: string; feature: string; model: string; status: string; chargedMcr: number; createdAt: string };
export type PaymentView = { id: string; kind: string; product: string; amount: number; currency: string; status: string; method: string | null; createdAt: string };
export type TransactionView = { id: number; kind: string; pool: string; amountMcr: number; note: string | null; createdAt: string };
export type BillingOverview = {
  headroom: Headroom | null;
  /** Why the balance could not be read (no secrets), to make a configuration problem diagnosable. */
  headroomError: string | null;
  subscription: SubscriptionView | null;
  lots: LotView[];
  operations: OperationView[];
  payments: PaymentView[];
  transactions: TransactionView[];
};

type Row = Record<string, unknown>;

export async function loadBillingOverview(db: SupabaseClient, userId: string): Promise<BillingOverview> {
  let headroomError: string | null = null;
  const [headroom, sub, lots, ops, pay, tx] = await Promise.all([
    getHeadroom(db, userId).catch((e: unknown) => { headroomError = e instanceof Error ? e.message.slice(0, 200) : "unknown error"; return null; }),
    db.from("ai_subscriptions").select("plan, status, current_period_start, current_period_end, provider, provider_subscription_id, cancel_at_period_end").eq("user_id", userId).maybeSingle(),
    db.from("ai_credit_lots").select("id, credits_mcr, used_mcr, expires_at, note").eq("user_id", userId).is("expired_at", null).gt("expires_at", new Date().toISOString()).order("expires_at"),
    db.from("ai_usage_events").select("id, feature_key, model_id, status, charged_mcr, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(15),
    db.from("payments").select("id, kind, product_key, amount, currency, status, method, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
    db.from("ai_credit_transactions").select("id, kind, pool, amount_mcr, note, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(25),
  ]);
  const s = sub.data as Row | null;
  return {
    headroom,
    headroomError,
    subscription: s ? { planKey: String(s.plan), status: String(s.status), periodStart: (s.current_period_start as string | null) ?? null, periodEnd: (s.current_period_end as string | null) ?? null, provider: (s.provider as string | null) ?? null, autoRenews: !!s.provider_subscription_id, cancelAtPeriodEnd: s.cancel_at_period_end === true } : null,
    lots: ((lots.data ?? []) as Row[]).map((l) => ({ id: String(l.id), remainingMcr: Number(l.credits_mcr) - Number(l.used_mcr), grantedMcr: Number(l.credits_mcr), expiresAt: String(l.expires_at), note: (l.note as string | null) ?? null })).filter((l) => l.remainingMcr > 0),
    operations: ((ops.data ?? []) as Row[]).map((e) => ({ id: String(e.id), feature: String(e.feature_key), model: String(e.model_id), status: String(e.status), chargedMcr: Number(e.charged_mcr), createdAt: String(e.created_at) })),
    payments: ((pay.data ?? []) as Row[]).map((p) => ({ id: String(p.id), kind: String(p.kind), product: String(p.product_key), amount: Number(p.amount), currency: String(p.currency), status: String(p.status), method: (p.method as string | null) ?? null, createdAt: String(p.created_at) })),
    transactions: ((tx.data ?? []) as Row[]).map((t) => ({ id: Number(t.id), kind: String(t.kind), pool: String(t.pool), amountMcr: Number(t.amount_mcr), note: (t.note as string | null) ?? null, createdAt: String(t.created_at) })),
  };
}

export const credits = (mcr: number) => (mcr / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 });

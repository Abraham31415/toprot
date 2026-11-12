import type { RpcClient } from "./types";

/**
 * Has the platform spent its monthly AI ceiling? The ceiling is set in the admin console (ai_settings, platform_monthly_budget_micro_usd;
 * 0 means no ceiling). It is an extra guard on top of the daily budget, so when the database does not have the function yet, or the
 * lookup fails, this answers false and the daily budget still applies. Nothing is reserved or charged before this check.
 */
export async function monthlyBudgetExceeded(db: RpcClient): Promise<boolean> {
  try {
    const m = await db.rpc("ai_platform_month_status", {});
    const d = m.data as { budget_micro_usd?: number | string; spent_micro_usd?: number | string } | null;
    return !m.error && !!d && Number(d.budget_micro_usd) > 0 && Number(d.spent_micro_usd) >= Number(d.budget_micro_usd);
  } catch {
    return false;
  }
}

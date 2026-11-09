import type { RpcClient } from "./types";

interface AlertRow {
  day: string;
  threshold_pct: number;
  spent_micro_usd: number;
  budget_micro_usd: number;
}

export type AlertSender = (to: string, subject: string, text: string) => Promise<void>;

/** Sends through Resend's REST API (already used by ToProt). No extra dependency. */
export const resendSender: AlertSender = async (to, subject, text) => {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const from = process.env.AI_ALERT_FROM_EMAIL || "ToProt Alerts <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
};

function usd(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

/**
 * Delivers budget-threshold alerts (50/75/90/100 percent of the daily platform budget) to the
 * administrator. Alerts are recorded in Postgres when a threshold is first crossed; here each
 * pending one is claimed (so concurrent requests do not double-send), emailed, and the claim
 * is released on failure so it is retried by the next AI operation. Never throws.
 */
export async function dispatchPendingAlerts(
  db: RpcClient,
  send: AlertSender = resendSender,
  adminEmail: string | undefined = process.env.AI_ADMIN_ALERT_EMAIL,
): Promise<number> {
  try {
    if (!adminEmail) return 0;
    const { data, error } = await db.rpc("ai_claim_pending_alerts", { p_limit: 10 });
    if (error || !Array.isArray(data)) return 0;
    let sent = 0;
    for (const a of data as AlertRow[]) {
      const pct = a.threshold_pct;
      const subject = `ToProt AI budget: ${pct}% of daily limit reached`;
      const text =
        `AI spend for ${a.day} (UTC) has reached ${pct}% of the daily platform budget.\n\n` +
        `Spent: ${usd(a.spent_micro_usd)} of ${usd(a.budget_micro_usd)}.\n` +
        (pct >= 100
          ? "New AI operations are being rejected until tomorrow (UTC) or until the budget is raised in ai_settings.\n"
          : "No action is required yet.\n");
      try {
        await send(adminEmail, subject, text);
        sent += 1;
      } catch (e) {
        console.error(JSON.stringify({ evt: "ai_alert_send_failed", day: a.day, pct, err: String(e) }));
        const rel = await db.rpc("ai_release_alert_claim", { p_day: a.day, p_threshold: pct });
        if (rel.error) {
          console.error(JSON.stringify({ evt: "ai_alert_release_failed", day: a.day, pct, err: rel.error.message }));
        }
      }
    }
    return sent;
  } catch (e) {
    console.error(JSON.stringify({ evt: "ai_alert_dispatch_error", err: String(e) }));
    return 0;
  }
}

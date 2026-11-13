import { sendEmail } from "@/lib/email/send";
import { SITE_URL } from "@/lib/site";
import type { DbLike } from "./service";

// Sends queued notification emails. The database decides what may be sent (quotas, per-person limits, preferences); this only delivers
// and records the provider's answer. A notification is marked emailed only when the provider accepted the message.

type Claimed = { id: string; email: string | null; title: string; body: string | null; link: string | null };

export type DispatchResult = { claimed: number; accepted: number; failed: number; notConfigured: number };

export function notificationEmail(n: Claimed): { subject: string; text: string } {
  const open = n.link ? `\n\nOpen it: ${SITE_URL}${n.link}` : "";
  return {
    subject: n.title,
    text: `${n.title}${n.body ? `\n\n${n.body}` : ""}${open}\n\nYou can choose which emails you get at ${SITE_URL}/notifications`,
  };
}

export async function dispatchNotificationEmails(db: DbLike, send: typeof sendEmail = sendEmail, limit = 10): Promise<DispatchResult> {
  const out: DispatchResult = { claimed: 0, accepted: 0, failed: 0, notConfigured: 0 };
  const { data, error } = await db.rpc("collab_claim_emails", { p_limit: limit });
  if (error || !Array.isArray(data)) return out;
  for (const n of data as Claimed[]) {
    out.claimed++;
    if (!n.email) { await db.rpc("collab_mark_email", { p_id: n.id, p_status: "failed", p_error: "No email address on file", p_message_id: null }); out.failed++; continue; }
    const r = await send({ to: n.email, ...notificationEmail(n) });
    if (r.status === "provider_accepted") { await db.rpc("collab_mark_email", { p_id: n.id, p_status: "provider_accepted", p_error: null, p_message_id: r.id }); out.accepted++; }
    else if (r.status === "not_configured") { await db.rpc("collab_mark_email", { p_id: n.id, p_status: "not_configured", p_error: r.error, p_message_id: null }); out.notConfigured++; }
    else { await db.rpc("collab_mark_email", { p_id: n.id, p_status: "failed", p_error: r.error, p_message_id: null }); out.failed++; }
  }
  return out;
}

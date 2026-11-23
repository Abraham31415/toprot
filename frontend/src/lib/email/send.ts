// Outbound email through Resend's REST API. The result says exactly what happened, and callers must never tell a person that an email
// "was sent" unless the status is provider_accepted (Resend accepted the message; it does not promise inbox delivery).

export type EmailResult =
  | { status: "provider_accepted"; id: string | null }
  | { status: "not_configured"; error: string }
  | { status: "failed"; error: string };

export type EmailMessage = { to: string; subject: string; text: string; html?: string };

export function emailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.RESEND_API_KEY && !!(env.COLLAB_FROM_EMAIL || env.AI_ALERT_FROM_EMAIL);
}

export async function sendEmail(msg: EmailMessage, deps: { fetch?: typeof fetch; env?: Record<string, string | undefined> } = {}): Promise<EmailResult> {
  const env = deps.env ?? process.env;
  const key = env.RESEND_API_KEY;
  const from = env.COLLAB_FROM_EMAIL || env.AI_ALERT_FROM_EMAIL;
  if (!key) return { status: "not_configured", error: "RESEND_API_KEY is not set" };
  if (!from) return { status: "not_configured", error: "COLLAB_FROM_EMAIL is not set" };
  try {
    const res = await (deps.fetch ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: msg.to, subject: msg.subject, text: msg.text, ...(msg.html ? { html: msg.html } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: "failed", error: `Resend responded ${res.status}` };
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    return { status: "provider_accepted", id: body?.id ?? null };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message.slice(0, 200) : "Network error" };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { AdminActionError, adminRpc, requestIp, requireAdmin, requireAdminWrite, runAdminAction, type ActionResult } from "@/lib/admin/auth";
import { hasReason } from "@/lib/admin/format";

// Every action re-checks the administrator on the server, requires a reason, and the database function writes the audit entry itself.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const needReason = (r: string) => { if (!hasReason(r)) throw new AdminActionError("Give a reason of at least 10 characters. It is saved in the audit log."); };

export type PersonResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

export async function investigateAction(_prev: PersonResult | undefined, f: FormData): Promise<PersonResult> {
  try {
    const s = await requireAdmin();
    const email = text(f, "email"); const reason = text(f, "reason");
    if (!email || email.length > 254) return { ok: false, error: "Enter an email address." };
    needReason(reason);
    const data = await adminRpc<Record<string, unknown>>(s, "admin_investigate_person", { p_email: email, p_reason: reason, p_ip: await requestIp() });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof AdminActionError) return { ok: false, error: e.message };
    if (e && typeof e === "object" && "digest" in e) throw e; // redirects and 404s from the access checks
    return { ok: false, error: "That did not work. Try again." };
  }
}

export async function withdrawInvitationAction(_prev: ActionResult | undefined, f: FormData): Promise<ActionResult> {
  return runAdminAction(async () => {
    const s = await requireAdminWrite();
    const kind = text(f, "kind"); const id = text(f, "id"); const reason = text(f, "reason");
    if (!["project", "team"].includes(kind) || !UUID.test(id)) throw new Error("bad id");
    needReason(reason);
    await adminRpc(s, "admin_revoke_invitation", { p_kind: kind, p_invitation: id, p_reason: reason, p_ip: await requestIp() });
    revalidatePath("/admin/teams");
    return "Invitation withdrawn.";
  });
}

export async function teamCreditAction(_prev: ActionResult | undefined, f: FormData): Promise<ActionResult> {
  return runAdminAction(async () => {
    const s = await requireAdminWrite();
    const team = text(f, "team"); const reason = text(f, "reason"); const credits = Number.parseInt(text(f, "credits"), 10);
    if (!UUID.test(team)) throw new Error("bad id");
    if (!Number.isInteger(credits)) throw new AdminActionError("Enter a whole number of credits.");
    needReason(reason);
    await adminRpc(s, "admin_team_credit_grant", { p_team: team, p_credits: credits, p_reason: reason, p_ip: await requestIp() });
    revalidatePath(`/admin/teams/${team}`);
    return `Added ${credits} credits to the team pool.`;
  });
}

export async function teamPoolAction(_prev: ActionResult | undefined, f: FormData): Promise<ActionResult> {
  return runAdminAction(async () => {
    const s = await requireAdminWrite();
    const team = text(f, "team"); const reason = text(f, "reason"); const enabled = text(f, "enabled") === "1";
    if (!UUID.test(team)) throw new Error("bad id");
    needReason(reason);
    await adminRpc(s, "admin_team_pool_set", { p_team: team, p_enabled: enabled, p_reason: reason, p_ip: await requestIp() });
    revalidatePath(`/admin/teams/${team}`);
    return enabled ? "Shared AI credits switched on." : "Shared AI credits switched off.";
  });
}

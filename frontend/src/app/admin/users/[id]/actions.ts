"use server";

import { revalidatePath } from "next/cache";
import { AdminActionError, adminRpc, requestIp, requireAdminWrite, runAdminAction, type ActionResult } from "@/lib/admin/auth";
import { hasReason } from "@/lib/admin/format";

// Every action re-checks the administrator on the server, refuses read-only roles, requires a reason, and writes the audit log
// inside the same database function that makes the change. The browser only sends a form.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function suspensionAction(_prev: ActionResult | undefined, f: FormData): Promise<ActionResult> {
  return runAdminAction(async () => {
    const s = await requireAdminWrite();
    const user = text(f, "user"); const suspend = text(f, "suspend") === "1"; const reason = text(f, "reason");
    if (!UUID.test(user)) throw new Error("bad id");
    if (!hasReason(reason)) throw new AdminActionError("Give a reason of at least 10 characters. It is saved in the audit log.");
    await adminRpc(s, "admin_set_suspension", { p_user: user, p_suspend: suspend, p_reason: reason, p_ip: await requestIp() });
    // Also stop the sign-in service from issuing new sessions. The site itself refuses a suspended account on every request regardless.
    const { error } = await s.db.auth.admin.updateUserById(user, { ban_duration: suspend ? "876000h" : "none" });
    if (error) console.error(JSON.stringify({ evt: "admin_ban_update_failed", suspend }));
    revalidatePath(`/admin/users/${user}`);
    return suspend ? "Account suspended. It cannot use the site until you restore it." : "Account restored.";
  });
}

export async function grantAction(_prev: ActionResult | undefined, f: FormData): Promise<ActionResult> {
  return runAdminAction(async () => {
    const s = await requireAdminWrite();
    const user = text(f, "user"); const reason = text(f, "reason");
    const credits = Number.parseInt(text(f, "credits"), 10); const days = Number.parseInt(text(f, "days"), 10);
    if (!UUID.test(user)) throw new Error("bad id");
    if (!Number.isInteger(credits) || !Number.isInteger(days)) throw new AdminActionError("Enter whole numbers for credits and days.");
    if (!hasReason(reason)) throw new AdminActionError("Give a reason of at least 10 characters. It is saved in the audit log.");
    await adminRpc(s, "admin_grant_credits", { p_user: user, p_credits: credits, p_days: days, p_reason: reason, p_ip: await requestIp() });
    revalidatePath(`/admin/users/${user}`);
    return `Granted ${credits} credits, valid for ${days} days.`;
  });
}

export async function revokeAction(_prev: ActionResult | undefined, f: FormData): Promise<ActionResult> {
  return runAdminAction(async () => {
    const s = await requireAdminWrite();
    const user = text(f, "user"); const lot = text(f, "lot"); const reason = text(f, "reason");
    if (!UUID.test(lot) || !UUID.test(user)) throw new Error("bad id");
    if (!hasReason(reason)) throw new AdminActionError("Give a reason of at least 10 characters. It is saved in the audit log.");
    const r = await adminRpc<{ credits_removed: number }>(s, "admin_revoke_grant", { p_lot: lot, p_reason: reason, p_ip: await requestIp() });
    revalidatePath(`/admin/users/${user}`);
    return `Removed ${r.credits_removed} unused credits from the grant.`;
  });
}

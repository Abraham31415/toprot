"use server";

import { revalidatePath } from "next/cache";
import { AdminActionError, adminRpc, requestIp, requireAdminWrite, runAdminAction, type ActionResult } from "@/lib/admin/auth";
import { hasReason } from "@/lib/admin/format";
import { EDITABLE, type EditableKey } from "@/lib/admin/editable";

// Only the settings listed in lib/admin/editable.ts can be changed, in the units shown, with a reason. The database checks the key and the range
// again and writes old and new values to the audit log.

export async function settingAction(_prev: ActionResult | undefined, f: FormData): Promise<ActionResult> {
  return runAdminAction(async () => {
    const s = await requireAdminWrite();
    const id = String(f.get("key") ?? "") as EditableKey;
    const def = EDITABLE[id];
    if (!def) throw new AdminActionError("That setting cannot be changed here.");
    const reason = String(f.get("reason") ?? "").trim();
    const raw = Number(String(f.get("value") ?? "").trim());
    if (!Number.isFinite(raw) || raw < def.min) throw new AdminActionError(`Enter a number of ${def.min} or more.`);
    if (!hasReason(reason)) throw new AdminActionError("Give a reason of at least 10 characters. It is saved in the audit log.");
    const [scope, key] = id.split(".") as [string, string];
    await adminRpc(s, "admin_set_setting", { p_scope: scope, p_key: key, p_value: Math.round(raw * def.scale * 1000) / 1000, p_reason: reason, p_ip: await requestIp() });
    revalidatePath("/admin/settings");
    return "Saved.";
  });
}

export async function featureLimitsAction(_prev: ActionResult | undefined, f: FormData): Promise<ActionResult> {
  return runAdminAction(async () => {
    const s = await requireAdminWrite();
    const feature = String(f.get("feature") ?? "");
    const reason = String(f.get("reason") ?? "").trim();
    if (!/^[a-z0-9_]{2,60}$/.test(feature)) throw new AdminActionError("That AI feature does not exist.");
    if (!hasReason(reason)) throw new AdminActionError("Give a reason of at least 10 characters. It is saved in the audit log.");
    await adminRpc(s, "admin_set_feature_limits", {
      p_feature: feature, p_max_iterations: Number(f.get("iterations")), p_max_tool_calls: Number(f.get("toolCalls")), p_max_op_cost_usd: Number(f.get("opCost")),
      p_enabled: f.get("enabled") === "1", p_reason: reason, p_ip: await requestIp(),
    });
    revalidatePath("/admin/settings");
    return "Saved.";
  });
}

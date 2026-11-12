"use server";

import { revalidatePath } from "next/cache";
import { adminRpc, requestIp, requireAdminWrite } from "@/lib/admin/auth";

export async function acknowledgeAlert(formData: FormData): Promise<void> {
  const s = await requireAdminWrite();
  const id = Number.parseInt(String(formData.get("alert") ?? ""), 10);
  if (!Number.isInteger(id) || id < 1) return;
  await adminRpc(s, "admin_ack_alert", { p_alert: id, p_ip: await requestIp() });
  revalidatePath("/admin/system");
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/shell";
import { getAdminSession } from "@/lib/admin/auth";

// Nothing under /admin is ever indexed or cached. Each page also checks access on its own (this layout is not re-run on every
// navigation); the layout only draws the frame.
export const metadata: Metadata = { title: { default: "Admin", template: "%s | ToProt Admin" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const s = await getAdminSession();
  let openAlerts = 0;
  try {
    const { count } = await s.db.from("system_alerts").select("id", { count: "exact", head: true }).is("acknowledged_at", null);
    openAlerts = count ?? 0;
  } catch { /* the alerts table may not exist yet */ }
  return (
    <AdminShell email={s.email} role={s.role} openAlerts={openAlerts} mfaWarning={!s.mfaRequired}>
      {children}
    </AdminShell>
  );
}

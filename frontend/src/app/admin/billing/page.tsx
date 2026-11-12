import { redirect } from "next/navigation";

// The old billing report was replaced by the admin console. Its figures now live on Revenue (money), AI Costs (usage by model and
// feature), and System Health (payment failures and unusual usage). Old links keep working.
export default function AdminBillingRedirect() {
  redirect("/admin/revenue");
}

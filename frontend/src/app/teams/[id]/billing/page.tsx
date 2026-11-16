import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeam, teamRpc } from "@/lib/collab/teams";
import { providerReady } from "@/lib/billing/provider";
import { BillingPanel, type AiOverview, type BillingOverview } from "./billing-panel";

export const metadata: Metadata = { title: "Team billing and AI credits", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function TeamBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const db = createAdminClient();
  const t = await getTeam(db, user.id, id);
  if (!t.ok) redirect("/teams");
  if (t.overview.your_role === "guest") redirect(`/teams/${id}/projects`);
  const [bill, ai] = await Promise.all([
    teamRpc<BillingOverview>(db, "team_billing_overview", { p_actor: user.id, p_team: id }),
    teamRpc<AiOverview>(db, "team_ai_overview", { p_actor: user.id, p_team: id }),
  ]);
  if (!bill.data || !ai.data) redirect(`/teams/${id}`);
  const ready = providerReady();
  return <BillingPanel teamId={id} userId={user.id} bill={bill.data} ai={ai.data} paymentsReady={ready.ok} paymentsMessage={ready.ok ? null : ready.message} />;
}

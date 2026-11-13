import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeam } from "@/lib/collab/teams";
import { emailConfigured } from "@/lib/email/send";
import { MembersPanel } from "./members-panel";

export const metadata: Metadata = { title: "Team people", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const t = await getTeam(createAdminClient(), user.id, id);
  if (!t.ok) redirect("/teams");
  return <MembersPanel teamId={id} userId={user.id} overview={t.overview} emailReady={emailConfigured()} />;
}

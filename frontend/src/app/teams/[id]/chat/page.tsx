import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Conversation } from "@/components/collab/conversation";
import { getTeam, teamCan } from "@/lib/collab/teams";
import { listMessages, teamConversation } from "@/lib/collab/messages";

export const metadata: Metadata = { title: "Team chat", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function TeamChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const db = createAdminClient();
  const t = await getTeam(db, user.id, id);
  if (!t.ok || !teamCan(t.overview.your_role, "view_dashboard")) redirect(`/teams/${id}/projects`);
  const { data: me } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  const conv = teamConversation(id);
  const r = await listMessages(db, user.id, conv);
  return (
    <div className="max-w-3xl">
      <p className="mb-3 text-sm text-ink-soft">Chat for the team&apos;s paid members. Guest reviewers are not included. Project conversations are on each project.</p>
      <Conversation conversation={conv} userId={user.id} userName={me?.full_name ?? "Someone"} initial={r.ok ? r.messages : []} canPost />
    </div>
  );
}

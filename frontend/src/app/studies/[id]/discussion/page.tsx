import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StudyNav } from "@/components/study-nav";
import { Conversation } from "@/components/collab/conversation";
import { roleOf } from "@/lib/collab/access";
import { can } from "@/lib/collab/roles";
import { listMessages, projectConversation } from "@/lib/collab/messages";

export const metadata: Metadata = { title: "Project discussion", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function DiscussionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: studyId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: study } = await supabase.from("studies").select("id, title").eq("id", studyId).single();
  if (!study) notFound();
  const role = await roleOf(supabase, studyId);
  if (!role) notFound();
  const { data: me } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  const conv = projectConversation(studyId);
  const r = await listMessages(createAdminClient(), user.id, conv);
  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-4xl px-6 pb-16 pt-10">
        <StudyNav studyId={study.id} active="discussion" />
        <h1 className="text-xl font-semibold text-navy">Discussion</h1>
        <p className="mb-4 mt-1 text-sm text-navy/70">A private conversation for the people on this project. Comments on a specific section are in Review.</p>
        <Conversation conversation={conv} userId={user.id} userName={me?.full_name ?? "Someone"} initial={r.ok ? r.messages : []} canPost={can(role, "comment")} />
      </div>
    </div>
  );
}

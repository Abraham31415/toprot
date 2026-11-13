import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDocuments, getTeam, teamCan } from "@/lib/collab/teams";
import { DocumentsPanel } from "./documents-panel";

export const metadata: Metadata = { title: "Team documents", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const db = createAdminClient();
  const t = await getTeam(db, user.id, id);
  if (!t.ok) redirect("/teams");
  const docs = await getDocuments(db, user.id, id);
  const projects = t.overview.projects.filter((p) => p.your_role === "owner" || p.your_role === "editor").map((p) => ({ id: p.id, title: p.title }));
  return <DocumentsPanel teamId={id} userId={user.id} role={t.overview.your_role} canUpload={teamCan(t.overview.your_role, "upload_documents")} docs={docs} projects={projects} />;
}

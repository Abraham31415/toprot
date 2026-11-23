import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLibrary, getTeam, teamCan } from "@/lib/collab/teams";
import { listWritableStudies } from "@/lib/collab/access";
import { LibraryPanel } from "./library-panel";

export const metadata: Metadata = { title: "Team references", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function TeamReferencesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const db = createAdminClient();
  const t = await getTeam(db, user.id, id);
  if (!t.ok || !teamCan(t.overview.your_role, "view_dashboard")) redirect(`/teams/${id}/projects`);
  const [library, writable] = await Promise.all([getLibrary(db, user.id, id), listWritableStudies()]);
  return <LibraryPanel teamId={id} userId={user.id} isAdmin={t.overview.your_role === "owner" || t.overview.your_role === "administrator"} library={library} projects={writable} />;
}

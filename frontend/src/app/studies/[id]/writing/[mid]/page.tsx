import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { ManuscriptEditor } from "@/components/writing/manuscript-editor";
import type { RefRow } from "@/lib/refs/convert";
import type { Doc } from "@/lib/writing/doc";
import type { TemplateId } from "@/lib/writing/templates";
import { isUuid } from "@/lib/refs/validate";

export const metadata = { title: "Manuscript" };

export default async function ManuscriptPage({ params }: { params: Promise<{ id: string; mid: string }> }) {
  const { id: studyId, mid } = await params;
  if (!isUuid(studyId) || !isUuid(mid)) notFound();
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();

  const [{ data: study }, { data: ms }, { data: refs }] = await Promise.all([
    supabase.from("studies").select("id, title, owner_id").eq("id", studyId).single(),
    supabase.from("manuscripts").select("id, study_id, title, template, style_id, revision, content").eq("id", mid).eq("study_id", studyId).single(),
    supabase.from("study_references").select("*").eq("study_id", studyId).order("display_order", { ascending: true }),
  ]);
  if (!study || !ms) notFound();

  return (
    <div className="min-h-screen bg-paper">
      <ManuscriptEditor
        manuscript={{ id: ms.id, studyId, studyTitle: study.title, title: ms.title, template: ms.template as TemplateId, styleId: ms.style_id, revision: ms.revision, content: ms.content as Doc }}
        references={(refs ?? []) as (RefRow & { id: string })[]}
        readOnly={profile.id !== study.owner_id}
        userId={profile.id}
      />
    </div>
  );
}

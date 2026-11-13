import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { roleOf } from "@/lib/collab/access";
import { can } from "@/lib/collab/roles";
import { StudyNav } from "@/components/study-nav";
import { ProtocolForm } from "./protocol-form";
import { LockPanel } from "./lock-panel";
import { HistoryPanel, type SnapshotRow } from "./history-panel";

export default async function ProtocolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: studyId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  const { data: study } = await supabase
    .from("studies")
    .select("id, title, owner_id, current_enrollment")
    .eq("id", studyId)
    .single();

  if (!study) notFound();

  const { data: version } = await supabase
    .from("protocol_versions")
    .select("*")
    .eq("study_id", studyId)
    .in("status", ["draft", "registered"])
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (!version) notFound();

  const [{ data: objectives }, { data: variables }, { data: studySupervisor }, { data: pendingInvitation }, { data: amendment }] =
    await Promise.all([
      supabase
        .from("protocol_objectives")
        .select("*")
        .eq("protocol_version_id", version.id)
        .order("display_order"),
      supabase
        .from("protocol_variables")
        .select("*")
        .eq("protocol_version_id", version.id)
        .order("display_order"),
      supabase
        .from("project_memberships")
        .select("user_id, profiles!user_id(id, full_name)")
        .eq("study_id", studyId)
        .eq("role", "reviewer")
        .order("created_at")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("project_invitations")
        .select("id, invited_email:email")
        .eq("study_id", studyId)
        .eq("role", "reviewer")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("amendments")
        .select("status, reason")
        .eq("new_version_id", version.id)
        .maybeSingle(),
    ]);

  const role = await roleOf(supabase, studyId);
  const isOwner = role === "owner";
  const supervisorProfile = studySupervisor?.profiles as unknown as { id: string; full_name: string } | null;
  const isAttachedSupervisor = role === "reviewer";
  const readOnly = version.status !== "draft" || !can(role, "write");

  const { data: snaps } = await supabase.from("protocol_snapshots").select("id, kind, label, created_at, created_by").eq("version_id", version.id).order("created_at", { ascending: false }).limit(40);
  const authorIds = [...new Set((snaps ?? []).map((s) => s.created_by).filter(Boolean))] as string[];
  const { data: authors } = authorIds.length ? await supabase.from("profiles").select("id, full_name").in("id", authorIds) : { data: [] };
  const nameOf = new Map((authors ?? []).map((a) => [a.id, a.full_name]));
  const snapshots: SnapshotRow[] = (snaps ?? []).map((s) => ({ id: s.id, kind: s.kind, label: s.label, created_at: s.created_at, author: s.created_by ? nameOf.get(s.created_by) ?? null : null }));

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-6 pt-10">
        <StudyNav studyId={study.id} active="protocol" />
        <LockPanel
          studyId={study.id}
          version={version}
          isOwner={isOwner}
          isAttachedSupervisor={isAttachedSupervisor}
          supervisor={supervisorProfile}
          pendingInvitation={pendingInvitation ?? null}
          amendmentReview={amendment ?? null}
        />
        {version.status === "draft" && <HistoryPanel studyId={study.id} versionId={version.id} snapshots={snapshots} canEdit={can(role, "write")} />}
      </div>
      <ProtocolForm
        studyId={study.id}
        studyTitle={study.title}
        version={version}
        objectives={objectives ?? []}
        variables={variables ?? []}
        currentEnrollment={study.current_enrollment}
        readOnly={readOnly}
      />
    </div>
  );
}

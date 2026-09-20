import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { StudyNav } from "@/components/study-nav";
import { ProtocolForm } from "./protocol-form";
import { LockPanel } from "./lock-panel";

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
        .from("study_supervisors")
        .select("supervisor_id, profiles!supervisor_id(id, full_name)")
        .eq("study_id", studyId)
        .maybeSingle(),
      supabase
        .from("supervisor_invitations")
        .select("id, invited_email")
        .eq("study_id", studyId)
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

  const isOwner = profile.id === study.owner_id;
  const supervisorProfile = studySupervisor?.profiles as unknown as { id: string; full_name: string } | null;
  const isAttachedSupervisor = supervisorProfile?.id === profile.id;
  const readOnly = version.status !== "draft" || !isOwner;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader profile={profile} />
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

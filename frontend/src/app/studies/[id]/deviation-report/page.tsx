import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { StudyNav } from "@/components/study-nav";
import { ReportPanel } from "./report-panel";

export default async function DeviationReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: studyId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  const { data: study } = await supabase
    .from("studies")
    .select("id, title, owner_id")
    .eq("id", studyId)
    .single();

  if (!study) notFound();

  const { count: registeredCount } = await supabase
    .from("protocol_versions")
    .select("id", { count: "exact", head: true })
    .eq("study_id", studyId)
    .in("status", ["registered", "superseded"]);

  const { data: uploadedFiles } = await supabase.storage
    .from("protocol-outputs")
    .list(`${studyId}/final-analysis`, { sortBy: { column: "created_at", order: "desc" } });

  const latestUpload = uploadedFiles?.[0] ?? null;

  const { data: reports } = await supabase
    .from("deviation_reports")
    .select("id, generated_at, export_docx_path")
    .eq("study_id", studyId)
    .order("generated_at", { ascending: false });

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <StudyNav studyId={study.id} active="deviation-report" />
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
          End-of-study deviation report
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{study.title}</p>

        <div className="mt-6">
          <ReportPanel
            studyId={study.id}
            hasRegisteredProtocol={(registeredCount ?? 0) > 0}
            initialUploadedFileName={latestUpload?.name ?? null}
            initialUploadedPath={latestUpload ? `${study.id}/final-analysis/${latestUpload.name}` : null}
            pastReports={reports ?? []}
          />
        </div>
      </main>
    </div>
  );
}

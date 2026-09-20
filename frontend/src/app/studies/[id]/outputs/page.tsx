import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { StudyNav } from "@/components/study-nav";
import { OUTPUT_ORDER } from "@/lib/protocol/outputs";
import { OutputRow } from "./output-row";

export default async function OutputsPage({ params }: { params: Promise<{ id: string }> }) {
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

  const { data: version } = await supabase
    .from("protocol_versions")
    .select("id, version_number, status")
    .eq("study_id", studyId)
    .in("status", ["draft", "registered"])
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (!version) notFound();

  const { data: outputs } = await supabase
    .from("generated_outputs")
    .select("id, output_type, file_path, file_format, generated_at")
    .eq("protocol_version_id", version.id)
    .order("generated_at", { ascending: false });

  const latestByType = new Map<string, (typeof outputs)[number]>();
  for (const o of outputs ?? []) {
    if (!latestByType.has(o.output_type)) latestByType.set(o.output_type, o);
  }

  const isOwner = profile.id === study.owner_id;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <StudyNav studyId={study.id} active="outputs" />
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
          Generated outputs
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {study.title} · Protocol v{version.version_number} ({version.status})
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {OUTPUT_ORDER.map((type) => (
            <OutputRow
              key={type}
              outputType={type}
              studyId={study.id}
              versionId={version.id}
              existing={latestByType.get(type) ?? null}
              canGenerate={isOwner}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

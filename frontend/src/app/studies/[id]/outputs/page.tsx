import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { StudyNav } from "@/components/study-nav";
import { OUTPUT_ORDER } from "@/lib/protocol/outputs";
import { computeCompletion } from "@/lib/protocol/completion";
import { buildInitialSnapshot } from "@/lib/protocol/quality";
import type { ObjectiveRow, ProtocolVersionRow, VariableRow } from "@/lib/protocol/types";
import { OutputRow } from "./output-row";

export default async function OutputsPage({ params }: { params: Promise<{ id: string }> }) {
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

  const [{ data: objectives }, { data: variables }] = await Promise.all([
    supabase.from("protocol_objectives").select("*").eq("protocol_version_id", version.id),
    supabase.from("protocol_variables").select("*").eq("protocol_version_id", version.id),
  ]);
  const completion = computeCompletion(
    buildInitialSnapshot(
      version as ProtocolVersionRow,
      (objectives ?? []) as ObjectiveRow[],
      (variables ?? []) as VariableRow[],
      study.current_enrollment,
    ),
  );
  const incomplete = completion.sections.filter((s) => !s.complete);

  const { data: outputs } = await supabase
    .from("generated_outputs")
    .select("id, output_type, file_path, file_format, generated_at")
    .eq("protocol_version_id", version.id)
    .order("generated_at", { ascending: false });

  const latestByType = new Map<string, NonNullable<typeof outputs>[number]>();
  for (const o of outputs ?? []) {
    if (!latestByType.has(o.output_type)) latestByType.set(o.output_type, o);
  }

  const isOwner = profile.id === study.owner_id;

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <StudyNav studyId={study.id} active="outputs" />
        <h1 className="text-xl font-semibold text-navy">
          Generated outputs
        </h1>
        <p className="mt-1 text-sm text-navy/65">
          {study.title} · Protocol v{version.version_number} ({version.status})
        </p>

        <div
          className={`mt-4 rounded-lg border p-3 text-sm ${
            incomplete.length
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-teal/30 bg-teal/5 text-navy/85"
          }`}
        >
          {incomplete.length ? (
            <>
              <p className="font-medium">Your protocol is {completion.percent}% complete.</p>
              <p className="mt-1">
                Documents are generated from the saved protocol, so anything still missing may leave gaps. Still needed:{" "}
                {incomplete.map((s) => s.key.replaceAll("_", " ")).join(", ")}. Regenerate a document after you change the protocol.
              </p>
            </>
          ) : (
            <p>All protocol sections are filled in. Regenerate a document after you change the protocol. Always review generated documents before use.</p>
          )}
        </div>

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

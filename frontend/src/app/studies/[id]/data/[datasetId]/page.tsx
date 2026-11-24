import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StudyNav } from "@/components/study-nav";
import { DataStudio, type VersionListItem } from "@/components/datastudio/studio";
import { requireProject } from "@/lib/collab/access";
import { isUuid } from "@/lib/collab/roles";
import type { SavedAnalysis } from "../actions";

export const metadata = { title: "Data Studio" };

export default async function DatasetPage({ params }: { params: Promise<{ id: string; datasetId: string }> }) {
  const { id, datasetId } = await params;
  if (!isUuid(datasetId)) notFound();
  const a = await requireProject(id, "read");
  if (!a.ok) { if (a.status === 401) redirect("/login"); notFound(); }
  const db = a.supabase;
  const [{ data: ds }, { data: all }, { data: versions }, { data: analyses }] = await Promise.all([
    db.from("ds_datasets").select("id, name").eq("id", datasetId).eq("study_id", id).is("deleted_at", null).maybeSingle(),
    db.from("ds_datasets").select("id, name").eq("study_id", id).is("deleted_at", null).order("name"),
    db.from("ds_versions").select("id, version_no, change_description, created_at, n_rows, n_cols, checksum, operations, created_by").eq("dataset_id", datasetId).order("version_no", { ascending: false }),
    db.from("ds_analyses").select("id, method, title, config, result, status, error, version_id, created_at, pinned, duration_ms, engine_version").eq("dataset_id", datasetId).order("created_at", { ascending: false }).limit(100),
  ]);
  if (!ds) notFound();
  const ids = [...new Set((versions ?? []).map((v) => v.created_by).filter(Boolean))] as string[];
  const { data: people } = ids.length ? await db.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));
  const list: VersionListItem[] = (versions ?? []).map((v) => ({ ...v, creator: v.created_by ? nameOf.get(v.created_by) ?? null : null })) as unknown as VersionListItem[];
  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6">
        <StudyNav studyId={id} active="data" />
        <p className="mb-3 text-sm"><Link href={`/studies/${id}/data`} className="text-primary hover:underline">All datasets</Link> / <span className="text-ink">{ds.name}</span></p>
        <DataStudio studyId={id} datasetId={datasetId} datasetName={ds.name} datasets={(all ?? []) as { id: string; name: string }[]} versions={list}
          canWrite={a.canWrite} isOwner={a.isOwner} initialAnalyses={(analyses ?? []) as SavedAnalysis[]} />
        <p className="type-caption mt-4 lg:hidden">Data Studio works best on a larger screen; on a phone you can browse data and results.</p>
      </main>
    </div>
  );
}

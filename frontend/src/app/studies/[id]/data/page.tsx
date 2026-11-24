import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BarChart3, Database } from "lucide-react";
import { StudyNav } from "@/components/study-nav";
import { ImportPanel } from "@/components/datastudio/import-panel";
import { requireProject } from "@/lib/collab/access";
import { projectLimits } from "@/lib/datastudio/server";
import { TIER_LABEL } from "@/lib/datastudio/engine/registry";

export const metadata = { title: "Data Studio" };

export default async function DataStudioHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await requireProject(id, "read");
  if (!a.ok) { if (a.status === 401) redirect("/login"); notFound(); }
  const [{ data: study }, { data: datasets }, limits] = await Promise.all([
    a.supabase.from("studies").select("id, title").eq("id", id).single(),
    a.supabase.from("ds_datasets").select("id, name, description, source_filename, updated_at, current_version_id, ds_versions!ds_versions_dataset_id_fkey(version_no, n_rows, n_cols, bytes)").eq("study_id", id).is("deleted_at", null).order("updated_at", { ascending: false }),
    projectLimits(id),
  ]);
  if (!study) notFound();
  type Row = { id: string; name: string; description: string; source_filename: string | null; updated_at: string; current_version_id: string | null; ds_versions: { version_no: number; n_rows: number; n_cols: number; bytes: number }[] };
  const rows = (datasets ?? []) as unknown as Row[];
  const usedBytes = rows.reduce((s, d) => s + d.ds_versions.reduce((t, v) => t + Number(v.bytes), 0), 0);
  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-6xl px-6 py-10">
        <StudyNav studyId={id} active="data" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-navy"><BarChart3 className="h-5 w-5 text-cobalt" aria-hidden="true" />Data Studio</h1>
            <p className="mt-1 text-sm text-navy/65">Import, clean, analyse and report on this project&apos;s datasets. Every analysis is computed by validated statistical code and tied to an exact dataset version.</p>
          </div>
          <p className="type-caption text-right">Plan: {limits.plan} · {rows.length} of {limits.max_datasets_per_project} datasets · {(usedBytes / 1048576).toFixed(1)} of {(limits.max_project_storage_bytes / 1048576).toFixed(0)} MB · methods: {TIER_LABEL[limits.method_tier]} · {limits.max_analyses_per_day} analyses per day</p>
        </div>

        <section aria-labelledby="ds-h" className="mt-6">
          <h2 id="ds-h" className="sr-only">Datasets</h2>
          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-navy/25 bg-white p-8 text-center">
              <Database className="mx-auto h-8 w-8 text-cobalt" aria-hidden="true" />
              <p className="mt-2 font-medium text-navy">No datasets yet</p>
              <p className="mt-1 text-sm text-navy/65">{a.canWrite ? "Import a file below to get started." : "The project's editors have not added data yet."}</p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((d) => {
                const cur = d.ds_versions.reduce((m, v) => (v.version_no > (m?.version_no ?? 0) ? v : m), d.ds_versions[0]);
                return (
                  <li key={d.id}>
                    <Link href={`/studies/${id}/data/${d.id}`} className="block h-full rounded-card border border-line bg-surface p-4 shadow-card hover:border-primary">
                      <p className="font-medium text-ink">{d.name}</p>
                      {d.description && <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{d.description}</p>}
                      <p className="type-caption mt-2">{cur ? `${cur.n_rows.toLocaleString("en-GB")} rows × ${cur.n_cols} variables · version ${cur.version_no}` : "No data"}{d.source_filename ? ` · from ${d.source_filename}` : ""}</p>
                      <p className="type-caption">Updated {new Date(d.updated_at).toLocaleDateString("en-GB")}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {a.canWrite && <div className="mt-8"><ImportPanel studyId={id} maxBytes={limits.max_upload_bytes} maxRows={limits.max_rows} maxColumns={limits.max_columns} /></div>}
        <p className="type-caption mt-6">Research data stay inside this project: only project members can see them, and the AI analyst receives summary results only. Sample-size and power calculations are in <Link href="/tools" className="text-primary underline">Research tools</Link>.</p>
      </main>
    </div>
  );
}

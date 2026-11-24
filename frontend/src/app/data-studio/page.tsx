import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, Database, FolderOpen } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { METHODS, TIER_LABEL } from "@/lib/datastudio/engine/registry";

export const metadata = { title: "Data Studio" };

/** Entry point from the main navigation: datasets live inside projects, so this lists projects and their datasets. */
export default async function DataStudioIndex() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const db = await createClient();
  const [{ data: studies }, { data: datasets }] = await Promise.all([
    db.from("studies").select("id, title, last_activity_at").order("last_activity_at", { ascending: false }).limit(200),
    db.from("ds_datasets").select("id, study_id, name, updated_at").is("deleted_at", null).order("updated_at", { ascending: false }).limit(500),
  ]);
  const byStudy = new Map<string, { id: string; name: string }[]>();
  for (const d of datasets ?? []) { const k = d.study_id as string; if (!byStudy.has(k)) byStudy.set(k, []); byStudy.get(k)!.push({ id: d.id as string, name: d.name as string }); }
  const recent = (datasets ?? []).slice(0, 6);
  const title = new Map((studies ?? []).map((s) => [s.id as string, s.title as string]));
  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-navy"><BarChart3 className="h-5 w-5 text-cobalt" aria-hidden="true" />Data Studio</h1>
        <p className="mt-1 max-w-3xl text-sm text-navy/65">Manage datasets, run {METHODS.length} validated statistical analyses, build publication-quality figures and draft results text grounded in computed numbers. Datasets belong to a project, so collaborators and supervisors see them under the project&apos;s permissions.</p>

        {recent.length > 0 && (
          <section className="mt-6" aria-labelledby="recent-h">
            <h2 id="recent-h" className="text-sm font-semibold text-navy">Recent datasets</h2>
            <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((d) => (
                <li key={d.id as string}><Link href={`/studies/${d.study_id}/data/${d.id}`} className="block rounded-card border border-line bg-surface p-3 shadow-card hover:border-primary">
                  <p className="flex items-center gap-2 font-medium text-ink"><Database className="h-4 w-4 text-primary" aria-hidden="true" />{d.name as string}</p>
                  <p className="type-caption mt-1">{title.get(d.study_id as string) ?? "Project"} · updated {new Date(d.updated_at as string).toLocaleDateString("en-GB")}</p>
                </Link></li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8" aria-labelledby="proj-h">
          <h2 id="proj-h" className="text-sm font-semibold text-navy">Open Data Studio in a project</h2>
          {(studies ?? []).length === 0 ? (
            <p className="mt-2 rounded-md border border-line bg-white p-4 text-sm text-navy/65">Create a project on the <Link href="/dashboard" className="text-primary underline">dashboard</Link> first.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-white">
              {studies!.map((s) => (
                <li key={s.id as string}><Link href={`/studies/${s.id}/data`} className="flex items-center gap-3 px-4 py-3 hover:bg-soft/40">
                  <FolderOpen className="h-4 w-4 text-cobalt" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-navy">{s.title as string}</span>
                  <span className="type-caption">{byStudy.get(s.id as string)?.length ?? 0} dataset(s)</span>
                </Link></li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8 rounded-card border border-line bg-surface p-4" aria-labelledby="methods-h">
          <h2 id="methods-h" className="text-sm font-semibold text-navy">Available analyses</h2>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {METHODS.map((m) => <li key={m.id} className="flex justify-between gap-2"><span className="text-ink">{m.label}</span><span className="type-caption">{TIER_LABEL[m.tier]}</span></li>)}
          </ul>
        </section>
      </main>
    </div>
  );
}

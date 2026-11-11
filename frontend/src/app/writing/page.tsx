import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { getTemplate, type TemplateId } from "@/lib/writing/templates";

export const metadata = { title: "Writing" };

export default async function AllWritingPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const [{ data: manuscripts }, { data: studies }] = await Promise.all([
    supabase.from("manuscripts").select("id, study_id, title, template, word_count, updated_at").order("updated_at", { ascending: false }).limit(100),
    supabase.from("studies").select("id, title").order("title"),
  ]);
  const studyTitle = new Map((studies ?? []).map((s) => [s.id as string, s.title as string]));
  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-xl font-semibold text-navy">Writing</h1>
        <p className="mt-1 text-sm text-navy/65">Manuscripts live inside a study so they can cite its references. Open a study&apos;s Writing tab to start a new one.</p>
        <h2 className="mt-6 text-sm font-semibold text-navy">All manuscripts</h2>
        {(manuscripts ?? []).length === 0 ? (
          <p className="mt-2 rounded-md border border-line bg-white p-4 text-sm text-navy/65">No manuscripts yet. {(studies ?? []).length ? "Choose a study below to start one." : "Create a study first."}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-white">
            {manuscripts!.map((m) => (
              <li key={m.id}>
                <Link href={`/studies/${m.study_id}/writing/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-soft/40">
                  <FileText className="h-4 w-4 shrink-0 text-cobalt" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-navy">{m.title}</span>
                    <span className="block truncate text-xs text-navy/60">{studyTitle.get(m.study_id as string) ?? "Study"} · {getTemplate(m.template as TemplateId).name} · {(m.word_count as number).toLocaleString()} words · edited {new Date(m.updated_at as string).toLocaleDateString()}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {(studies ?? []).length > 0 && (
          <>
            <h2 className="mt-6 text-sm font-semibold text-navy">Start in a study</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {studies!.map((s) => <li key={s.id as string}><Link href={`/studies/${s.id}/writing`} className="rounded-md border border-navy/25 px-3 py-1.5 text-sm text-navy hover:border-cobalt hover:text-cobalt">{s.title as string}</Link></li>)}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}

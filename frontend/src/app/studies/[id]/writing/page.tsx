import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { StudyNav } from "@/components/study-nav";
import { getTemplate, type TemplateId } from "@/lib/writing/templates";
import { NewManuscriptForm } from "./new-manuscript-form";

export const metadata = { title: "Writing" };

export default async function WritingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: studyId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const { data: study } = await supabase.from("studies").select("id, title, owner_id").eq("id", studyId).single();
  if (!study) notFound();
  const { data: manuscripts } = await supabase
    .from("manuscripts").select("id, title, template, word_count, updated_at").eq("study_id", studyId).order("updated_at", { ascending: false });
  const isOwner = profile.id === study.owner_id;

  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-4xl px-6 py-10">
        <StudyNav studyId={study.id} active="writing" />
        <h1 className="text-xl font-semibold text-navy">Writing</h1>
        <p className="mt-1 text-sm text-navy/65">{study.title}</p>
        <p className="mt-3 text-sm text-navy/65">
          Draft proposals, articles and theses here. Citations come from this study&apos;s references, the bibliography builds itself, and every version is kept.
        </p>

        {isOwner && <div className="mt-6"><NewManuscriptForm studyId={study.id} /></div>}

        <h2 className="mt-8 text-sm font-semibold text-navy">Your manuscripts</h2>
        {(manuscripts ?? []).length === 0 ? (
          <p className="mt-2 rounded-md border border-line bg-white p-4 text-sm text-navy/65">{isOwner ? "Nothing here yet. Choose a template above to start." : "No manuscripts have been shared on this study yet."}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-white">
            {manuscripts!.map((m) => (
              <li key={m.id}>
                <Link href={`/studies/${study.id}/writing/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-soft/40">
                  <FileText className="h-4 w-4 shrink-0 text-cobalt" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-navy">{m.title}</span>
                    <span className="block text-xs text-navy/60">{getTemplate(m.template as TemplateId).name} · {m.word_count.toLocaleString()} words · edited {new Date(m.updated_at).toLocaleDateString()}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

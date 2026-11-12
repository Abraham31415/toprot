import { publicSlugFor } from "@/lib/tools/aliases";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Calculator } from "lucide-react";
import { StudyNav } from "@/components/study-nav";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { getCalculator } from "@/lib/tools/registry";
import { DeleteCalculationButton } from "./delete-button";

type Saved = {
  id: string;
  tool_slug: string;
  tool_name: string;
  inputs: Record<string, string>;
  result: { headline?: { label: string; value: string }; rows?: [string, string][]; methods?: string };
  created_at: string;
};

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function CalculationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: studyId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: study } = await supabase.from("studies").select("id, title, owner_id").eq("id", studyId).single();
  if (!study) notFound();

  const { data } = await supabase
    .from("saved_calculations")
    .select("id, tool_slug, tool_name, inputs, result, created_at")
    .eq("study_id", studyId)
    .order("created_at", { ascending: false });
  const items = (data ?? []) as Saved[];
  const isOwner = profile.id === study.owner_id;

  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <StudyNav studyId={study.id} active="calculations" />
        <h1 className="text-xl font-semibold text-navy">Saved calculations</h1>
        <p className="mt-1 text-sm text-navy/65">{study.title}</p>

        {items.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-navy/25 bg-white p-8 text-center">
            <Calculator className="mx-auto h-8 w-8 text-cobalt" aria-hidden="true" />
            <p className="mt-2 font-medium text-navy">No saved calculations yet</p>
            <p className="mt-1 text-sm text-navy/65">
              Run a calculator and choose Save to project to keep the inputs and result here.
            </p>
            <Link href="/tools" className="mt-3 inline-block text-sm font-medium text-cobalt underline">
              Browse research tools
            </Link>
          </div>
        ) : (
          <ul className="mt-6 flex flex-col gap-3">
            {items.map((c) => {
              const known = getCalculator(c.tool_slug);
              return (
                <li key={c.id} className="rounded-lg border border-line bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      {known ? (
                        <Link href={`/tools/${publicSlugFor(c.tool_slug)}`} className="font-medium text-navy hover:text-cobalt">
                          {c.tool_name}
                        </Link>
                      ) : (
                        <span className="font-medium text-navy">{c.tool_name}</span>
                      )}
                      <p className="text-xs text-navy/60">Saved {when(c.created_at)}</p>
                    </div>
                    {isOwner && <DeleteCalculationButton studyId={study.id} id={c.id} />}
                  </div>
                  {c.result.headline && (
                    <p className="mt-3 text-sm">
                      <span className="text-navy/65">{c.result.headline.label}: </span>
                      <span className="text-lg font-semibold text-navy">{c.result.headline.value}</span>
                    </p>
                  )}
                  {c.result.rows && c.result.rows.length > 0 && (
                    <dl className="mt-2 divide-y divide-line text-sm">
                      {c.result.rows.map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-4 py-1.5">
                          <dt className="text-navy/70">{k}</dt>
                          <dd className="text-right font-medium text-navy">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {c.result.methods && (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer text-navy/75">Methods text</summary>
                      <p className="mt-2 text-navy/85">{c.result.methods}</p>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

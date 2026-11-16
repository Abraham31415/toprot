import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StudyNav } from "@/components/study-nav";
import { getOverview, REVIEW_DISCLAIMER } from "@/lib/collab/review";
import { ReviewPanel } from "./review-panel";

export const metadata: Metadata = { title: "Supervisor review", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: studyId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: study } = await supabase.from("studies").select("id, title").eq("id", studyId).single();
  if (!study) notFound();
  const r = await getOverview(createAdminClient(), user.id, studyId);
  if (!r.ok) notFound();

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-6 pt-10 pb-16">
        <StudyNav studyId={study.id} active="review" />
        <h1 className="text-xl font-semibold text-navy">Supervisor review</h1>
        <p className="mt-1 max-w-3xl text-sm text-navy/70">{REVIEW_DISCLAIMER}</p>
        <ReviewPanel studyId={study.id} userId={user.id} overview={r.overview} />
      </div>
    </div>
  );
}

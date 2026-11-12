import { notFound, redirect } from "next/navigation";
import { PageShell } from "@/components/marketing/ui";
import { ArticleView } from "@/components/resources/article-view";
import { getArticle } from "@/lib/resources/articles";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/profile";

// Administrators can read guides that are still in review. Everyone else gets a 404, and the page is never indexed.
export const metadata = { title: "Guide preview", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function GuidePreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { data: isAdmin } = await createAdminClient().rpc("is_app_admin", { p_user: profile.id });
  if (isAdmin !== true) notFound();
  const a = getArticle(slug);
  if (!a) notFound();
  return (
    <PageShell>
      <ArticleView article={a} preview />
    </PageShell>
  );
}

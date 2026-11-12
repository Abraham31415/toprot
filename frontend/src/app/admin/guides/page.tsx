import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { ARTICLES, ARTICLE_CATEGORIES, blockersFor, isPublished, problemsFor } from "@/lib/resources/articles";
import { toolLink } from "@/components/resources/article-view";

export const metadata = { title: "Guide administration", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATUS_LABEL = { draft: "Draft", in_review: "In review", published: "Published" } as const;
const STATUS_CLASS = {
  draft: "border-line bg-canvas text-ink-soft",
  in_review: "border-warning-line bg-warning-bg text-warning-ink",
  published: "border-success-line bg-success-bg text-success-ink",
} as const;

export default async function AdminGuidesPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // Checked on the server against the app_admins table. Anyone else gets a 404, so the page's existence is not revealed.
  const isAdmin = await createAdminClient().rpc("is_app_admin", { p_user: profile.id });
  if (isAdmin.error || isAdmin.data !== true) notFound();

  const ctx = { toolExists: (s: string) => !!toolLink(s), guideExists: (s: string) => ARTICLES.some((a) => a.slug === s) };
  const published = ARTICLES.filter(isPublished).length;

  return (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Link href="/dashboard" className="type-support hover:underline">Back</Link>
        <h1 className="type-page mt-2">Guide administration</h1>
        <p className="type-support mt-1.5 max-w-3xl !text-ink-soft">
          {ARTICLES.length} guides, {published} published. A guide is visible to readers only when its status is published and every check below passes. Guides are Markdown files
          in <code>content/guides</code>; edit them in the repository and review the change like any other.
        </p>

        <section aria-labelledby="how-h" className="mt-6 rounded-card border border-line bg-surface p-5">
          <h2 id="how-h" className="text-sm font-semibold text-ink">How to publish a guide</h2>
          <ol className="type-support mt-2 list-decimal space-y-1 pl-5 !text-ink-soft">
            <li>Open the draft with the Preview link and read it as a reader would.</li>
            <li>Check every claim, number and equation. Check each reference against the original (DOI, PubMed or the book itself), then set <code>verified: true</code> on that source.</li>
            <li>Remove every <code>[VERIFY]</code> marker.</li>
            <li>Run <code>npm run guides -- check</code>, then <code>npm run guides -- publish &lt;slug&gt; --reviewer &quot;Your name&quot;</code>. It refuses if anything above is missing.</li>
            <li>Commit and deploy. The guide appears on the Resources page, in the sitemap and in search results after the deploy.</li>
          </ol>
          <p className="type-caption mt-3">To take a guide down, run <code>npm run guides -- unpublish &lt;slug&gt;</code>. To change a published guide, edit it and update its updatedOn date.</p>
        </section>

        <div className="mt-6 overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
            <caption className="sr-only">Guides, their status and what blocks publication</caption>
            <thead className="bg-canvas">
              <tr>
                {["Guide", "Status", "Words", "Sources verified", "Blocking publication", "Updated", ""].map((h) => <th key={h} scope="col" className="border-b border-line px-3 py-2 type-label">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {ARTICLES.map((a) => {
                const blockers = blockersFor(a);
                const problems = problemsFor(a, ctx);
                const verified = a.sources.filter((s) => s.verified).length;
                return (
                  <tr key={a.slug} className="border-t border-line align-top">
                    <td className="px-3 py-3">
                      <p className="font-medium text-ink">{a.title}</p>
                      <p className="type-caption">{ARTICLE_CATEGORIES.find((c) => c.id === a.category)?.name}{a.featured ? " · featured" : ""}</p>
                      <p className="type-caption">{a.author}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                      {isPublished(a) && <p className="type-caption mt-1">Live</p>}
                    </td>
                    <td className="px-3 py-3 tabular-nums">{a.words.toLocaleString("en-GB")}</td>
                    <td className="px-3 py-3 tabular-nums">{verified} of {a.sources.length}</td>
                    <td className="px-3 py-3">
                      {blockers.length === 0 && problems.length === 0 ? <span className="text-success-ink">Ready</span> : (
                        <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink-soft">
                          {blockers.map((b) => <li key={b}>{b}</li>)}
                          {problems.filter((p) => !p.startsWith("Marked published but blocked")).map((p) => <li key={p} className="text-danger-ink">{p}</li>)}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{a.updatedOn}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <Link href={`/resources/preview/${a.slug}`} className="font-medium text-primary hover:underline">Preview</Link>
                      {isPublished(a) && <> <span aria-hidden="true">·</span> <Link href={`/resources/${a.slug}`} className="font-medium text-primary hover:underline">Live</Link></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

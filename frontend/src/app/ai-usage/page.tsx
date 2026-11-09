import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getHeadroom } from "@/lib/ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FEATURE_LABELS: Record<string, string> = { protocol_review: "Protocol reviewer questions" };
const STATUS_LABELS: Record<string, string> = {
  committed: "Completed",
  failed: "Not charged (error)",
  released: "Not charged",
  expired: "Not charged (timed out)",
  reserved: "In progress",
};

const credits = (mcr: number) => (mcr / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 });
const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

export default async function AiUsagePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.role) redirect("/onboarding");

  // Balance is computed by the ledger with the service role; the history list is read through
  // the user's own session so row-level security guarantees they only see their own rows.
  const headroom = await getHeadroom(createAdminClient(), profile.id).catch(() => null);
  const supabase = await createClient();
  const { data: history } = await supabase
    .from("ai_usage_events")
    .select("id, feature_key, model_id, status, charged_mcr, input_tokens, output_tokens, created_at")
    .order("created_at", { ascending: false })
    .limit(25);

  const pct = headroom && headroom.allowanceMcr > 0 ? Math.min(100, Math.round((headroom.usedMcr / headroom.allowanceMcr) * 100)) : 0;
  const home = profile.role === "supervisor" ? "/supervisor" : "/dashboard";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader profile={profile} />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <Link href={home} className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">AI credits</h1>

        {!headroom ? (
          <p className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            Credit information is temporarily unavailable. Everything else in ToProt still works.
          </p>
        ) : (
          <>
            <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {headroom.plan === "pro" ? "Toprot Pro" : "Free plan (introductory credits)"}
              </p>
              <p className="mt-1 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
                {credits(headroom.availableMcr)}
                <span className="ml-2 text-base font-normal text-zinc-500 dark:text-zinc-400">
                  of {credits(headroom.allowanceMcr)} credits remaining
                </span>
              </p>
              <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Credits used"
              >
                <div className="h-full bg-purple-600" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                {headroom.plan === "pro" && headroom.periodEnd
                  ? `Credits reset on ${date(headroom.periodEnd)}. Unused credits do not carry over.`
                  : "Introductory credits are one-time and do not reset. Upgrade to Toprot Pro for a fresh 2,000 credits every billing period."}
              </p>
              {headroom.reservedMcr > 0 && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {credits(headroom.reservedMcr)} credits are held for requests still in progress.
                </p>
              )}
              {headroom.availableMcr <= 0 && (
                <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
                  You are out of AI credits. All non-AI research tools (calculators, protocol editing, exports) keep working.
                </p>
              )}
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Recent AI activity</h2>
              {!history?.length ? (
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No AI requests yet.</p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">When</th>
                        <th className="px-3 py-2 font-medium">Feature</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 text-right font-medium">Credits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((e) => (
                        <tr key={e.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                          <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">{dateTime(e.created_at)}</td>
                          <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{FEATURE_LABELS[e.feature_key] ?? e.feature_key}</td>
                          <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{STATUS_LABELS[e.status] ?? e.status}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                            {e.status === "committed" ? credits(Number(e.charged_mcr)) : "0"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

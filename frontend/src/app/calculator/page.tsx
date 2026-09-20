import Link from "next/link";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { CalculatorClient } from "./calculator-client";
import { listMyStudies } from "./actions";

export default async function CalculatorPage() {
  const profile = await getCurrentProfile();
  const studies = profile ? await listMyStudies() : [];

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 dark:bg-black">
      <main className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Sample size calculator</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              The same engine ToProt uses inside a study protocol. No account needed to calculate.
            </p>
          </div>
          <Link href="/" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            ToProt
          </Link>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <CalculatorClient isSignedIn={!!profile} studies={studies} />
        </div>
      </main>
    </div>
  );
}

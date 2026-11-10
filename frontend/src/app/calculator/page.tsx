import type { Metadata } from "next";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { CalculatorClient } from "./calculator-client";
import { listMyStudies } from "./actions";
import { PageShell } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "Sample size calculator",
  description:
    "Free sample size calculator for single proportion, single mean, two proportions, two means, paired means and correlation studies, with a dropout and effect size stress test. No account needed.",
  alternates: { canonical: "/calculator" },
};

export default async function CalculatorPage() {
  const profile = await getCurrentProfile();
  const studies = profile ? await listMyStudies() : [];

  return (
    <PageShell>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-navy">Sample size calculator</h1>
            <p className="mt-1 text-sm text-navy/65">
              The same engine ToProt uses inside a study protocol. No account needed to calculate.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-white p-6">
          <CalculatorClient isSignedIn={!!profile} studies={studies} />
        </div>
      </div>
    </PageShell>
  );
}

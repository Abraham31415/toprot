import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink, Container, JsonLd, PageShell, StatusBadge } from "@/components/marketing/ui";
import { FEATURES, SITE_DESCRIPTION, SITE_URL } from "@/lib/site";
import { SAMPLE_STUDY as S } from "@/lib/sample-study";
import { getCurrentProfile } from "@/lib/supabase/profile";

export const metadata: Metadata = {
  title: { absolute: "ToProt | Research Protocol & Study Design Platform" },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

const STAGES = [
  { n: 1, title: "Create your research project", text: "Start a study and give it a title, design and research question." },
  { n: 2, title: "Organise your references", text: "Add sources by DOI, PubMed ID or title. Searching literature inside ToProt is planned." },
  { n: 3, title: "Structure your protocol", text: "Fill guided sections for objectives, population, variables, statistics, data collection and ethics." },
  { n: 4, title: "Validate methods and variables", text: "Run consistency checks and, optionally, get AI reviewer questions to think about." },
  { n: 5, title: "Generate documents", text: "Produce a data dictionary, REDCap and KoBo forms, table shells, ethics package and more." },
];

export default async function Home() {
  const profile = await getCurrentProfile();
  if (profile) {
    if (!profile.role) redirect("/onboarding");
    redirect(profile.role === "supervisor" ? "/supervisor" : "/dashboard");
  }

  return (
    <PageShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "ToProt",
          url: SITE_URL,
          applicationCategory: "EducationalApplication",
          operatingSystem: "Web",
          description: SITE_DESCRIPTION,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }}
      />

      <section className="border-b border-line bg-white">
        <Container className="py-16 sm:py-24">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            From research protocol to research-ready documents.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-navy/75">
            Design your study, organise your references, and generate research instruments and statistical templates
            from one integrated workspace.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/register">Start for free</ButtonLink>
            <ButtonLink href="/examples" variant="secondary">
              Explore sample study
            </ButtonLink>
          </div>
        </Container>
      </section>

      <Container className="py-14">
        <div className="rounded-lg border border-line bg-white p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal">Sample study (fictional data)</p>
          <h2 className="mt-1 text-xl font-semibold">{S.title}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-sm font-medium">Protocol sections</p>
              <ul className="mt-2 space-y-1 text-sm text-navy/75">
                {S.protocolSections.slice(0, 6).map((s) => (
                  <li key={s.name}>&#10003; {s.name}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-medium">Sample size</p>
              <p className="mt-2 text-sm text-navy/75">
                {S.sampleSize.design}: <span className="font-semibold text-navy">{S.sampleSize.result} participants</span>{" "}
                including {S.sampleSize.dropout} dropout.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium">Variables</p>
              <p className="mt-2 text-sm text-navy/75">
                {S.variables.length} variables with types and roles, ready for a data dictionary.
              </p>
            </div>
          </div>
          <Link href="/examples" className="mt-4 inline-block text-sm font-medium text-teal underline">
            Explore the full sample study
          </Link>
        </div>
      </Container>

      <section className="border-y border-line bg-white">
        <Container className="py-14">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-5">
            {STAGES.map((s) => (
              <li key={s.n}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">
                  {s.n}
                </span>
                <h3 className="mt-3 text-base font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-navy/70">{s.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <Container className="py-14">
        <h2 className="text-2xl font-semibold tracking-tight">Features</h2>
        <p className="mt-2 max-w-2xl text-navy/70">What you can use today, and what is still planned.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Link
              key={f.slug}
              href={`/features#${f.slug}`}
              className="rounded-lg border border-line bg-white p-5 transition-colors hover:border-teal"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold">{f.name}</h3>
                <StatusBadge status={f.status} />
              </div>
              <p className="mt-2 text-sm text-navy/70">{f.summary}</p>
            </Link>
          ))}
        </div>
      </Container>

      <section className="border-t border-line bg-white">
        <Container className="py-14">
          <h2 className="text-2xl font-semibold tracking-tight">Research integrity</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <div>
              <h3 className="font-semibold">You stay the researcher</h3>
              <p className="mt-1 text-sm text-navy/70">
                AI output is limited to reviewer-style questions. It never approves, scores or writes your protocol, and
                generated documents are drafts for you to check.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Structured, consistent data</h3>
              <p className="mt-1 text-sm text-navy/70">
                Documents are generated from the same structured protocol, so they stay consistent with each other.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Verifiable sources</h3>
              <p className="mt-1 text-sm text-navy/70">
                References are looked up from CrossRef and PubMed by identifier, so you can check each one at its source.
              </p>
            </div>
          </div>
          <p className="mt-6 text-sm text-navy/60">
            ToProt has no regulatory certification, clinical validation or institutional endorsement. See our{" "}
            <Link href="/privacy" className="text-teal underline">
              privacy policy
            </Link>{" "}
            for how data is handled.
          </p>
        </Container>
      </section>
    </PageShell>
  );
}

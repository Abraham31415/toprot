import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Calculator,
  CalendarCheck,
  FilePen,
  FileText,
  FlaskConical,
  Lightbulb,
  Library,
  Search,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { ButtonLink, Container, JsonLd, PageShell, StatusBadge } from "@/components/marketing/ui";
import {
  CalculatorPreview,
  DashboardPreview,
  EditorPreview,
  LiteraturePreview,
  ProtocolPreview,
  ReferencesPreview,
  ReviewPreview,
} from "@/components/marketing/previews";
import { FEATURES, SITE_DESCRIPTION, SITE_URL } from "@/lib/site";
import { getCurrentProfile } from "@/lib/supabase/profile";

export const metadata: Metadata = {
  title: { absolute: "ToProt | Research Protocol & Study Design Platform" },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

const FEATURE_ICONS: Record<string, LucideIcon> = {
  "protocol-builder": FlaskConical,
  "methodology-validation": ShieldCheck,
  "sample-size": Calculator,
  "reference-manager": Library,
  "document-generation": FileText,
  "study-tracking": CalendarCheck,
  "academic-editor": FilePen,
  "literature-explorer": Search,
  "pdf-library": BookOpen,
  "ai-assistant": Sparkles,
};

// Short card headings and one-line descriptions; the full wording lives on /features.
const FEATURE_COPY: Record<string, { title: string; line: string }> = {
  "protocol-builder": { title: "Guided protocol builder", line: "Fill structured sections once." },
  "methodology-validation": { title: "Methodology checks", line: "Rule-based checks and optional AI questions." },
  "sample-size": { title: "Sample size calculator", line: "Nine designs with a stress test." },
  "reference-manager": { title: "Reference manager", line: "Add sources by DOI, PubMed ID or title." },
  "document-generation": { title: "Document generation", line: "Forms and templates from your protocol." },
  "study-tracking": { title: "Milestones and deviations", line: "Track progress and log changes." },
  "academic-editor": { title: "Academic writing editor", line: "Write with citations built in." },
  "literature-explorer": { title: "Literature explorer", line: "Search scholarly sources in one place." },
  "pdf-library": { title: "PDF research library", line: "Read and annotate papers." },
  "ai-assistant": { title: "AI research assistant", line: "Grounded help with your own project." },
};

type Stage = { name: string; icon: LucideIcon; status: "available" | "planned"; note: string };
const LIFECYCLE: Stage[] = [
  { name: "Idea", icon: Lightbulb, status: "available", note: "Start a study" },
  { name: "Evidence", icon: Library, status: "available", note: "Manage references" },
  { name: "Protocol", icon: FlaskConical, status: "available", note: "Build and check" },
  { name: "Analysis", icon: Calculator, status: "available", note: "Calculators and statistics" },
  { name: "Writing", icon: FilePen, status: "available", note: "Write with citations" },
  { name: "Publication", icon: BookOpen, status: "available", note: "Export to Word or PDF" },
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

      {/* Hero */}
      <section className="border-b border-line bg-white">
        <Container className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-2">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-soft px-3 py-1 text-xs font-semibold text-cobalt-dark">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
              Free during early access
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-navy sm:text-5xl">
              From research idea to publication.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-navy/75">
              Design protocols, search the literature, manage references and PDFs, write your paper and generate study
              documents in one workspace.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/register">Start researching free</ButtonLink>
              <ButtonLink href="#tools" variant="secondary">
                Explore research tools
              </ButtonLink>
            </div>
          </div>
          <DashboardPreview />
        </Container>
      </section>

      {/* Lifecycle */}
      <Container className="py-14">
        <h2 className="text-2xl font-semibold tracking-tight text-navy">One workflow, idea to paper</h2>
        <ol className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {LIFECYCLE.map((s, i) => (
            <li
              key={s.name}
              className={`rounded-lg border p-4 ${s.status === "available" ? "border-line bg-white" : "border-dashed border-navy/25 bg-paper"}`}
            >
              <div className="flex items-center justify-between">
                <s.icon
                  className={`h-5 w-5 ${s.status === "available" ? "text-cobalt" : "text-navy/40"}`}
                  aria-hidden="true"
                />
                <span className="text-xs text-navy/45">{i + 1}</span>
              </div>
              <p className="mt-3 font-semibold text-navy">{s.name}</p>
              <p className="mt-0.5 text-xs text-navy/65">{s.note}</p>
              <p className={`mt-2 text-xs font-medium ${s.status === "available" ? "text-teal-ink" : "text-[#8a5d1c]"}`}>
                {s.status === "available" ? "Available" : "Planned"}
              </p>
            </li>
          ))}
        </ol>
      </Container>

      {/* Product preview */}
      <section className="border-y border-line bg-white">
        <Container className="py-14">
          <h2 className="text-2xl font-semibold tracking-tight text-navy">See it in action</h2>
          <p className="mt-2 text-navy/70">Previews use sample data.</p>
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <ProtocolPreview />
            <CalculatorPreview />
            <ReferencesPreview />
            <ReviewPreview />
            <LiteraturePreview />
            <EditorPreview />
          </div>
        </Container>
      </section>

      {/* Features */}
      <Container className="py-14">
        <h2 className="text-2xl font-semibold tracking-tight text-navy">Research tools</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = FEATURE_ICONS[f.slug] ?? FlaskConical;
            const copy = FEATURE_COPY[f.slug] ?? { title: f.name, line: f.summary };
            return (
              <Link
                key={f.slug}
                href={`/features#${f.slug}`}
                className="group rounded-lg border border-line bg-white p-5 transition-colors hover:border-cobalt"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-soft text-cobalt">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <StatusBadge status={f.status} />
                </div>
                <h3 className="mt-4 text-base font-semibold text-navy">{copy.title}</h3>
                <p className="mt-1 text-sm text-navy/70">{copy.line}</p>
              </Link>
            );
          })}
        </div>
      </Container>

      {/* Free tools */}
      <section id="tools" className="scroll-mt-20 border-y border-line bg-soft">
        <Container className="py-14">
          <h2 className="text-2xl font-semibold tracking-tight text-navy">Start with a free tool</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Link
              href="/calculator"
              className="rounded-lg border border-line bg-white p-5 transition-colors hover:border-cobalt"
            >
              <Calculator className="h-6 w-6 text-cobalt" aria-hidden="true" />
              <h3 className="mt-3 font-semibold text-navy">Sample size calculator</h3>
              <p className="mt-1 text-sm text-navy/70">No account needed.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-cobalt">
                Open calculator <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </Link>
            <Link
              href="/examples"
              className="rounded-lg border border-line bg-white p-5 transition-colors hover:border-cobalt"
            >
              <FlaskConical className="h-6 w-6 text-cobalt" aria-hidden="true" />
              <h3 className="mt-3 font-semibold text-navy">Sample study</h3>
              <p className="mt-1 text-sm text-navy/70">Browse a finished example.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-cobalt">
                View example <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </Link>
            <Link
              href="/register"
              className="rounded-lg border border-line bg-white p-5 transition-colors hover:border-cobalt"
            >
              <Library className="h-6 w-6 text-cobalt" aria-hidden="true" />
              <h3 className="mt-3 font-semibold text-navy">Protocol and references</h3>
              <p className="mt-1 text-sm text-navy/70">Free account required.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-cobalt">
                Create account <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </Link>
          </div>
        </Container>
      </section>

      {/* Pricing preview */}
      <Container className="py-14">
        <h2 className="text-2xl font-semibold tracking-tight text-navy">Simple pricing</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border-2 border-cobalt bg-white p-6">
            <p className="text-sm font-semibold text-cobalt">Available now</p>
            <h3 className="mt-1 text-xl font-semibold text-navy">Free</h3>
            <p className="mt-1 text-3xl font-semibold text-navy">$0</p>
            <p className="mt-2 text-sm text-navy/70">All the research tools, with a small one-time allowance of AI credits.</p>
          </div>
          <div className="rounded-lg border border-navy/20 bg-white p-6">
            <p className="text-sm font-semibold text-teal-ink">Paid plan</p>
            <h3 className="mt-1 text-xl font-semibold text-navy">Toprot Pro</h3>
            <p className="mt-2 text-sm text-navy/70">More projects, the full AI research assistant and monthly AI credits. See pricing for current availability.</p>
          </div>
        </div>
        <Link href="/pricing" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-cobalt">
          Pricing details <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Container>

      {/* Integrity + CTA */}
      <section className="bg-navy text-white">
        <Container className="py-14 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Start your next study well.</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/75">
            Create a free account, or try the sample size calculator first.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center justify-center rounded-md bg-cobalt px-5 py-3 text-sm font-medium text-white hover:bg-cobalt-dark"
            >
              Start researching free
            </Link>
            <Link
              href="/calculator"
              className="inline-flex items-center justify-center rounded-md border border-white/40 px-5 py-3 text-sm font-medium text-white hover:bg-white/10"
            >
              Use the calculator
            </Link>
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-xs text-white/60">
            AI output is limited to reviewer-style questions and never approves or writes your protocol. ToProt has no
            regulatory certification or clinical validation. See our{" "}
            <Link href="/privacy" className="underline">
              privacy policy
            </Link>
            .
          </p>
        </Container>
      </section>
    </PageShell>
  );
}

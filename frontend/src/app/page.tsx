import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookOpen, BrainCircuit, Calculator, ClipboardCheck, FilePenLine, FlaskConical, Library } from "lucide-react";
import { JsonLd, PageShell } from "@/components/marketing/ui";
import { ButtonLink } from "@/components/ds/button";
import { CTASection, FeatureCard, FeaturedToolCard } from "@/components/ds/card";
import { Container, Section, SectionHeader } from "@/components/ds/layout";
import { FeatureShowcase, ProductScreenshot, WorkflowSteps } from "@/components/ds/showcase";
import { TOOL_ICONS } from "@/components/tools/tool-icons";
import { SHOTS } from "@/lib/screenshots";
import { DIR_CATEGORIES, FEATURED } from "@/lib/tools/directory-core";
import { SITE_DESCRIPTION, SITE_URL } from "@/lib/site";
import { getCurrentProfile } from "@/lib/supabase/profile";

export const metadata: Metadata = {
  title: { absolute: "ToProt | Research Protocol & Study Design Platform" },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

const WORKFLOW = [
  { icon: FlaskConical, label: "Idea", note: "Start a study" },
  { icon: BookOpen, label: "Evidence", note: "Search and collect" },
  { icon: Library, label: "Protocol", note: "Build and check" },
  { icon: Calculator, label: "Analysis", note: "Calculators and statistics" },
  { icon: FilePenLine, label: "Writing", note: "Write with citations" },
  { icon: ClipboardCheck, label: "Publication", note: "Export to Word or PDF" },
];

export default async function Home() {
  const profile = await getCurrentProfile();
  if (profile) {
    if (!profile.role) redirect("/onboarding");
    redirect(profile.role === "supervisor" ? "/supervisor" : "/dashboard");
  }
  const toneOf = (id: string) => DIR_CATEGORIES.find((c) => c.id === id)!.tone;

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

      <section className="border-b border-line bg-surface">
        <Container className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-2">
          <div>
            <p className="type-eyebrow mb-4">Free during early access</p>
            <h1 className="type-hero">From research idea to publication.</h1>
            <p className="type-lead mt-5 max-w-xl">
              Design protocols, search the literature, manage references and PDFs, write your paper and generate study documents in one workspace.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/register" size="lg">Start researching free</ButtonLink>
              <ButtonLink href="/tools" variant="secondary" size="lg">Explore research tools</ButtonLink>
            </div>
          </div>
          <ProductScreenshot {...SHOTS.dashboard} priority />
        </Container>
      </section>

      <Section>
        <Container>
          <SectionHeader title="One workspace, from first idea to finished paper" lead="Enter your study once and each step builds on the last." />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard icon={FlaskConical} tone="cobalt" title="Protocol builder" description="Guided sections for objectives, population, variables and ethics, with methodology checks." href="/features#protocol-builder" />
            <FeatureCard icon={BookOpen} tone="violet" title="Literature explorer" description="Search OpenAlex, PubMed and Crossref in one place." href="/features#literature-explorer" />
            <FeatureCard icon={Calculator} tone="teal" title="Sample size and statistics" description="Free calculators with formulas, assumptions and references." href="/tools" />
            <FeatureCard icon={FilePenLine} tone="terracotta" title="Writing editor" description="Write with citations, a live bibliography and export to Word or PDF." href="/features#academic-editor" />
            <FeatureCard icon={Library} tone="ocean" title="References and PDFs" description="Import, organise, annotate and search your sources." href="/features#reference-manager" />
            <FeatureCard icon={BrainCircuit} tone="cobalt" title="AI research assistant" description="Help grounded in your own project. Uses AI credits." href="/features#ai-assistant" />
          </div>
        </Container>
      </Section>

      <Section tone="white">
        <Container>
          <div className="space-y-20 sm:space-y-24">
            <FeatureShowcase
              icon={FlaskConical} tone="cobalt" eyebrow="Protocol" title="Build a protocol that checks itself"
              description="Fill structured sections once. A completion tracker and rule-based checks show what still needs attention."
              benefits={["Autosave and a lockable final version", "Consistency checks across the whole protocol", "Optional AI reviewer questions"]}
              cta={{ label: "See the protocol builder", href: "/features#protocol-builder" }} media={<ProductScreenshot {...SHOTS.protocol} />}
            />
            <FeatureShowcase
              icon={BookOpen} tone="violet" eyebrow="Literature" title="Find the evidence, then keep it"
              description="Search scholarly databases, open the original paper and save records straight into your study."
              benefits={["Filters for year, type and open access", "Export to RIS, BibTeX or CSV", "Records link back to their source"]}
              cta={{ label: "Open the literature explorer", href: "/literature" }} reverse media={<ProductScreenshot {...SHOTS.literature} />}
            />
            <FeatureShowcase
              icon={FilePenLine} tone="terracotta" eyebrow="Writing" title="Write with your references at hand"
              description="A manuscript editor that cites from your own reference library and builds the bibliography for you."
              benefits={["Templates for common study types", "Version history and autosave", "Export to Word or PDF"]}
              cta={{ label: "See the writing editor", href: "/features#academic-editor" }} media={<ProductScreenshot {...SHOTS.editor} />}
            />
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <SectionHeader title="The research workflow" />
          <div className="mt-8"><WorkflowSteps steps={WORKFLOW} /></div>
        </Container>
      </Section>

      <Section tone="soft">
        <Container>
          <SectionHeader title="Free tools, no account needed" lead="Every calculator shows its formula, steps, assumptions and references." action={<ButtonLink href="/tools" variant="secondary">All research tools</ButtonLink>} />
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURED.map((f) => (
              <li key={f.slug}><FeaturedToolCard icon={TOOL_ICONS[f.icon]} tone={toneOf(f.category)} label={f.label} description={f.blurb} href={f.href} /></li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section>
        <Container width="narrow" className="text-center">
          <h2 className="type-section">Free to start. Pro when you need more.</h2>
          <p className="type-lead mx-auto mt-3 max-w-xl">Research tools and the workspace are free. Pro adds more projects, the full AI research assistant and a monthly AI credit allowance.</p>
          <div className="mt-6"><ButtonLink href="/pricing" variant="secondary" size="lg">See pricing</ButtonLink></div>
        </Container>
      </Section>

      <CTASection title="Start with your idea." description="Create a free account and build your first protocol in minutes." primary={{ label: "Start researching free", href: "/register" }} secondary={{ label: "Explore the sample study", href: "/examples" }} />
    </PageShell>
  );
}

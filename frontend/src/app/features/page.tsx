import type { Metadata } from "next";
import { Calculator, ClipboardCheck, FilePenLine, FlaskConical, Library, BookOpen, BrainCircuit, Calendar, FileText, ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/marketing/ui";
import { ButtonLink } from "@/components/ds/button";
import { CTASection, FeatureCard, ResearchModuleCard } from "@/components/ds/card";
import { Container, PageHeader, Section, SectionHeader } from "@/components/ds/layout";
import { FeatureShowcase, ProductScreenshot, WorkflowSteps } from "@/components/ds/showcase";
import { CalculatorPreview, EditorPreview, LiteraturePreview, ReferencesPreview, ReviewPreview } from "@/components/marketing/previews";
import { FEATURES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Protocol builder, methodology checks, sample size and statistics calculators, literature explorer, reference manager, PDF library, writing editor, AI research assistant and document generation in ToProt.",
  alternates: { canonical: "/features" },
};

const feature = (slug: string) => FEATURES.find((f) => f.slug === slug)!;

// The ten features in FEATURES keep their anchors (/features#slug), which other pages link to. Six get a full showcase, four are listed below them.
const SHOWCASES = [
  { slug: "protocol-builder", icon: FlaskConical, tone: "cobalt", eyebrow: "Protocol", media: <ProductScreenshot src="/screenshots/protocol-main.webp" width={616} height={500} address="toprot.vercel.app/studies/.../protocol" alt="The protocol builder: eight protocol sections with completion counts, a study identity form and a protocol quality panel listing which sections still need work." caption="A demo account with a fictional study." /> },
  { slug: "literature-explorer", icon: BookOpen, tone: "violet", eyebrow: "Literature", media: <LiteraturePreview /> },
  { slug: "sample-size", icon: Calculator, tone: "teal", eyebrow: "Sample size and statistics", media: <CalculatorPreview /> },
  { slug: "reference-manager", icon: Library, tone: "ocean", eyebrow: "References", media: <ReferencesPreview /> },
  { slug: "academic-editor", icon: FilePenLine, tone: "terracotta", eyebrow: "Writing", media: <EditorPreview /> },
  { slug: "methodology-validation", icon: ShieldCheck, tone: "navy", eyebrow: "Methodology checks", media: <ReviewPreview /> },
] as const;

const ALSO = [
  { slug: "pdf-library", icon: FileText, tone: "violet" },
  { slug: "ai-assistant", icon: BrainCircuit, tone: "cobalt" },
  { slug: "document-generation", icon: ClipboardCheck, tone: "terracotta" },
  { slug: "study-tracking", icon: Calendar, tone: "gold" },
] as const;

const WORKFLOW = [
  { icon: FlaskConical, label: "Design", note: "Protocol and methodology" },
  { icon: BookOpen, label: "Search", note: "Find the literature" },
  { icon: Library, label: "Organise", note: "References and PDFs" },
  { icon: Calculator, label: "Calculate", note: "Sample size and tests" },
  { icon: FilePenLine, label: "Write", note: "Manuscript and citations" },
  { icon: ClipboardCheck, label: "Track", note: "Milestones and deviations" },
];

export default function FeaturesPage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Features"
        title="Everything you need to move research forward."
        lead="Enter your study once. Search, plan, calculate, write and track in one workspace, with the documents following from what you entered."
        actions={<><ButtonLink href="/register">Start for free</ButtonLink><ButtonLink href="/examples" variant="secondary">Explore the sample study</ButtonLink></>}
      />

      <Section spacing="sm">
        <Container>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard icon={FlaskConical} tone="cobalt" title="Design your protocol" description="Guided sections for objectives, population, variables, statistics and ethics." href="#protocol-builder" />
          <FeatureCard icon={BookOpen} tone="violet" title="Search the literature" description="Search OpenAlex, PubMed and Crossref, then save records to a study." href="#literature-explorer" />
          <FeatureCard icon={Calculator} tone="teal" title="Calculate sample size" description="Nine study designs, free to use without an account." href="#sample-size" />
          <FeatureCard icon={Library} tone="ocean" title="Manage references and PDFs" description="Import, tag, de-duplicate, annotate and search your sources." href="#reference-manager" />
          <FeatureCard icon={FilePenLine} tone="terracotta" title="Write with citations" description="An editor with a live bibliography, autosave and version history." href="#academic-editor" />
          <FeatureCard icon={BrainCircuit} tone="cobalt" title="Ask the AI assistant" description="Help grounded in your own project. Uses AI credits." href="#ai-assistant" />
        </div>
        </Container>
      </Section>

      <Section tone="soft">
        <Container>
        <SectionHeader title="The research workflow, in one place" lead="Each step feeds the next, so nothing is entered twice." />
        <div className="mt-8"><WorkflowSteps steps={WORKFLOW} /></div>
        </Container>
      </Section>

      <Section>
        <Container>
        <div className="space-y-20 sm:space-y-24">
          {SHOWCASES.map((s, i) => {
            const f = feature(s.slug);
            return (
              <FeatureShowcase
                key={s.slug} id={s.slug} icon={s.icon} tone={s.tone} eyebrow={s.eyebrow} title={f.name} description={f.summary}
                benefits={f.details} reverse={i % 2 === 1} media={s.media}
                cta={s.slug === "sample-size" ? { label: "Open the calculator", href: "/calculator" } : { label: "Read the guide", href: "/docs" }}
              />
            );
          })}
        </div>
        </Container>
      </Section>

      <Section tone="soft">
        <Container>
        <SectionHeader title="Also included" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {ALSO.map((a) => {
            const f = feature(a.slug);
            return (
              <div key={a.slug} id={a.slug}>
                <ResearchModuleCard icon={a.icon} tone={a.tone} title={f.name} description={f.summary} href="/register" />
              </div>
            );
          })}
        </div>
        </Container>
      </Section>

      <CTASection
          title="Start with your idea."
          description="Calculators are free without an account. A free account gives you the full workspace and an introductory AI credit allowance."
          primary={{ label: "Start for free", href: "/register" }}
          secondary={{ label: "See pricing", href: "/pricing" }}
        />
    </PageShell>
  );
}

import type { Metadata } from "next";
import { ButtonLink, Container, PageHeading, PageShell } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Five steps from an idea to research-ready documents: create a study, organise references, structure the protocol, validate methods and generate documents.",
  alternates: { canonical: "/how-it-works" },
};

const STEPS = [
  {
    title: "Create your research project",
    text: "Register, start a study and enter its title, design and research question.",
    note: null,
  },
  {
    title: "Organise your references",
    text: "Add references by DOI, PubMed ID or title. Details come from CrossRef and PubMed, and you can add any source manually.",
    note: "Searching literature inside ToProt and inserting citations in a writing editor are planned, not yet available.",
  },
  {
    title: "Structure your protocol",
    text: "Work through guided sections: objectives, population and eligibility, variables, sample size, statistical methods, data collection and ethics. Most sections save automatically; objectives and variables use a Save button.",
    note: null,
  },
  {
    title: "Validate methods and variables",
    text: "Rule-based checks flag inconsistencies, such as a variable whose type does not suit the planned analysis. You can also request AI reviewer questions, phrased as prompts for your own judgement.",
    note: "AI review uses a limited credit allowance. It never scores, approves or rewrites your protocol.",
  },
  {
    title: "Generate research documents",
    text: "Create a data dictionary, KoBo and REDCap forms, a Stata skeleton, statistical table shells, a methods paragraph, an ethics package and a consent form from the protocol you entered.",
    note: "Generated documents are drafts. Review them before use.",
  },
];

export default function HowItWorksPage() {
  return (
    <PageShell>
      <PageHeading
        eyebrow="How it works"
        title="Enter your study once. Generate what follows from it."
        lead="ToProt keeps your study in structured form, so the documents that depend on it stay consistent."
      />
      <Container className="pb-16">
        <ol className="max-w-3xl space-y-8">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cobalt text-sm font-semibold text-white">
                {i + 1}
              </span>
              <div>
                <h2 className="text-lg font-semibold">{s.title}</h2>
                <p className="mt-1 text-navy/75">{s.text}</p>
                {s.note && <p className="mt-2 rounded-md bg-gold/10 px-3 py-2 text-sm text-navy/80">{s.note}</p>}
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/register">Start for free</ButtonLink>
          <ButtonLink href="/examples" variant="secondary">
            See a sample study
          </ButtonLink>
        </div>
      </Container>
    </PageShell>
  );
}

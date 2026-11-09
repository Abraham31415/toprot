import type { Metadata } from "next";
import { PageHeading, PageShell, Prose } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Get started with ToProt: create a study, build the protocol, add references, run checks and generate documents.",
  alternates: { canonical: "/docs" },
};

export default function DocsPage() {
  return (
    <PageShell>
      <PageHeading eyebrow="Documentation" title="Getting started" lead="A walkthrough of the features that exist today." />
      <Prose>
        <h2>1. Create an account and a study</h2>
        <p>
          <a href="/register">Register</a>, choose whether you are a student or a supervisor, then start a study from
          your dashboard.
        </p>
        <h2>2. Build the protocol</h2>
        <p>
          Open the study and work through the sections: identity, objectives, population and eligibility, variables,
          sample size, statistics, data collection and ethics. Changes save automatically.
        </p>
        <h2>3. Calculate sample size</h2>
        <p>
          Choose a design, enter your assumptions and read the result along with a stress test showing how the required
          number changes with dropout and effect size. You can also use the <a href="/calculator">free calculator</a>{" "}
          without an account.
        </p>
        <h2>4. Add references</h2>
        <p>On the references page enter a DOI, a PubMed ID or a title. If a source cannot be found, add it manually.</p>
        <h2>5. Check the protocol</h2>
        <p>
          The quality panel lists consistency issues found by rule-based checks. You can optionally request AI reviewer
          questions. These are prompts to think about, not a verdict. Each request uses AI credits, and you can see your
          balance on the AI credits page.
        </p>
        <h2>6. Generate documents</h2>
        <p>
          The outputs page produces a data dictionary, KoBo and REDCap forms, a Stata skeleton, table shells, a methods
          paragraph, an ethics package and a consent form. Review each one before use.
        </p>
        <h2>7. Review, lock and track</h2>
        <p>
          Invite a supervisor to review, lock the protocol when it is final, then track milestones and log deviations
          during the study.
        </p>
      </Prose>
    </PageShell>
  );
}

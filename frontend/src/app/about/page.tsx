import type { Metadata } from "next";
import { PageHeading, PageShell, Prose } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "About",
  description: "Why ToProt exists and what it does and does not claim to do.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <PageShell>
      <PageHeading eyebrow="About" title="Built for postgraduate and clinical researchers" />
      <Prose>
        <p>
          Writing a protocol, planning the analysis, building data collection forms and preparing an ethics submission
          usually means re-typing the same study details into several documents. ToProt keeps those details in one
          structured place and generates the documents that follow from them.
        </p>
        <h2>What ToProt is</h2>
        <p>
          A research workspace for planning a study: a structured protocol builder, consistency checks, a sample size
          calculator, a reference manager and document generation, with supervisor review and study tracking.
        </p>
        <h2>What ToProt is not</h2>
        <ul>
          <li>It does not approve or grade your protocol. AI features only raise questions for you to consider.</li>
          <li>It has no regulatory certification, clinical validation or institutional endorsement.</li>
          <li>It does not replace your supervisor, statistician or ethics committee.</li>
          <li>Planned features such as the writing editor, literature search and PDF library are not built yet.</li>
        </ul>
        <h2>Where it stands</h2>
        <p>
          ToProt is in early access. Features and prices may change as we learn what researchers need. See the{" "}
          <a href="/features">features page</a> for the current list.
        </p>
      </Prose>
    </PageShell>
  );
}

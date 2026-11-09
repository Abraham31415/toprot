import type { Metadata } from "next";
import { PageHeading, PageShell, Prose } from "@/components/marketing/ui";
import { LEGAL_LAST_UPDATED } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using ToProt during early access.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <PageShell>
      <PageHeading
        eyebrow="Legal"
        title="Terms of Service"
        lead={`Last updated ${LEGAL_LAST_UPDATED}. ToProt is in early access and these terms may change.`}
      />
      <Prose>
        <h2>Using ToProt</h2>
        <p>
          You are responsible for the accuracy and ethics of your research. ToProt is a planning tool. It does not
          replace your supervisor, statistician, or ethics committee.
        </p>
        <h2>Generated content</h2>
        <p>
          Documents and AI reviewer questions are drafts. Review them before use. They are provided without any
          guarantee that they are correct or suitable for a particular submission.
        </p>
        <h2>Acceptable use</h2>
        <ul>
          <li>Do not enter identifiable patient or participant data.</li>
          <li>Do not attempt to bypass usage limits, access other users&apos; data, or disrupt the service.</li>
        </ul>
        <h2>AI credits and paid plans</h2>
        <p>
          AI features use credits and may be limited or paused. Paid plans are not yet available. If they are introduced,
          their terms will be published here before you are asked to pay.
        </p>
        <h2>Availability</h2>
        <p>
          The service is provided as is during early access, and features may change or be withdrawn. See the{" "}
          <a href="/privacy">privacy policy</a> for how data is handled.
        </p>
      </Prose>
    </PageShell>
  );
}

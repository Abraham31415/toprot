import type { Metadata } from "next";
import { PageHeading, PageShell, Prose } from "@/components/marketing/ui";
import { LEGAL_LAST_UPDATED } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What data ToProt stores, which services process it, and how to ask for deletion.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <PageShell>
      <PageHeading
        eyebrow="Legal"
        title="Privacy Policy"
        lead={`Last updated ${LEGAL_LAST_UPDATED}. This describes current practice and will change as the service develops.`}
      />
      <Prose>
        <h2>What we store</h2>
        <ul>
          <li>Account details: name, email address, role and institution you provide, and sign-in information.</li>
          <li>Your studies: protocols, variables, references, generated documents, milestones and deviation logs.</li>
          <li>AI usage records: when you used AI features, which model, and how many credits were used.</li>
        </ul>
        <h2>Please do not enter patient data</h2>
        <p>
          ToProt is for planning studies. Do not enter identifiable patient or participant information into protocols or
          any other field.
        </p>
        <h2>Who processes data for us</h2>
        <ul>
          <li>Supabase: database, authentication and file storage.</li>
          <li>Vercel: web hosting.</li>
          <li>Anthropic: when you request AI reviewer questions, the protocol text you submit is sent to Anthropic to generate the response.</li>
          <li>Resend: sending account and notification emails.</li>
          <li>CrossRef and PubMed: reference lookups send the identifier or title you enter.</li>
          <li>Google: only if you choose to sign in with Google.</li>
        </ul>
        <h2>Who can see your studies</h2>
        <p>
          Your studies are private to you and to a supervisor you choose to invite. We do not sell your data and do not
          use your protocols for advertising.
        </p>
        <h2>Your choices</h2>
        <p>
          You can ask for access to, correction of, or deletion of your data through the{" "}
          <a href="/contact">contact page</a>.
        </p>
      </Prose>
    </PageShell>
  );
}

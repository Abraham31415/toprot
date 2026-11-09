import type { Metadata } from "next";
import { PageHeading, PageShell, Prose } from "@/components/marketing/ui";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to contact the ToProt team.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <PageShell>
      <PageHeading eyebrow="Contact" title="Get in touch" />
      <Prose>
        {CONTACT_EMAIL ? (
          <p>
            Email us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with questions, feedback or privacy
            requests.
          </p>
        ) : (
          <p>
            A public contact address has not been published yet. Until then, please reach the team through the channel
            where you were given access to ToProt.
          </p>
        )}
      </Prose>
    </PageShell>
  );
}

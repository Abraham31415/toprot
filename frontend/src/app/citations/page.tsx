import type { Metadata } from "next";
import { Container, JsonLd, PageHeading, PageShell } from "@/components/marketing/ui";
import { CitationEditor } from "@/components/citations/citation-editor";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Citation Formatter",
  description:
    "Format in-text citations and bibliographies with Citation Style Language styles such as APA, Vancouver, Harvard, IEEE, Chicago and MLA. Import RIS, BibTeX or EndNote XML. Free, no AI.",
  alternates: { canonical: "/citations" },
};

export default function CitationsPage() {
  return (
    <PageShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "ToProt Citation Formatter",
          url: `${SITE_URL}/citations`,
          applicationCategory: "EducationalApplication",
          operatingSystem: "Web",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }}
      />
      <PageHeading eyebrow="Academic writing" title="Citation Formatter" lead="Write [@key] where a citation belongs, pick a style, and get formatted in-text citations and a bibliography. Change the style and everything updates." />
      <Container className="pb-16">
        <CitationEditor />
        <p className="mt-10 max-w-3xl text-xs leading-5 text-navy/60">
          Formatting uses the open-source citeproc-js processor with styles from the official Citation Style Language repository, licensed CC BY-SA 3.0 by their authors. It runs without AI and uses no AI credits. Always check the result against
          your journal&apos;s or institution&apos;s instructions, because style files follow published rules but your instructions may differ. This is a formatter, not a full word processor: copy the result or download it as a Word-compatible file.
        </p>
      </Container>
    </PageShell>
  );
}

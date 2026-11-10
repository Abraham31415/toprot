import type { Metadata } from "next";
import { Container, JsonLd, PageHeading, PageShell } from "@/components/marketing/ui";
import { LiteratureExplorer } from "@/components/literature/explorer";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Literature Explorer",
  description:
    "Search OpenAlex, PubMed and Crossref by keyword, title, author, journal, DOI and year. See accurate bibliographic records, open the original, export to RIS, BibTeX or EndNote XML, and build an evidence table. Free, no account needed to search.",
  alternates: { canonical: "/literature" },
};

export default function LiteraturePage() {
  return (
    <PageShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "ToProt Literature Explorer",
          url: `${SITE_URL}/literature`,
          applicationCategory: "EducationalApplication",
          operatingSystem: "Web",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }}
      />
      <PageHeading eyebrow="Literature" title="Literature Explorer" lead="Search scholarly records from OpenAlex, PubMed and Crossref. Free to search, with no AI and no invented citations." />
      <Container className="pb-16">
        <LiteratureExplorer />
      </Container>
    </PageShell>
  );
}

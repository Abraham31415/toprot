import type { Metadata } from "next";
import { ButtonLink, Container, PageShell } from "@/components/marketing/ui";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: true } };

export default function NotFound() {
  return (
    <PageShell>
      <Container className="py-20">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-ink">Error 404</p>
        <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">We could not find that page</h1>
        <p className="mt-4 max-w-xl text-lg text-navy/75">
          The address may be wrong, or the page may have moved. These might help.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/">Go to the home page</ButtonLink>
          <ButtonLink href="/tools" variant="secondary">Browse research tools</ButtonLink>
          <ButtonLink href="/resources" variant="secondary">Research guides</ButtonLink>
        </div>
      </Container>
    </PageShell>
  );
}

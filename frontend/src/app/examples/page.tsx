import type { Metadata } from "next";
import { Container, PageHeading, PageShell, ButtonLink } from "@/components/marketing/ui";
import { SAMPLE_STUDY as S } from "@/lib/sample-study";

export const metadata: Metadata = {
  title: "Sample study",
  description:
    "Explore a fictional sample study in ToProt: research question, objectives, protocol sections, variables, references, data dictionary and table shells. Download the sample data dictionary without an account.",
  alternates: { canonical: "/examples" },
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 text-sm leading-6 text-navy/80">{children}</div>
    </section>
  );
}

export default function ExamplesPage() {
  return (
    <PageShell>
      <PageHeading
        eyebrow="Sample study"
        title={S.title}
        lead="A read-only walkthrough built from fictional data. Nothing here describes real patients, clinics or results."
      />
      <Container className="pb-16">
        <p className="mb-6 rounded-md border border-gold/40 bg-gold/10 px-4 py-3 text-sm">
          This study is invented for demonstration. Illustrative references are placeholders, not real publications.
        </p>

        <div className="grid gap-5 md:grid-cols-2">
          <Card title="Research question">
            <p>{S.researchQuestion}</p>
            <p className="mt-2">
              <span className="font-medium">Design:</span> {S.design}
            </p>
          </Card>

          <Card title="Objectives">
            <ul className="space-y-2">
              {S.objectives.map((o) => (
                <li key={o.text}>
                  <span className="font-medium">{o.type}:</span> {o.text}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Protocol sections">
            <ol className="space-y-2">
              {S.protocolSections.map((s, i) => (
                <li key={s.name}>
                  <span className="font-medium">
                    {i + 1}. {s.name}.
                  </span>{" "}
                  {s.note}
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Sample size">
            <p>
              {S.sampleSize.design}, {S.sampleSize.confidence} confidence, {S.sampleSize.precision} precision, expected
              prevalence {S.sampleSize.expected}, {S.sampleSize.dropout} dropout.
            </p>
            <p className="mt-2 text-base font-semibold">Required sample: {S.sampleSize.result} participants</p>
            <p className="mt-2">
              Try the same inputs in the free{" "}
              <a href="/calculator" className="text-teal underline">
                sample size calculator
              </a>
              .
            </p>
          </Card>

          <Card title="Eligibility">
            <p className="font-medium">Inclusion</p>
            <ul className="ml-5 list-disc">
              {S.inclusion.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p className="mt-2 font-medium">Exclusion</p>
            <ul className="ml-5 list-disc">
              {S.exclusion.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Card>

          <Card title="References (illustrative)">
            <ol className="ml-5 list-decimal space-y-2">
              {S.references.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          </Card>
        </div>

        <section className="mt-5 rounded-lg border border-line bg-white p-5">
          <h2 className="text-lg font-semibold">Variables and data dictionary</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Variables in the sample study</caption>
              <thead className="border-b border-line text-xs uppercase text-navy/60">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">Variable</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Label</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Type</th>
                  <th scope="col" className="py-2 font-medium">Role</th>
                </tr>
              </thead>
              <tbody>
                {S.variables.map((v) => (
                  <tr key={v.name} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{v.name}</td>
                    <td className="py-2 pr-4">{v.label}</td>
                    <td className="py-2 pr-4">{v.type}</td>
                    <td className="py-2">{v.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4">
            <a
              href="/examples/sample-data-dictionary.csv"
              download
              className="inline-block rounded-md border border-navy/25 px-4 py-2 text-sm font-medium hover:border-teal hover:text-teal"
            >
              Download sample data dictionary (CSV)
            </a>
          </p>
        </section>

        <section className="mt-5 rounded-lg border border-line bg-white p-5">
          <h2 className="text-lg font-semibold">Statistical table shells</h2>
          <div className="mt-3 grid gap-5 md:grid-cols-2">
            {S.tableShells.map((t) => (
              <div key={t.title} className="overflow-x-auto">
                <p className="mb-2 text-sm font-medium">{t.title}</p>
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line text-xs uppercase text-navy/60">
                    <tr>
                      {t.columns.map((c) => (
                        <th key={c} scope="col" className="py-2 pr-4 font-medium">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r) => (
                      <tr key={r} className="border-b border-line last:border-0">
                        <td className="py-2 pr-4">{r}</td>
                        {t.columns.slice(1).map((c) => (
                          <td key={c} className="py-2 pr-4 text-navy/40">&nbsp;</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/register">Start your own study</ButtonLink>
          <ButtonLink href="/how-it-works" variant="secondary">
            See how it works
          </ButtonLink>
        </div>
      </Container>
    </PageShell>
  );
}

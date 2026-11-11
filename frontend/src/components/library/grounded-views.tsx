"use client";

import Link from "next/link";
import { AlertTriangle, BadgeCheck, Sparkles } from "lucide-react";
import type { AskResult, VerifiedCell, VerifiedPaper, VerifiedPoint } from "@/lib/pdf/qa";

/** Renders search headlines where matches are wrapped in [[ ]] without using innerHTML. */
export function Headline({ text }: { text: string }) {
  const parts = text.split(/(\[\[|\]\])/);
  let on = false;
  return (
    <>
      {parts.map((p, i) => {
        if (p === "[[") { on = true; return null; }
        if (p === "]]") { on = false; return null; }
        return on ? <mark key={i} className="rounded bg-yellow-200 px-0.5">{p}</mark> : <span key={i}>{p}</span>;
      })}
    </>
  );
}

function SourceQuote({ quote, title, page, documentId }: { quote: string; title?: string; page?: number; documentId?: string }) {
  return (
    <figure className="mt-2 rounded-md border-l-4 border-teal bg-teal/5 p-3">
      <figcaption className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-teal-ink">
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified in the document
        {title && <span className="font-normal text-navy/70">{title}{page ? `, PDF page ${page}` : ""}</span>}
        {documentId && page && <Link className="font-normal text-cobalt underline" href={`/library/${documentId}?page=${page}`}>Open page</Link>}
      </figcaption>
      <blockquote className="mt-1 text-sm italic text-navy">&ldquo;{quote}&rdquo;</blockquote>
    </figure>
  );
}

function Unverified({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span>{children}</span></p>;
}

function Numbers({ numbers }: { numbers: string[] }) {
  if (!numbers.length) return null;
  return <Unverified>These numbers are in the AI&apos;s wording but not in the quoted passage: {numbers.join(", ")}. Check them against the PDF.</Unverified>;
}

function Point({ p }: { p: VerifiedPoint }) {
  return (
    <li className="rounded-md border border-line bg-white p-3">
      <p className="flex items-start gap-1.5 text-sm text-navy"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cobalt" aria-label="AI wording" /> <span>{p.statement}</span></p>
      {p.status === "verified" && p.quote ? <SourceQuote quote={p.quote} title={p.title} page={p.page} documentId={p.documentId} /> : <Unverified>No matching quote was found in the document for this statement. Treat it as AI interpretation, not as something the paper says.</Unverified>}
      <Numbers numbers={p.numbersNotInQuote} />
    </li>
  );
}

export const AI_NOTE = "Statements marked with the sparkle are written by AI. Only the green quoted passages are checked word for word against your PDF's extracted text. Page numbers are PDF pages, which can differ from the printed page numbers.";

export function AnswerView({ result }: { result: AskResult }) {
  return (
    <section aria-label="Answer" className="mt-4">
      {!result.found ? (
        <p className="rounded-md border border-line bg-white p-3 text-sm text-navy">The selected PDFs do not answer this.{result.note ? ` ${result.note}` : ""}</p>
      ) : (
        <>
          <ul className="space-y-2">{result.points.map((p, i) => <Point key={i} p={p} />)}</ul>
          {result.note && <p className="mt-2 text-xs text-navy/70">Note from the AI: {result.note}</p>}
        </>
      )}
      <p className="mt-3 text-xs text-navy/60">{AI_NOTE}</p>
      {result.sources.length > 0 && (
        <details className="mt-3 rounded-md border border-line bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium text-navy">Passages the answer is based on ({result.sources.length})</summary>
          <ul className="mt-2 space-y-2">
            {result.sources.map((s) => (
              <li key={s.n} className="text-xs text-navy/80"><span className="font-medium text-navy">{s.title}, PDF page {s.page}</span> <Link className="text-cobalt underline" href={`/library/${s.documentId}?page=${s.page}`}>Open</Link><span className="mt-0.5 block">{s.text}</span></li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

const STATUS_LABEL: Record<VerifiedCell["status"], string> = { verified: "Verified", unverified: "Not verified", not_stated: "Not stated" };

export function CompareView({ papers }: { papers: VerifiedPaper[] }) {
  if (!papers.length) return null;
  const fields = papers[0].cells;
  return (
    <section aria-label="Comparison" className="mt-4">
      <div className="overflow-x-auto rounded-md border border-line bg-white">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">Comparison of the selected papers</caption>
          <thead>
            <tr className="bg-soft/50 text-left">
              <th scope="col" className="w-36 border-b border-line p-2 text-xs font-semibold text-navy">Field</th>
              {papers.map((p) => <th key={p.n} scope="col" className="border-b border-l border-line p-2 text-xs font-semibold text-navy"><Link className="hover:text-cobalt" href={`/library/${p.documentId}`}>{p.title}</Link></th>)}
            </tr>
          </thead>
          <tbody>
            {fields.map((f, row) => (
              <tr key={f.field} className="align-top">
                <th scope="row" className="border-b border-line p-2 text-left text-xs font-medium text-navy">{f.label}</th>
                {papers.map((p) => {
                  const c = p.cells[row];
                  return (
                    <td key={p.n} className="border-b border-l border-line p-2">
                      {c.status === "not_stated" ? <span className="text-xs text-navy/55">Not stated in the retrieved text</span> : (
                        <>
                          <span className="flex items-start gap-1 text-navy"><Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-cobalt" aria-label="AI wording" />{c.value}</span>
                          {c.status === "verified" && c.quote ? (
                            <span className="mt-1 block rounded border-l-2 border-teal bg-teal/5 px-2 py-1 text-xs italic text-navy/80"><span className="not-italic font-semibold text-teal-ink">{STATUS_LABEL.verified}{c.page ? `, p. ${c.page}` : ""}: </span>&ldquo;{c.quote}&rdquo;</span>
                          ) : <span className="mt-1 block text-xs text-amber-900">{STATUS_LABEL.unverified}: no matching quote found. Treat as AI interpretation.</span>}
                          {c.numbersNotInQuote.length > 0 && <span className="mt-1 block text-xs text-amber-900">Numbers not in the quote: {c.numbersNotInQuote.join(", ")}</span>}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-navy/60">The comparison uses only the most relevant passages of each PDF (the opening pages and the passages that best match each field), not the full text. &ldquo;Not stated&rdquo; means the retrieved passages did not say, not that the paper does not. {AI_NOTE}</p>
    </section>
  );
}

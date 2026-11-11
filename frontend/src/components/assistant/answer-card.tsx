"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, BadgeCheck, BookMarked, Copy, FileText, Info, Sparkles } from "lucide-react";
import type { VerifiedSource } from "@/lib/assistant/answer";
import { STOP_NOTICE, type AssistantAnswerMessage } from "@/lib/assistant/types";
import { getTask } from "@/lib/assistant/tasks";

const TIER_LABEL = { light: "Light", standard: "Standard", deep: "Deep" } as const;

function href(s: VerifiedSource, studyId: string | null): string | null {
  switch (s.type) {
    case "pdf": return `/library/${s.id}${s.page ? `?page=${s.page}` : ""}`;
    case "reference": return studyId ? `/studies/${studyId}/references` : null;
    case "manuscript": return studyId ? `/studies/${studyId}/writing/${s.id}` : null;
    case "protocol": return studyId ? `/studies/${studyId}/protocol` : null;
  }
}

function Source({ s, studyId }: { s: VerifiedSource; studyId: string | null }) {
  const link = href(s, studyId);
  const Icon = s.type === "reference" ? BookMarked : FileText;
  return (
    <li className={`rounded-md border-l-4 p-2 text-xs ${s.status === "verified" ? "border-teal bg-teal/5" : "border-line bg-paper"}`}>
      <p className="flex flex-wrap items-center gap-x-2 font-medium text-navy">
        {s.status === "verified" ? <BadgeCheck className="h-3.5 w-3.5 text-teal-ink" aria-label="Quote verified" /> : <Icon className="h-3.5 w-3.5 text-navy/60" aria-hidden="true" />}
        <span>{s.label}</span>
        {link && <Link href={link} className="font-normal text-cobalt underline">Open</Link>}
      </p>
      {s.quote && <blockquote className="mt-1 italic text-navy/85"><span className="not-italic font-semibold text-teal-ink">Verified in your document: </span>&ldquo;{s.quote}&rdquo;</blockquote>}
      {!s.quote && s.status === "cited" && <p className="mt-0.5 text-navy/60">Exists in your project. No quotation was verified.</p>}
      {s.note && <p className="mt-0.5 text-amber-900">{s.note}</p>}
    </li>
  );
}

export function AnswerCard({ m, studyId }: { m: AssistantAnswerMessage; studyId: string | null }) {
  const [copied, setCopied] = useState<number | null>(null);
  const copy = async (text: string, i: number) => { try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard unavailable */ } };
  const a = m.answer;
  const notice = STOP_NOTICE[m.stop];
  return (
    <article className="rounded-md border border-line bg-white" aria-label="AI answer">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-soft px-2 py-0.5 font-semibold text-cobalt"><Sparkles className="h-3 w-3" aria-hidden="true" /> AI-generated</span>
        <span className="text-navy/60">{getTask(m.task)?.label ?? "Assistant"} · {TIER_LABEL[m.tier]} tier{m.chargedCredits ? ` · ${m.chargedCredits.toFixed(m.chargedCredits < 10 ? 1 : 0)} credits` : ""}</span>
      </header>
      <div className="space-y-3 p-3">
        {a.summary && <p className="text-sm font-medium text-navy">{a.summary}</p>}
        {a.blocks.map((b, i) => (
          <section key={i} className="rounded-md border border-line p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-navy">{b.heading ?? (b.kind === "rewrite" ? "Suggested rewrite" : b.kind === "question" ? "Question to consider" : b.kind === "plan" ? "Plan" : b.kind === "suggestion" ? "Suggestion" : "Analysis")}</h3>
              <button type="button" onClick={() => copy(b.text, i)} className="inline-flex shrink-0 items-center gap-1 rounded border border-navy/25 px-2 py-0.5 text-xs text-navy hover:border-cobalt" aria-label="Copy this text"><Copy className="h-3 w-3" aria-hidden="true" /> {copied === i ? "Copied" : "Copy"}</button>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-navy/90">{b.text}</p>
            {b.sources.length > 0 ? (
              <ul className="mt-2 space-y-1.5" aria-label="Sources">{b.sources.map((s, j) => <Source key={j} s={s} studyId={studyId} />)}</ul>
            ) : (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-navy/55"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> AI reasoning, not tied to a document in your project. Check it yourself.</p>
            )}
          </section>
        ))}
        {a.suggestedSearches.length > 0 && (
          <section aria-label="Suggested searches" className="rounded-md bg-paper p-3 text-xs text-navy">
            <p className="font-semibold">Suggested literature searches (not citations)</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">{a.suggestedSearches.map((q) => <li key={q} className="rounded-full border border-navy/20 bg-white px-2.5 py-0.5">{q}</li>)}</ul>
            <p className="mt-1.5 text-navy/65">Run these in the <Link className="text-cobalt underline" href="/literature">Literature Explorer</Link> to find real papers.</p>
          </section>
        )}
        {(a.caveats.length > 0 || notice) && (
          <ul className="space-y-1" aria-label="Caveats">
            {a.caveats.map((c, i) => <li key={i} className="flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {c}</li>)}
          </ul>
        )}
        {(a.removedSources > 0 || a.redactedCitations.length > 0) && (
          <p role="note" className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
            {a.redactedCitations.length > 0 && <>Removed {a.redactedCitations.length} citation-like reference{a.redactedCitations.length === 1 ? "" : "s"} that {a.redactedCitations.length === 1 ? "is" : "are"} not in your saved references ({a.redactedCitations.slice(0, 3).join("; ")}{a.redactedCitations.length > 3 ? "; ..." : ""}). </>}
            {a.removedSources > 0 && <>Removed {a.removedSources} source{a.removedSources === 1 ? "" : "s"} the assistant named but never read.</>}
          </p>
        )}
        <details className="text-xs text-navy/65">
          <summary className="cursor-pointer">How this was produced</summary>
          <ul className="mt-1 list-disc pl-4">
            {m.routeReasons.map((r, i) => <li key={i}>{r}</li>)}
            <li>{m.iterations} model pass{m.iterations === 1 ? "" : "es"} and {m.toolCalls} read{m.toolCalls === 1 ? "" : "s"} of your project.</li>
          </ul>
        </details>
      </div>
    </article>
  );
}

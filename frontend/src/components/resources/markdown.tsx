import Link from "next/link";
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { parseInline } from "@/lib/resources/guide-core.mjs";
import type { Block } from "@/lib/resources/articles";

// Renders the parsed Markdown of a guide. It builds React elements and never injects HTML, so text in a guide cannot add markup or scripts.

type Token = { type: string; text?: string; href?: string; nums?: string[]; children?: Token[] };

function Inline({ tokens }: { tokens: Token[] }): ReactNode {
  return tokens.map((t, i) => {
    switch (t.type) {
      case "strong": return <strong key={i} className="font-semibold text-ink"><Inline tokens={t.children ?? []} /></strong>;
      case "em": return <em key={i}><Inline tokens={t.children ?? []} /></em>;
      case "code": return <code key={i} className="rounded bg-surface-soft px-1 py-0.5 text-[0.9em] text-ink">{t.text}</code>;
      case "link": {
        const href = t.href ?? "#";
        const external = /^https?:\/\//.test(href);
        const cls = "font-medium text-primary underline underline-offset-2 hover:text-primary-hover";
        return external
          ? <a key={i} href={href} rel="noopener noreferrer" target="_blank" className={cls}><Inline tokens={t.children ?? []} /></a>
          : <Link key={i} href={href} className={cls}><Inline tokens={t.children ?? []} /></Link>;
      }
      case "cite":
        return (
          <sup key={i} className="text-[0.7em]">
            [{(t.nums ?? []).map((n, j) => <span key={j}>{j > 0 && ", "}<a href={`#ref-${n.replace(/\D/g, "")}`} className="text-primary hover:underline" aria-label={`Source ${n}`}>{n}</a></span>)}]
          </sup>
        );
      default: return <span key={i}>{t.text}</span>;
    }
  });
}

const inline = (text: string) => <Inline tokens={parseInline(text) as Token[]} />;

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading":
            return b.level === 2
              ? <h2 key={i} id={b.id} className="mt-10 scroll-mt-24 text-2xl font-semibold tracking-tight text-ink first:mt-0">{b.text}</h2>
              : <h3 key={i} id={b.id} className="mt-6 scroll-mt-24 text-lg font-semibold text-ink">{b.text}</h3>;
          case "p":
            return <p key={i} className="mt-4">{inline(b.text)}</p>;
          case "ul":
            return <ul key={i} className="mt-4 list-disc space-y-1.5 pl-6">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
          case "ol":
            return <ol key={i} className="mt-4 list-decimal space-y-1.5 pl-6">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
          case "table":
            return (
              <div key={i} className="mt-5 overflow-x-auto rounded-card border border-line">
                <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
                  <thead className="bg-canvas">
                    <tr>{b.header.map((h, j) => <th key={j} scope="col" className="border-b border-line px-3 py-2 font-semibold text-ink">{inline(h)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => <tr key={j} className="border-t border-line">{r.map((c, k) => <td key={k} className="px-3 py-2 align-top">{inline(c)}</td>)}</tr>)}
                  </tbody>
                </table>
              </div>
            );
          case "math":
            return (
              <div key={i} role="math" aria-label={b.text.replace(/\s+/g, " ")} className="mt-5 overflow-x-auto rounded-control border border-line bg-surface px-4 py-3 text-center font-serif text-lg text-ink">
                {b.text.split("\n").map((line, j) => <div key={j}>{line}</div>)}
              </div>
            );
          case "code":
            return <pre key={i} className="mt-4 overflow-x-auto rounded-control bg-surface-soft p-3 text-sm text-ink"><code>{b.text}</code></pre>;
          case "callout":
            return (
              <aside key={i} className="mt-6 rounded-card border border-info-line bg-info-bg/60 p-4 text-[0.95em]">
                {b.title && <p className="flex items-center gap-2 font-semibold text-ink"><Info className="h-4 w-4 flex-none text-primary" aria-hidden="true" />{b.title}</p>}
                <div className="[&>*:first-child]:mt-2"><Blocks blocks={b.blocks} /></div>
              </aside>
            );
          case "rule":
            return <hr key={i} className="my-8 border-line" />;
        }
      })}
    </>
  );
}

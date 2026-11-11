import { getProcessor, createProcessor, type Locales } from "@/lib/csl/engine";
import type { CslItem } from "@/lib/refs/convert";
import { collectCitations, type DocNode } from "./doc";

// Formats a manuscript's citations and bibliography with the citeproc-js engine, from the study's own references.
// Nothing is generated: a citation only ever renders from a reference the user saved.

export type FormattedManuscript = {
  /** One formatted citation per citation node, in document order. Empty string if none of its references exist. */
  labels: string[];
  kind: "in-text" | "note";
  bibliographyHtml: string[];
  bibliographyText: string[];
  /** References that were cited but are not in the library any more. */
  missing: string[];
  /** Library references the text never cites. */
  uncited: string[];
};

export function formatManuscript(
  doc: DocNode,
  items: CslItem[],
  style: { id: string; xml: string; locales: Locales },
  opts: { reuse?: boolean } = {},
): FormattedManuscript {
  const clusters = collectCitations(doc);
  const known = new Set(items.map((i) => String(i.id)));
  const proc = opts.reuse === false ? createProcessor(style.xml, style.locales, items) : getProcessor(`ms:${style.id}`, style.xml, style.locales, items);
  const labels = proc.cite(clusters.map((c) => c.map((x) => ({ id: x.id, ...(x.locator ? { locator: x.locator, label: "page" } : {}) }))));
  const cited = new Set(clusters.flat().map((c) => c.id));
  const bib = proc.bibliography();
  return {
    labels,
    kind: proc.meta.kind === "note" ? "note" : "in-text",
    bibliographyHtml: bib.html,
    bibliographyText: bib.text,
    missing: [...cited].filter((id) => !known.has(id)),
    uncited: [...known].filter((id) => !cited.has(id)),
  };
}

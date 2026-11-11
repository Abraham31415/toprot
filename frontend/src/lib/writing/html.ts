import { safeHref, type Doc, type DocNode } from "./doc";
import type { FormattedManuscript } from "./format";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type RenderOptions = {
  title: string;
  /** Signed or public URLs for figure images, by storage path. A figure without one shows its caption only. */
  figureUrls?: Record<string, string>;
  bibliographyHeading?: string;
};

function renderText(n: DocNode): string {
  let out = esc(n.text ?? "");
  for (const m of n.marks ?? []) {
    switch (m.type) {
      case "bold": out = `<strong>${out}</strong>`; break;
      case "italic": out = `<em>${out}</em>`; break;
      case "underline": out = `<u>${out}</u>`; break;
      case "strike": out = `<s>${out}</s>`; break;
      case "code": out = `<code>${out}</code>`; break;
      case "superscript": out = `<sup>${out}</sup>`; break;
      case "subscript": out = `<sub>${out}</sub>`; break;
      case "link": { const h = safeHref(m.attrs?.href); if (h) out = `<a href="${esc(h)}">${out}</a>`; break; }
    }
  }
  return out;
}

/** Renders the manuscript as a standalone article body (used for print / Save as PDF and for the HTML preview). */
export function renderBody(doc: Doc, fmt: FormattedManuscript | null, opts: RenderOptions): string {
  let citeIdx = 0, figN = 0, noteN = 0;
  const notes: string[] = [];
  const inline = (n: DocNode): string => {
    switch (n.type) {
      case "text": return renderText(n);
      case "hardBreak": return "<br>";
      case "citation": {
        const label = fmt?.labels[citeIdx++] ?? "";
        if (!label) return '<span class="cite-missing">[missing reference]</span>';
        if (fmt?.kind === "note") { notes.push(label); return `<sup class="fn">${++noteN}</sup>`; }
        return `<span class="cite">${label}</span>`;
      }
      default: return (n.content ?? []).map(inline).join("");
    }
  };
  const block = (n: DocNode): string => {
    const kids = () => (n.content ?? []).map(block).join("");
    const inl = () => (n.content ?? []).map(inline).join("");
    switch (n.type) {
      case "paragraph": return `<p>${inl()}</p>`;
      case "heading": { const l = Math.min(Math.max(Number(n.attrs?.level ?? 2), 1), 4); return `<h${l + 1}>${inl()}</h${l + 1}>`; }
      case "bulletList": return `<ul>${kids()}</ul>`;
      case "orderedList": { const s = Number(n.attrs?.start ?? 1); return `<ol${s !== 1 ? ` start="${s}"` : ""}>${kids()}</ol>`; }
      case "listItem": return `<li>${kids()}</li>`;
      case "blockquote": return `<blockquote>${kids()}</blockquote>`;
      case "codeBlock": return `<pre><code>${esc((n.content ?? []).map((c) => c.text ?? "").join(""))}</code></pre>`;
      case "horizontalRule": return "<hr>";
      case "table": return `<table>${kids()}</table>`;
      case "tableRow": return `<tr>${kids()}</tr>`;
      case "tableCell":
      case "tableHeader": {
        const tag = n.type === "tableHeader" ? "th" : "td";
        const cs = Number(n.attrs?.colspan ?? 1), rs = Number(n.attrs?.rowspan ?? 1);
        return `<${tag}${cs > 1 ? ` colspan="${cs}"` : ""}${rs > 1 ? ` rowspan="${rs}"` : ""}>${kids()}</${tag}>`;
      }
      case "figure": {
        figN++;
        const url = opts.figureUrls?.[String(n.attrs?.path)];
        const caption = String(n.attrs?.caption ?? "");
        const img = url ? `<img src="${esc(url)}" alt="${esc(String(n.attrs?.alt ?? ""))}">` : '<div class="no-img">[image not available]</div>';
        return `<figure>${img}<figcaption><strong>Figure ${figN}.</strong> ${esc(caption)}</figcaption></figure>`;
      }
      default: return inl();
    }
  };
  const body = doc.content.map(block).join("\n");
  const entries = fmt?.bibliographyHtml ?? [];
  const bib = entries.length ? `<section class="bibliography"><h2>${esc(opts.bibliographyHeading ?? "References")}</h2>${entries.join("\n")}</section>` : "";
  const fn = notes.length ? `<section class="notes"><h2>Notes</h2><ol>${notes.map((x) => `<li>${x}</li>`).join("")}</ol></section>` : "";
  return `${body}\n${fn}\n${bib}`;
}

export const PRINT_CSS = `
@page { size: A4; margin: 25mm 22mm; }
* { box-sizing: border-box; }
body { font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.5; color: #111; margin: 0; }
h1.title { font-size: 20pt; text-align: center; margin: 0 0 14pt; line-height: 1.25; }
h2 { font-size: 16pt; margin: 18pt 0 6pt; } h3 { font-size: 13.5pt; margin: 14pt 0 4pt; } h4 { font-size: 12pt; margin: 12pt 0 4pt; } h5 { font-size: 12pt; font-style: italic; margin: 10pt 0 4pt; }
h2, h3, h4, h5 { break-after: avoid; }
p { margin: 0 0 8pt; text-align: left; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 8pt 22pt; padding: 0; } li > p { margin: 0 0 2pt; }
blockquote { margin: 0 0 8pt 18pt; padding-left: 10pt; border-left: 2px solid #999; color: #333; }
pre { background: #f4f4f4; padding: 8pt; font-size: 10pt; white-space: pre-wrap; } code { font-family: Consolas, monospace; font-size: 10.5pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 12pt; font-size: 10.5pt; break-inside: avoid; }
th, td { border: 1px solid #444; padding: 3pt 5pt; vertical-align: top; text-align: left; } th { background: #eee; }
figure { margin: 10pt 0 14pt; text-align: center; break-inside: avoid; } figure img { max-width: 100%; max-height: 220mm; }
figcaption { font-size: 10.5pt; margin-top: 4pt; text-align: left; }
.bibliography .csl-entry { margin: 0 0 6pt; padding-left: 22pt; text-indent: -22pt; } .bibliography .csl-left-margin { display: inline-block; min-width: 22pt; }
.cite-missing { color: #b00020; } a { color: #111; }
sup.fn { font-size: 8pt; }
`;

/** A complete HTML document ready to be opened in a window and printed ("Save as PDF"). */
export function renderPrintDocument(doc: Doc, fmt: FormattedManuscript | null, opts: RenderOptions & { subtitle?: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(opts.title)}</title><style>${PRINT_CSS}</style></head><body><h1 class="title">${esc(opts.title)}</h1>${opts.subtitle ? `<p style="text-align:center;color:#444">${esc(opts.subtitle)}</p>` : ""}${renderBody(doc, fmt, opts)}</body></html>`;
}

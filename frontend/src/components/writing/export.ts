import type { Doc } from "@/lib/writing/doc";
import type { FormattedManuscript } from "@/lib/writing/format";
import type { FigureImage } from "@/lib/writing/docx";
import { signedFigureUrl, signedFigureUrls } from "./figure-url";

function sniff(bytes: Uint8Array): FigureImage["type"] | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "gif";
  return null;
}

/** Loads a figure for the Word export. Anything that is not really a PNG, JPEG or GIF is skipped (its caption still exports). */
async function fetchFigure(path: string): Promise<FigureImage | null> {
  const url = await signedFigureUrl(path);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = new Uint8Array(await res.arrayBuffer());
  const type = sniff(data);
  return type ? { data, type } : null;
}

const safeName = (title: string) => (title.replace(/[^\p{L}\p{N}\s._-]/gu, "").trim().replace(/\s+/g, "_").slice(0, 80) || "manuscript");

export async function downloadDocx(doc: Doc, fmt: FormattedManuscript | null, title: string): Promise<void> {
  const [{ buildDocx }, { Packer }] = await Promise.all([import("@/lib/writing/docx"), import("docx")]);
  const built = await buildDocx(doc, fmt, { title, fetchImage: fetchFigure });
  const blob = await Packer.toBlob(built);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName(title)}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * "Save as PDF" uses the browser's own print engine, so the PDF has selectable text and exact fonts.
 * The window is opened before any asynchronous work so pop-up blockers treat it as the user's click.
 */
export async function printAsPdf(doc: Doc, fmt: FormattedManuscript | null, title: string, subtitle?: string): Promise<{ error?: string }> {
  const win = window.open("", "_blank");
  if (!win) return { error: "Your browser blocked the print window. Allow pop-ups for this site and try again." };
  win.document.write("<!doctype html><title>Preparing...</title><p style=\"font-family:sans-serif\">Preparing your document...</p>");
  try {
    const { renderPrintDocument } = await import("@/lib/writing/html");
    const paths: string[] = [];
    const find = (n: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }) => { if (n.type === "figure") paths.push(String(n.attrs?.path)); (n.content as typeof n[] | undefined)?.forEach(find); };
    find(doc as never);
    const figureUrls = await signedFigureUrls(paths);
    const html = renderPrintDocument(doc, fmt, { title, subtitle, figureUrls });
    win.document.open();
    win.document.write(html);
    win.document.close();
    const imgs = Array.from(win.document.images);
    await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise<void>((r) => { i.onload = i.onerror = () => r(); }))));
    win.focus();
    win.print();
    return {};
  } catch {
    win.close();
    return { error: "Could not prepare the PDF. Try the Word export instead." };
  }
}

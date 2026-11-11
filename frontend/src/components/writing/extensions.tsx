"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import Placeholder from "@tiptap/extension-placeholder";
import { ImageOff } from "lucide-react";
import type { CitationRef } from "@/lib/writing/doc";
import { signedFigureUrl } from "./figure-url";

// What the editor needs to draw a citation: the formatted text, and a plain fallback while a style is loading.
export type CitationContext = {
  labels: string[];
  kind: "in-text" | "note";
  fallback: Record<string, string>;
  onEdit: (pos: number) => void;
};
export const CitationCtx = createContext<CitationContext>({ labels: [], kind: "in-text", fallback: {}, onEdit: () => {} });

/** The position of a citation among all citations in the document, which is the order citeproc numbers them in. */
function citationIndex(props: ReactNodeViewProps): number {
  const pos = props.getPos();
  if (pos === undefined) return -1;
  let n = -1;
  props.editor.state.doc.descendants((node, p) => {
    if (node.type.name === "citation") { n++; if (p === pos) return false; }
    return n === -1 || p < pos;
  });
  return n;
}

function CitationView(props: ReactNodeViewProps) {
  const ctx = useContext(CitationCtx);
  const items = (props.node.attrs.items as CitationRef[]) ?? [];
  const idx = citationIndex(props);
  const label = idx >= 0 ? ctx.labels[idx] : "";
  const fallback = items.map((i) => ctx.fallback[i.id] ?? "?").join("; ");
  return (
    <NodeViewWrapper as="span" className="inline">
      <button
        type="button"
        data-citation=""
        contentEditable={false}
        onClick={() => { const p = props.getPos(); if (p !== undefined) ctx.onEdit(p); }}
        className={`rounded px-0.5 text-cobalt hover:bg-soft focus:outline-2 focus:outline-cobalt ${props.selected ? "bg-soft" : ""}`}
        title="Edit this citation"
      >
        {ctx.kind === "note" && label ? <sup>{idx + 1}</sup> : label ? <span dangerouslySetInnerHTML={{ __html: label }} /> : <span className="opacity-70">({fallback})</span>}
      </button>
    </NodeViewWrapper>
  );
}

export const Citation = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      items: {
        default: [] as CitationRef[],
        parseHTML: (el) => { try { return JSON.parse(el.getAttribute("data-items") ?? "[]"); } catch { return []; } },
        renderHTML: (attrs) => ({ "data-items": JSON.stringify(attrs.items) }),
      },
    };
  },
  parseHTML() { return [{ tag: "span[data-citation-node]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes({ "data-citation-node": "" }, HTMLAttributes), "[citation]"]; },
  addNodeView() { return ReactNodeViewRenderer(CitationView, { as: "span" }); },
});

function FigureView(props: ReactNodeViewProps) {
  const { path, alt, caption, width, height } = props.node.attrs as { path: string; alt: string; caption: string; width: number; height: number };
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    signedFigureUrl(path).then((u) => { if (!live) return; if (u) setUrl(u); else setFailed(true); });
    return () => { live = false; };
  }, [path]);
  const editable = props.editor.isEditable;
  return (
    <NodeViewWrapper className={`my-4 rounded-md border p-3 ${props.selected ? "border-cobalt" : "border-line"}`} data-figure="">
      <div contentEditable={false} className="flex flex-col items-center gap-2">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={alt} width={width} height={height} className="max-h-96 w-auto max-w-full object-contain" onError={() => setFailed(true)} />
        ) : (
          <div className="flex h-24 w-full items-center justify-center gap-2 text-sm text-navy/60">{failed ? <><ImageOff className="h-4 w-4" aria-hidden="true" /> Image not available</> : "Loading image..."}</div>
        )}
        {editable ? (
          <>
            <label className="sr-only" htmlFor={`cap-${path}`}>Figure caption</label>
            <input id={`cap-${path}`} className="w-full rounded border border-navy/25 px-2 py-1 text-sm text-navy" placeholder="Figure caption" maxLength={1000} value={caption}
              onChange={(e) => props.updateAttributes({ caption: e.target.value })} />
            <label className="sr-only" htmlFor={`alt-${path}`}>Alternative text</label>
            <input id={`alt-${path}`} className="w-full rounded border border-navy/25 px-2 py-1 text-xs text-navy" placeholder="Alternative text for screen readers (describe the image)" maxLength={300} value={alt}
              onChange={(e) => props.updateAttributes({ alt: e.target.value })} />
          </>
        ) : caption ? <p className="w-full text-sm text-navy">{caption}</p> : null}
      </div>
    </NodeViewWrapper>
  );
}

export const Figure = Node.create({
  name: "figure",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { path: { default: "" }, alt: { default: "" }, caption: { default: "" }, width: { default: 600 }, height: { default: 400 } };
  },
  parseHTML() { return [{ tag: "figure[data-figure-node]" }]; },
  renderHTML({ HTMLAttributes }) { return ["figure", mergeAttributes({ "data-figure-node": "" }, HTMLAttributes)]; },
  addNodeView() { return ReactNodeViewRenderer(FigureView); },
});

export function buildExtensions(placeholder: string) {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, link: { openOnClick: false, autolink: false, HTMLAttributes: { rel: "noopener noreferrer nofollow" } } }),
    Superscript,
    Subscript,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({ placeholder }),
    Citation,
    Figure,
  ];
}

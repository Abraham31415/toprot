"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  ArrowLeft, Bold, BookMarked, Download, History, ImagePlus, Italic, List, ListOrdered, Maximize2, Minimize2, Minus, Printer, Redo2,
  Save, Strikethrough, Subscript, Superscript, Table2, TextQuote, Underline, Undo2, Link2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadStyle, type LoadedStyle } from "@/lib/csl/client";
import { StylePicker } from "@/components/citations/style-picker";
import { rowToRef, toCslItem, type CslItem, type RefRow } from "@/lib/refs/convert";
import { shortCitation } from "@/lib/literature/convert";
import { countWords, dropMissingCitations, outline, sectionWordCounts, safeHref, type CitationRef, type Doc } from "@/lib/writing/doc";
import { formatManuscript, type FormattedManuscript } from "@/lib/writing/format";
import { getTemplate, hintFor, type TemplateId } from "@/lib/writing/templates";
import { loadLatest, overwriteManuscript, saveManuscript, setManuscriptStyle } from "@/app/studies/[id]/writing/actions";
import { buildExtensions, CitationCtx } from "./extensions";
import { CitationDialog, type PickRef } from "./citation-dialog";
import { HistoryPanel } from "./history-panel";
import { downloadDocx, printAsPdf } from "./export";

type Manuscript = { id: string; studyId: string; studyTitle: string; title: string; template: TemplateId; styleId: string; revision: number; content: Doc };
type SavedRef = RefRow & { id: string };
type Status = "saved" | "dirty" | "saving" | "error" | "conflict";

const AUTOSAVE_MS = 1500;
const MAX_FIGURE_BYTES = 5 * 1024 * 1024;
const FIGURE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" };

function useManuscriptStyle(initial: string, onChange: (id: string) => void) {
  const [styleId, setStyleIdState] = useState(initial);
  const [style, setStyle] = useState<LoadedStyle | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setBusy(true); setError(null);
    loadStyle(styleId).then((s) => { if (live) setStyle(s); }).catch((e: Error) => { if (live) setError(e.message); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [styleId]);
  const setStyleId = (id: string) => { setStyleIdState(id); onChange(id); };
  return { styleId, setStyleId, style, busy, error };
}

function Btn({ label, onClick, active, disabled, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded text-navy hover:bg-soft disabled:opacity-40 ${active ? "bg-soft text-cobalt" : ""}`}>
      {children}
    </button>
  );
}
const Sep = () => <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />;

export function ManuscriptEditor({ manuscript, references, readOnly, userId }: { manuscript: Manuscript; references: SavedRef[]; readOnly: boolean; userId: string }) {
  const { id, studyId } = manuscript;
  const [title, setTitle] = useState(manuscript.title);
  const [status, setStatus] = useState<Status>("saved");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [words, setWords] = useState(() => countWords(manuscript.content));
  const [docSnap, setDocSnap] = useState<Doc>(manuscript.content);
  const [tab, setTab] = useState<"outline" | "refs" | "style">("outline");
  const [focus, setFocus] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [citeDialog, setCiteDialog] = useState<{ pos: number | null; items: CitationRef[] } | null>(null);
  const [exporting, setExporting] = useState<null | "docx" | "pdf">(null);
  const [saveLabel, setSaveLabel] = useState("");
  const [labelOpen, setLabelOpen] = useState(false);

  const revision = useRef(manuscript.revision);
  const titleRef = useRef(title);
  const dirty = useRef(false);
  const inflight = useRef<Promise<boolean> | null>(null);
  const conflict = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const styleState = useManuscriptStyle(manuscript.styleId, (sid) => { if (!readOnly) setManuscriptStyle(id, sid); });

  const items: CslItem[] = useMemo(() => references.map((r) => toCslItem(rowToRef(r), r.id)), [references]);
  const pickRefs: PickRef[] = useMemo(() => references.map((r) => {
    const ref = rowToRef(r);
    return { id: r.id, title: ref.title, authorsText: ref.authors.map((a) => a.literal ?? a.family).filter(Boolean).slice(0, 3).join(", ") + (ref.authors.length > 3 ? " et al." : ""), year: ref.year ?? null };
  }), [references]);
  const fallback = useMemo(() => Object.fromEntries(references.map((r) => { const ref = rowToRef(r); return [r.id, shortCitation(ref.authors, ref.year)]; })), [references]);

  // ---- Saving ----
  const doSave = useCallback(async (snapshot?: string): Promise<boolean> => {
    if (readOnly || conflict.current) return false;
    if (inflight.current) { await inflight.current; if (!dirty.current && !snapshot) return true; }
    const editor = editorRef.current;
    if (!editor) return false;
    if (!dirty.current && !snapshot) return true;
    const run = (async () => {
      setStatus("saving"); dirty.current = false;
      const r = await saveManuscript(studyId, id, revision.current, titleRef.current, editor.getJSON(), snapshot ? { snapshot: true, label: snapshot } : {});
      if (r.ok) {
        revision.current = r.revision; setSavedAt(new Date()); setMessage(null);
        setStatus(dirty.current ? "dirty" : "saved");
        if (dirty.current) schedule();
        return true;
      }
      if (r.conflict) { conflict.current = true; dirty.current = true; setStatus("conflict"); setMessage(r.error); return false; }
      dirty.current = true; setStatus("error"); setMessage(r.error);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => { void doSave(); }, 10_000);
      return false;
    })();
    inflight.current = run;
    const ok = await run;
    if (inflight.current === run) inflight.current = null;
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, studyId, readOnly]);

  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void doSave(); }, AUTOSAVE_MS);
  }
  const markDirty = useCallback(() => {
    if (readOnly) return;
    dirty.current = true;
    if (!conflict.current) setStatus((s) => (s === "saving" ? s : "dirty"));
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // ---- Editor ----
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const editor = useEditor({
    extensions: useMemo(() => buildExtensions("Start writing. Use the toolbar for headings, tables, figures and citations."), []),
    content: manuscript.content,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: { attributes: { class: "manuscript-body focus:outline-none", role: "textbox", "aria-multiline": "true", "aria-label": "Manuscript text", spellcheck: "true" } },
    onUpdate: ({ editor: ed }) => {
      markDirty();
      if (snapTimer.current) clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(() => { const json = ed.getJSON() as Doc; setDocSnap(json); setWords(countWords(json)); }, 400);
    },
  });
  useEffect(() => { editorRef.current = editor; }, [editor]);

  const tb = useEditorState({
    editor,
    selector: ({ editor: e }) => !e ? null : {
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      sup: e.isActive("superscript"), sub: e.isActive("subscript"), bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"), table: e.isActive("table"), link: e.isActive("link"),
      heading: [1, 2, 3, 4].find((l) => e.isActive("heading", { level: l })) ?? 0,
      canUndo: e.can().undo(), canRedo: e.can().redo(),
    },
  });

  // Titles, and flushing before the page goes away.
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden" && dirty.current) void doSave(); };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty.current && !readOnly) { e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("beforeunload", onUnload); };
  }, [doSave, readOnly]);
  useEffect(() => () => { [timer, snapTimer, retryTimer].forEach((t) => t.current && clearTimeout(t.current)); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void doSave(); }
      if (e.key === "Escape" && focus && !citeDialog) setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave, focus, citeDialog]);

  // ---- Formatting (citations and bibliography) ----
  const { formatted, formatError } = useMemo((): { formatted: FormattedManuscript | null; formatError: string | null } => {
    if (!styleState.style) return { formatted: null, formatError: null };
    try { return { formatted: formatManuscript(docSnap, items, styleState.style), formatError: null }; }
    catch { return { formatted: null, formatError: "This citation style could not format your references. Try another style." }; }
  }, [docSnap, items, styleState.style]);

  const ctx = useMemo(() => ({
    labels: formatted?.labels ?? [], kind: formatted?.kind ?? "in-text", fallback,
    onEdit: (pos: number) => {
      if (readOnly || !editor) return;
      const node = editor.state.doc.nodeAt(pos);
      setCiteDialog({ pos, items: (node?.attrs.items as CitationRef[]) ?? [] });
    },
  }), [formatted, fallback, readOnly, editor]);

  // ---- Actions ----
  const insertCitation = (picked: CitationRef[]) => {
    if (!editor || !citeDialog) return;
    if (citeDialog.pos === null) editor.chain().focus().insertContent({ type: "citation", attrs: { items: picked } }).run();
    else editor.chain().focus().setNodeSelection(citeDialog.pos).updateAttributes("citation", { items: picked }).run();
    setCiteDialog(null);
  };
  const removeCitation = () => {
    if (!editor || citeDialog?.pos == null) return;
    editor.chain().focus().setNodeSelection(citeDialog.pos).deleteSelection().run();
    setCiteDialog(null);
  };
  const dropMissing = () => {
    if (!editor) return;
    const r = dropMissingCitations(editor.getJSON() as Doc, new Set(references.map((x) => x.id)));
    editor.commands.setContent(r.doc, { emitUpdate: true });
    setMessage(`Removed ${r.removed} citation${r.removed === 1 ? "" : "s"} to references that are no longer in this study.`);
  };
  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link address (https://...). Leave empty to remove the link.", prev ?? "https://");
    if (url === null) return;
    if (url.trim() === "") { editor.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
    const safe = safeHref(url);
    if (!safe) { setMessage("Only web (https://) and email (mailto:) links are allowed."); return; }
    editor.chain().focus().extendMarkRange("link").setLink({ href: safe }).run();
  };

  const uploadFigure = async (file: File) => {
    if (!editor) return;
    setMessage(null);
    const ext = FIGURE_TYPES[file.type];
    if (!ext) { setMessage("Figures must be PNG, JPEG or GIF images."); return; }
    if (file.size > MAX_FIGURE_BYTES) { setMessage("That image is over 5 MB. Compress it and try again."); return; }
    const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
      img.src = url;
    });
    if (!dims) { setMessage("That file could not be read as an image."); return; }
    const path = `${userId}/${id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await createClient().storage.from("manuscript-figures").upload(path, file, { contentType: file.type, upsert: false });
    if (error) { setMessage(/security|policy|exceed|size/i.test(error.message) ? "Could not upload: you may have reached the 50 MB figure limit." : "Could not upload the image. Try again."); return; }
    editor.chain().focus().insertContent({ type: "figure", attrs: { path, alt: "", caption: "", width: dims.w, height: dims.h } }).run();
  };

  const needStyle = (): boolean => {
    const hasCitations = (editor?.getJSON() as Doc | undefined) && formatted === null && (docSnap.content.length > 0);
    if (hasCitations && (styleState.busy || styleState.error)) { setMessage("Wait for the citation style to load, or choose another style, before exporting."); return true; }
    return false;
  };
  const currentFormatted = (): FormattedManuscript | null => {
    if (!editor || !styleState.style) return null;
    return formatManuscript(editor.getJSON() as Doc, items, styleState.style);
  };
  const exportDoc = async (kind: "docx" | "pdf") => {
    if (!editor || needStyle()) return;
    setExporting(kind); setMessage(null);
    try {
      if (!readOnly) await doSave();
      const json = editor.getJSON() as Doc;
      const fmt = currentFormatted();
      if (kind === "docx") await downloadDocx(json, fmt, title);
      else { const r = await printAsPdf(json, fmt, title, manuscript.studyTitle); if (r.error) setMessage(r.error); }
    } catch { setMessage("The export failed. Try again, or use the other export format."); }
    finally { setExporting(null); }
  };

  const resolveLoad = async () => {
    const r = await loadLatest(id);
    if ("error" in r) { setMessage(r.error); return; }
    editor?.commands.setContent(r.content, { emitUpdate: false });
    revision.current = r.revision; setTitle(r.title); titleRef.current = r.title;
    conflict.current = false; dirty.current = false; setStatus("saved"); setMessage(null);
    const j = r.content as Doc; setDocSnap(j); setWords(countWords(j));
  };
  const resolveOverwrite = async () => {
    if (!editor) return;
    setStatus("saving");
    const r = await overwriteManuscript(studyId, id, titleRef.current, editor.getJSON());
    if (r.ok) { revision.current = r.revision; conflict.current = false; dirty.current = false; setStatus("saved"); setSavedAt(new Date()); setMessage("Saved. The other copy was kept in the version history."); }
    else { setStatus("conflict"); setMessage(r.error); }
  };
  const restored = ({ revision: rev, title: t, content }: { revision: number; title: string; content: Doc }) => {
    editor?.commands.setContent(content, { emitUpdate: false });
    revision.current = rev; setTitle(t); titleRef.current = t; dirty.current = false; setStatus("saved"); setSavedAt(new Date());
    setDocSnap(content); setWords(countWords(content));
    setMessage("Version restored. Your previous text is in the history as a restore point.");
  };
  const saveVersion = async () => {
    dirty.current = true;
    const ok = await doSave(saveLabel.trim() || "Saved version");
    if (ok) { setSaveLabel(""); setLabelOpen(false); setMessage("Version saved."); }
  };

  const headingPositions = () => { const out: number[] = []; editor?.state.doc.descendants((n, pos) => { if (n.type.name === "heading") out.push(pos); }); return out; };
  const goToHeading = (i: number) => { const p = headingPositions()[i]; if (p !== undefined && editor) editor.chain().focus().setTextSelection(p + 1).scrollIntoView().run(); };

  const heads = useMemo(() => outline(docSnap), [docSnap]);
  const sections = useMemo(() => sectionWordCounts(docSnap), [docSnap]);
  const tpl = getTemplate(manuscript.template);

  const statusText = status === "saving" ? "Saving..." : status === "dirty" ? "Unsaved changes" : status === "error" ? "Could not save. Retrying" : status === "conflict" ? "Not saved: changed elsewhere" : savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "All changes saved";
  const statusColor = status === "error" || status === "conflict" ? "text-red-700" : "text-navy/65";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 pb-16 pt-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/studies/${studyId}/writing`} className="inline-flex items-center gap-1 text-sm text-navy/70 hover:text-cobalt"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Manuscripts</Link>
        <span className="text-navy/30" aria-hidden="true">/</span>
        <label htmlFor="ms-title" className="sr-only">Manuscript title</label>
        <input id="ms-title" value={title} maxLength={200} readOnly={readOnly} onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; markDirty(); }}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-base font-semibold text-navy hover:border-line focus:border-cobalt focus:outline-none" />
        <span role="status" aria-live="polite" className={`text-xs ${statusColor}`}>{readOnly ? "Read only" : statusText}</span>
        <span className="text-xs text-navy/65" title="Words in the text, tables and figure captions. Citations and the reference list are not counted.">{words.toLocaleString()} words{tpl.wordTarget ? ` of about ${tpl.wordTarget}` : ""}</span>
      </div>

      {conflict.current && status === "conflict" && (
        <div role="alert" className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-medium">A newer copy of this manuscript was saved from another tab or device.</p>
          <p className="mt-1">Autosave is paused so nothing is overwritten.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={resolveLoad} className="rounded-md border border-navy/30 bg-white px-3 py-1.5 text-sm text-navy hover:border-cobalt">Load the newer copy (discard changes in this tab)</button>
            <button type="button" onClick={resolveOverwrite} className="rounded-md bg-cobalt px-3 py-1.5 text-sm font-medium text-white hover:bg-cobalt-dark">Keep this tab&apos;s text (the other copy goes to history)</button>
          </div>
        </div>
      )}
      {message && status !== "conflict" && <p role="status" className="mt-2 rounded-md bg-soft px-3 py-2 text-sm text-navy">{message}</p>}
      {readOnly && <p className="mt-2 rounded-md bg-soft px-3 py-2 text-sm text-navy">You are viewing this manuscript as a supervisor. Only the study owner can edit it.</p>}
      {formatted && formatted.missing.length > 0 && !readOnly && (
        <p role="alert" className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {formatted.missing.length} cited reference{formatted.missing.length === 1 ? " is" : "s are"} no longer in this study&apos;s library. <button type="button" onClick={dropMissing} className="underline">Remove those citations</button>
        </p>
      )}

      {!readOnly && !focus && (
        <div role="toolbar" aria-label="Formatting" className="sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-white px-2 py-1">
          <Btn label="Undo" onClick={() => editor?.chain().focus().undo().run()} disabled={!tb?.canUndo}><Undo2 className="h-4 w-4" /></Btn>
          <Btn label="Redo" onClick={() => editor?.chain().focus().redo().run()} disabled={!tb?.canRedo}><Redo2 className="h-4 w-4" /></Btn>
          <Sep />
          <label htmlFor="ms-block" className="sr-only">Text style</label>
          <select id="ms-block" value={tb?.heading ?? 0} onChange={(e) => { const l = Number(e.target.value); const c = editor?.chain().focus(); if (!c) return; if (l === 0) c.setParagraph().run(); else c.setHeading({ level: l as 1 | 2 | 3 | 4 }).run(); }} className="h-8 rounded border border-navy/25 bg-white px-2 text-sm text-navy">
            <option value={0}>Paragraph</option><option value={1}>Heading 1</option><option value={2}>Heading 2</option><option value={3}>Heading 3</option><option value={4}>Heading 4</option>
          </select>
          <Sep />
          <Btn label="Bold" active={tb?.bold} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></Btn>
          <Btn label="Italic" active={tb?.italic} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></Btn>
          <Btn label="Underline" active={tb?.underline} onClick={() => editor?.chain().focus().toggleUnderline().run()}><Underline className="h-4 w-4" /></Btn>
          <Btn label="Strikethrough" active={tb?.strike} onClick={() => editor?.chain().focus().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></Btn>
          <Btn label="Superscript" active={tb?.sup} onClick={() => editor?.chain().focus().toggleSuperscript().run()}><Superscript className="h-4 w-4" /></Btn>
          <Btn label="Subscript" active={tb?.sub} onClick={() => editor?.chain().focus().toggleSubscript().run()}><Subscript className="h-4 w-4" /></Btn>
          <Btn label="Link" active={tb?.link} onClick={setLink}><Link2 className="h-4 w-4" /></Btn>
          <Sep />
          <Btn label="Bulleted list" active={tb?.bullet} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
          <Btn label="Numbered list" active={tb?.ordered} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
          <Btn label="Block quote" active={tb?.quote} onClick={() => editor?.chain().focus().toggleBlockquote().run()}><TextQuote className="h-4 w-4" /></Btn>
          <Btn label="Horizontal line" onClick={() => editor?.chain().focus().setHorizontalRule().run()}><Minus className="h-4 w-4" /></Btn>
          <Sep />
          <Btn label="Insert table" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 className="h-4 w-4" /></Btn>
          <Btn label="Insert figure" onClick={() => fileInput.current?.click()}><ImagePlus className="h-4 w-4" /></Btn>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadFigure(f); }} />
          <Btn label="Insert citation" onClick={() => setCiteDialog({ pos: null, items: [] })}><BookMarked className="h-4 w-4" /></Btn>
          {tb?.table && (
            <span className="ml-1 flex flex-wrap items-center gap-1 border-l border-line pl-2 text-xs" role="group" aria-label="Table">
              {([["Row above", () => editor?.chain().focus().addRowBefore().run()], ["Row below", () => editor?.chain().focus().addRowAfter().run()], ["Delete row", () => editor?.chain().focus().deleteRow().run()],
                ["Column left", () => editor?.chain().focus().addColumnBefore().run()], ["Column right", () => editor?.chain().focus().addColumnAfter().run()], ["Delete column", () => editor?.chain().focus().deleteColumn().run()],
                ["Header row", () => editor?.chain().focus().toggleHeaderRow().run()], ["Delete table", () => editor?.chain().focus().deleteTable().run()]] as [string, () => void][]).map(([l, f]) => (
                <button key={l} type="button" onMouseDown={(e) => e.preventDefault()} onClick={f} className="rounded border border-navy/25 px-1.5 py-0.5 text-navy hover:border-cobalt">{l}</button>
              ))}
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!readOnly && (
          <>
            <button type="button" onClick={() => void doSave()} className="inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt"><Save className="h-3.5 w-3.5" aria-hidden="true" /> Save now</button>
            {labelOpen ? (
              <span className="flex items-center gap-1">
                <label className="sr-only" htmlFor="ms-label">Version name</label>
                <input id="ms-label" value={saveLabel} maxLength={120} onChange={(e) => setSaveLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void saveVersion()} placeholder="Name this version" className="w-44 rounded border border-navy/25 px-2 py-1 text-xs" autoFocus />
                <button type="button" onClick={() => void saveVersion()} className="rounded-md bg-cobalt px-2.5 py-1 text-xs font-medium text-white hover:bg-cobalt-dark">Save version</button>
                <button type="button" onClick={() => setLabelOpen(false)} className="rounded-md border border-navy/25 px-2.5 py-1 text-xs text-navy">Cancel</button>
              </span>
            ) : <button type="button" onClick={() => setLabelOpen(true)} className="rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt">Save a named version</button>}
          </>
        )}
        <button type="button" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} className="inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt"><History className="h-3.5 w-3.5" aria-hidden="true" /> History</button>
        <button type="button" disabled={!!exporting} onClick={() => void exportDoc("docx")} className="inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt disabled:opacity-50"><Download className="h-3.5 w-3.5" aria-hidden="true" /> {exporting === "docx" ? "Preparing..." : "Word (.docx)"}</button>
        <button type="button" disabled={!!exporting} onClick={() => void exportDoc("pdf")} title="Opens the print dialog. Choose Save as PDF as the destination." className="inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt disabled:opacity-50"><Printer className="h-3.5 w-3.5" aria-hidden="true" /> {exporting === "pdf" ? "Preparing..." : "PDF"}</button>
        <button type="button" onClick={() => setFocus((f) => !f)} aria-pressed={focus} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-navy/25 px-3 py-1.5 text-xs font-medium text-navy hover:border-cobalt">{focus ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />} {focus ? "Exit focus (Esc)" : "Focus mode"}</button>
      </div>

      {showHistory && (
        <div className="mt-3">
          <HistoryPanel studyId={studyId} manuscriptId={id} readOnly={readOnly} items={items} style={styleState.style} getRevision={() => revision.current} flush={async () => { if (!dirty.current) return true; return doSave(); }} onRestored={restored} onClose={() => setShowHistory(false)} />
        </div>
      )}

      <div className={`mt-3 grid gap-4 ${focus ? "" : "lg:grid-cols-[minmax(0,1fr)_20rem]"}`}>
        <div className={`min-w-0 ${focus ? "mx-auto w-full max-w-3xl" : ""}`}>
          <CitationCtx.Provider value={ctx}>
            <article className="rounded-md border border-line bg-white px-5 py-6 shadow-sm sm:px-10">
              <EditorContent editor={editor} />
              {formatted && formatted.bibliographyHtml.length > 0 && (
                <section aria-labelledby="bib-h" className="mt-8 border-t border-line pt-4">
                  <h2 id="bib-h" className="text-lg font-semibold text-navy">References</h2>
                  <p className="text-xs text-navy/60">Built automatically from your citations in {styleState.style?.title ?? "the chosen style"}. Not editable here.</p>
                  <div className="manuscript-bib mt-3 text-sm" dangerouslySetInnerHTML={{ __html: formatted.bibliographyHtml.join("\n") }} />
                </section>
              )}
            </article>
          </CitationCtx.Provider>
        </div>

        {!focus && (
          <aside aria-label="Manuscript tools" className="min-w-0">
            <div role="tablist" aria-label="Side panel" className="flex rounded-md border border-line bg-white p-0.5 text-sm">
              {([["outline", "Outline"], ["refs", "References"], ["style", "Style"]] as const).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex-1 rounded px-2 py-1.5 ${tab === k ? "bg-soft font-medium text-cobalt" : "text-navy hover:bg-soft/50"}`}>{l}</button>
              ))}
            </div>
            <div role="tabpanel" className="mt-2 rounded-md border border-line bg-white p-3 text-sm">
              {tab === "outline" && (
                <>
                  {heads.length === 0 ? <p className="text-navy/60">Headings you add will appear here.</p> : (
                    <ol className="space-y-1">
                      {heads.map((h, i) => {
                        const hint = hintFor(manuscript.template, h.text);
                        const w = sections[i]?.words ?? 0;
                        return (
                          <li key={i} style={{ paddingLeft: `${(h.level - 1) * 12}px` }}>
                            <button type="button" onClick={() => goToHeading(i)} className="block w-full text-left text-navy hover:text-cobalt"><span className="font-medium">{h.text || "(empty heading)"}</span> <span className="text-xs text-navy/55">{w.toLocaleString()} words</span></button>
                            {hint && <span className="block text-xs text-navy/60">{hint}</span>}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {tpl.guideline && <p className="mt-3 text-xs text-navy/65">This template follows the headings of {tpl.guideline}</p>}
                </>
              )}
              {tab === "refs" && (
                <>
                  {!readOnly && <button type="button" onClick={() => setCiteDialog({ pos: null, items: [] })} className="mb-2 rounded-md bg-cobalt px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-dark">Insert a citation</button>}
                  <p className="text-xs text-navy/65">{references.length} reference{references.length === 1 ? "" : "s"} in this study. {formatted ? `${formatted.uncited.length} not cited yet.` : ""}</p>
                  <ul className="mt-2 space-y-1.5">
                    {pickRefs.map((r) => (
                      <li key={r.id} className="text-xs text-navy"><span className={formatted?.uncited.includes(r.id) ? "text-navy/60" : "font-medium"}>{r.title}</span><span className="block text-navy/55">{r.authorsText}{r.year ? ` (${r.year})` : ""}{formatted?.uncited.includes(r.id) ? " · not cited" : ""}</span></li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs"><Link href={`/studies/${studyId}/references`} className="text-cobalt underline">Manage references</Link> · <Link href="/literature" className="text-cobalt underline">Find papers</Link></p>
                </>
              )}
              {tab === "style" && (
                <>
                  <StylePicker styleId={styleState.styleId} setStyleId={styleState.setStyleId} style={styleState.style} busy={styleState.busy} error={styleState.error ?? formatError} idPrefix="ms" />
                  <p className="mt-2 text-xs text-navy/60">Changing the style reformats every citation and the reference list at once. Styles come from the Citation Style Language project.</p>
                </>
              )}
            </div>
          </aside>
        )}
      </div>

      {citeDialog && <CitationDialog refs={pickRefs} initial={citeDialog.items} studyId={studyId} onSubmit={insertCitation} onRemove={citeDialog.pos !== null ? removeCitation : undefined} onClose={() => setCiteDialog(null)} />}
    </div>
  );
}

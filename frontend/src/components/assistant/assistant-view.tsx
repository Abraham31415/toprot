"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { askAssistant, deleteThread, getThread, listThreads, type ProjectOptions } from "@/app/assistant/actions";
import { getTask, TASKS, type TaskId } from "@/lib/assistant/tasks";
import { routeRequest } from "@/lib/assistant/router";
import type { AssistantMessage, ThreadSummary } from "@/lib/assistant/types";
import { AnswerCard } from "./answer-card";

const field = "w-full min-w-0 rounded-md border border-navy/25 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20";

export function AssistantView({ initialThreads, options }: { initialThreads: ThreadSummary[]; options: ProjectOptions }) {
  const [threads, setThreads] = useState(initialThreads);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [task, setTask] = useState<TaskId>("protocol_review");
  const [studyId, setStudyId] = useState<string>(options.studies[0]?.id ?? "");
  const [manuscriptId, setManuscriptId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [thorough, setThorough] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  const t = getTask(task)!;
  const msOptions = options.manuscripts.filter((m) => m.study_id === studyId);
  const pdfOptions = options.pdfs.filter((p) => !studyId || p.study_id === studyId || p.study_id === null);
  const needsPdfs = t.tools.includes("search_pdfs");
  const preview = useMemo(() => {
    try { return routeRequest({ task, messageChars: text.length, contextChars: 600 + text.length, documentCount: picked.size + (manuscriptId ? 1 : 0), thorough, deepAllowed: true }, !!studyId, picked.size > 0 || options.pdfs.some((p) => p.study_id === studyId), !!manuscriptId).tier; }
    catch { return "standard"; }
  }, [task, text.length, picked.size, manuscriptId, thorough, studyId, options.pdfs]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, pending]);
  useEffect(() => { setManuscriptId((m) => (msOptions.some((x) => x.id === m) ? m : "")); setPicked(new Set()); }, [studyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openThread = (id: string) => start(async () => {
    setError(null);
    const r = await getThread(id);
    if ("error" in r) { setError(r.error); return; }
    setThreadId(id); setMessages(r.messages);
    const th = threads.find((x) => x.id === id);
    if (th?.studyId) setStudyId(th.studyId);
  });
  const newThread = () => { setThreadId(null); setMessages([]); setError(null); };
  const removeThread = (id: string) => {
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
    start(async () => { const r = await deleteThread(id); if (r.error) { setError(r.error); return; } setThreads((l) => l.filter((x) => x.id !== id)); if (threadId === id) newThread(); });
  };

  const send = () => start(async () => {
    setError(null);
    const q = text.trim();
    if (!q) return;
    const optimistic: AssistantMessage = { id: null, role: "user", task, text: q, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    const r = await askAssistant({ threadId, studyId: studyId || null, task, message: q, manuscriptId: manuscriptId || null, documentIds: [...picked], thorough, idempotencyKey: crypto.randomUUID() });
    if ("error" in r) { setError(r.error); setMessages((m) => m.filter((x) => x !== optimistic)); return; }
    setText("");
    setMessages((m) => [...m, r.message]);
    if (!threadId && r.threadId) { setThreadId(r.threadId); setThreads(await listThreads()); }
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside aria-label="Conversations" className="min-w-0">
        <button type="button" onClick={newThread} className="mb-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-navy/25 bg-white px-3 py-2 text-sm font-medium text-navy hover:border-cobalt"><Plus className="h-4 w-4" aria-hidden="true" /> New conversation</button>
        <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-md border border-line bg-white lg:max-h-[32rem]">
          {threads.length === 0 && <li className="p-3 text-xs text-navy/60">No conversations yet.</li>}
          {threads.map((th) => (
            <li key={th.id} className={`flex items-center ${th.id === threadId ? "bg-soft" : ""}`}>
              <button type="button" onClick={() => openThread(th.id)} aria-current={th.id === threadId} className="min-w-0 flex-1 px-3 py-2 text-left text-sm text-navy hover:bg-soft/50"><span className="block truncate">{th.title}</span><span className="block text-xs text-navy/55">{new Date(th.updatedAt).toLocaleDateString()}</span></button>
              <button type="button" onClick={() => removeThread(th.id)} aria-label={`Delete conversation ${th.title}`} className="p-2 text-navy/45 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      </aside>

      <section aria-label="Conversation" className="min-w-0">
        <div className="min-h-[12rem] space-y-3" aria-live="polite">
          {messages.length === 0 && (
            <div className="rounded-md border border-line bg-white p-4 text-sm text-navy/70">
              <p className="font-medium text-navy">What would you like help with?</p>
              <p className="mt-1">Pick a task and a project below. The assistant reads your protocol, saved references, PDFs and manuscripts through limited read-only tools, and never writes to them. It is an aid, not an authority: it does not approve or score your work, and it does not replace your supervisor or ethics committee.</p>
            </div>
          )}
          {messages.map((m, i) => m.role === "user"
            ? <div key={i} className="ml-auto max-w-[85%] rounded-md bg-cobalt px-3 py-2 text-sm text-white"><p className="whitespace-pre-wrap">{m.text}</p></div>
            : <AnswerCard key={i} m={m} studyId={studyId || null} />)}
          {pending && <p className="text-sm text-navy/60" role="status">Reading your project and thinking... this can take up to a minute.</p>}
          <div ref={endRef} />
        </div>

        <div className="mt-4 rounded-md border border-line bg-white p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium text-navy">Task
              <select className={`${field} mt-1`} value={task} onChange={(e) => setTask(e.target.value as TaskId)}>
                {TASKS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-navy">Project
              <select className={`${field} mt-1`} value={studyId} onChange={(e) => setStudyId(e.target.value)}>
                <option value="">No project{t.needsStudy ? " (this task needs one)" : ""}</option>
                {options.studies.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </label>
            {(t.needsManuscript || t.tools.includes("get_manuscript")) && (
              <label className="block text-xs font-medium text-navy">Manuscript{t.needsManuscript ? "" : " (optional)"}
                <select className={`${field} mt-1`} value={manuscriptId} onChange={(e) => setManuscriptId(e.target.value)}>
                  <option value="">{msOptions.length ? "Choose a manuscript" : "No manuscripts in this project"}</option>
                  {msOptions.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </label>
            )}
          </div>
          <p className="mt-1 text-xs text-navy/60">{t.description}</p>

          {needsPdfs && pdfOptions.length > 0 && (
            <fieldset className="mt-2 rounded-md border border-line p-2">
              <legend className="px-1 text-xs font-medium text-navy">PDFs to use (none selected = the PDFs linked to this project)</legend>
              <ul className="max-h-28 space-y-1 overflow-y-auto">
                {pdfOptions.map((p) => (
                  <li key={p.id}><label className="flex items-center gap-2 text-xs text-navy"><input type="checkbox" checked={picked.has(p.id)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} /> <span className="truncate">{p.title}</span></label></li>
                ))}
              </ul>
            </fieldset>
          )}

          <label htmlFor="as-text" className="mt-2 block text-xs font-medium text-navy">Your request</label>
          <textarea id="as-text" className={`${field} mt-1`} rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.placeholder}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim() && !pending) send(); }} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-xs text-navy"><input type="checkbox" checked={thorough} onChange={(e) => setThorough(e.target.checked)} /> Thorough pass (stronger model, uses more credits)</label>
            <span className="text-xs text-navy/55">Expected tier: {preview}</span>
            <button type="button" onClick={send} disabled={pending || !text.trim() || (t.needsStudy && !studyId) || (!!t.needsManuscript && !manuscriptId)} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50"><Send className="h-4 w-4" aria-hidden="true" /> {pending ? "Working..." : "Ask"}</button>
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
          <p className="mt-2 text-xs text-navy/55">Uses AI credits. AI can be wrong: check answers against your sources. Only references saved in your project can be cited; anything else is removed.</p>
        </div>
      </section>
    </div>
  );
}

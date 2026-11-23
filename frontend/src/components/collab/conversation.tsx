"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ds";
import { createClient } from "@/lib/supabase/client";
import { fetchMessages, markConversationRead, postMessage, reportRealtimeJoin } from "@/app/collab-actions";
import type { Message } from "@/lib/collab/messages";

const FAST = 15_000; // polling while live updates are unavailable
const SLOW = 60_000; // safety refresh while they are working

/**
 * A conversation. Messages are always loaded and refreshed with ordinary requests, so it works with no realtime at all.
 * When Supabase Realtime connects, new messages arrive instantly and "online now" shows who else has it open.
 */
export function Conversation({ conversation, userId, userName, initial, canPost }: { conversation: string; userId: string; userName: string; initial: Message[]; canPost: boolean }) {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [live, setLive] = useState(false);
  const [online, setOnline] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const last = useRef<string | null>(initial.at(-1)?.created_at ?? null);
  const end = useRef<HTMLDivElement>(null);
  const field = useId();

  const merge = useCallback((incoming: Message[]) => {
    if (!incoming.length) return;
    setMessages((cur) => {
      const seen = new Set(cur.map((m) => m.id));
      const add = incoming.filter((m) => !seen.has(m.id));
      if (!add.length) return cur;
      const next = [...cur, ...add].sort((a, b) => a.created_at.localeCompare(b.created_at));
      last.current = next.at(-1)!.created_at;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const r = await fetchMessages(conversation, last.current);
    if (r.messages) merge(r.messages);
  }, [conversation, merge]);

  useEffect(() => { void markConversationRead(conversation); }, [conversation, messages.length]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  // Plain polling: the fallback that always works.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, live ? SLOW : FAST);
    return () => clearInterval(t);
  }, [live, refresh]);

  // Realtime: new messages and presence. Failure only means we stay on polling.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      try {
        await supabase.realtime.setAuth();
        const [kind, id] = conversation.split(":");
        channel = supabase.channel(conversation, { config: { private: true, presence: { key: userId } } });
        channel
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "collab_messages", filter: `${kind === "project" ? "study_id" : "team_id"}=eq.${id}` }, () => { void refresh(); })
          .on("presence", { event: "sync" }, () => {
            const state = channel!.presenceState() as Record<string, { name?: string }[]>;
            setOnline(Object.entries(state).filter(([k]) => k !== userId).map(([, v]) => v[0]?.name ?? "Someone"));
          })
          .subscribe(async (status) => {
            if (cancelled) return;
            if (status === "SUBSCRIBED") { setLive(true); void reportRealtimeJoin(); await channel!.track({ name: userName }); }
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { setLive(false); setOnline([]); }
          });
      } catch { setLive(false); }
    })();
    return () => { cancelled = true; if (channel) void supabase.removeChannel(channel); };
  }, [conversation, userId, userName, refresh]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = body;
    start(async () => {
      const r = await postMessage(conversation, text);
      if (r.error) { setError(r.error); return; }
      setError(null); setBody("");
      if (r.message) merge([r.message]);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-soft" role="status" aria-live="polite">
        {live ? "Live updates on." : "Live updates are not connected. This page checks for new messages every 15 seconds."}
        {online.length > 0 && ` Online now: ${online.join(", ")}.`}
      </p>
      <div className="max-h-[28rem] min-h-40 overflow-y-auto rounded-card border border-line bg-surface p-4" role="log" aria-label="Messages" tabIndex={0}>
        {messages.length === 0 ? <p className="text-sm text-ink-soft">No messages yet.</p> : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => (
              <li key={m.id} className={`max-w-[85%] rounded-control px-3 py-2 text-sm ${m.author_id === userId ? "self-end bg-surface-soft" : "self-start border border-line"}`}>
                <p className="text-xs text-ink-soft"><span className="font-medium text-ink">{m.author_id === userId ? "You" : m.author ?? "Former member"}</span> {new Date(m.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-ink">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
        <div ref={end} />
      </div>
      {canPost ? (
        <form onSubmit={send} className="flex flex-col gap-2">
          <label htmlFor={field} className="sr-only">Message</label>
          <textarea id={field} rows={2} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && body.trim()) { e.preventDefault(); send(e as unknown as React.FormEvent); } }}
            className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm" placeholder="Write a message. Ctrl+Enter sends." />
          {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
          <div><Button type="submit" loading={pending} disabled={!body.trim()}><Send className="h-4 w-4" aria-hidden="true" />Send</Button></div>
        </form>
      ) : <p className="text-sm text-ink-soft">You can read this conversation but not post in it.</p>}
    </div>
  );
}

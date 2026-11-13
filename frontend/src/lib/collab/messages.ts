import { collabErrorMessage } from "./errors";
import { isUuid } from "./roles";
import type { DbLike } from "./service";

// Project and team conversations. Realtime makes them live, but every read here is a plain query, so they work without it.

export type Conversation = `project:${string}` | `team:${string}`;
export const projectConversation = (id: string): Conversation => `project:${id}`;
export const teamConversation = (id: string): Conversation => `team:${id}`;
export function isConversation(v: unknown): v is Conversation {
  if (typeof v !== "string") return false;
  const [kind, id] = v.split(":");
  return (kind === "project" || kind === "team") && isUuid(id) && v.split(":").length === 2;
}

export type Message = { id: string; author_id: string | null; author: string | null; body: string; created_at: string };

const MESSAGES: Record<string, string> = {
  not_allowed: "You can read this conversation but not post in it.",
  forbidden: "You do not have access to this conversation.",
  invalid_message: "A message needs between 1 and 4000 characters.",
  rate_limited: "You are sending messages very quickly. Wait a moment and try again.",
};
export function messageError(message: string | undefined | null): string {
  if (message) for (const [code, text] of Object.entries(MESSAGES)) if (message.includes(code)) return text;
  return collabErrorMessage(message, "That did not work. Try again in a moment.");
}

export async function sendMessage(db: DbLike, actor: string, conversation: string, body: string): Promise<{ ok: true; id: string; created_at: string } | { ok: false; error: string }> {
  if (!isConversation(conversation)) return { ok: false, error: "Unknown conversation." };
  const text = body.trim();
  if (!text || text.length > 4000) return { ok: false, error: messageError("invalid_message") };
  const { data, error } = await db.rpc("collab_message_send", { p_actor: actor, p_conversation: conversation, p_body: text });
  if (error) return { ok: false, error: messageError(error.message) };
  const d = data as { id: string; created_at: string };
  return { ok: true, id: d.id, created_at: d.created_at };
}

export async function listMessages(db: DbLike, actor: string, conversation: string, after: string | null = null): Promise<{ ok: true; messages: Message[] } | { ok: false; error: string }> {
  if (!isConversation(conversation)) return { ok: false, error: "Unknown conversation." };
  const { data, error } = await db.rpc("collab_messages_list", { p_actor: actor, p_conversation: conversation, p_after: after, p_limit: 100 });
  if (error) return { ok: false, error: messageError(error.message) };
  return { ok: true, messages: (data ?? []) as Message[] };
}

export async function unreadByConversation(db: DbLike, actor: string): Promise<Record<string, number>> {
  const { data } = await db.rpc("collab_unread_messages", { p_actor: actor });
  return (data ?? {}) as Record<string, number>;
}

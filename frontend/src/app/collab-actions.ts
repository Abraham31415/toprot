"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConversation, listMessages, sendMessage, type Message } from "@/lib/collab/messages";
import { checkRateLimit } from "@/lib/rate-limit";

// Conversation actions shared by project discussions and team chat. The database re-checks who may read and post.

async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function postMessage(conversation: string, body: string): Promise<{ error?: string; message?: Message }> {
  const id = await me();
  if (!id) return { error: "Sign in to continue." };
  if (!checkRateLimit(`msg:${id}`, { limit: 40, windowMs: 60_000 }).ok) return { error: "You are sending messages very quickly. Wait a moment and try again." };
  const db = createAdminClient();
  const r = await sendMessage(db, id, conversation, body);
  if (!r.ok) return { error: r.error };
  const { data: p } = await (await createClient()).from("profiles").select("full_name").eq("id", id).single();
  return { message: { id: r.id, author_id: id, author: p?.full_name ?? null, body: body.trim(), created_at: r.created_at } };
}

export async function fetchMessages(conversation: string, after: string | null): Promise<{ error?: string; messages?: Message[] }> {
  const id = await me();
  if (!id) return { error: "Sign in to continue." };
  const r = await listMessages(createAdminClient(), id, conversation, after);
  return r.ok ? { messages: r.messages } : { error: r.error };
}

export async function markConversationRead(conversation: string): Promise<void> {
  const id = await me();
  if (!id || !isConversation(conversation)) return;
  await createAdminClient().rpc("collab_mark_conversation_read", { p_actor: id, p_conversation: conversation });
}

/** Browsers report each realtime join so usage can be watched against the plan. Counts only; nothing about the person or the content. */
export async function reportRealtimeJoin(): Promise<void> {
  const id = await me();
  if (!id || !checkRateLimit(`rtjoin:${id}`, { limit: 20, windowMs: 3600_000 }).ok) return;
  await createAdminClient().rpc("collab_usage_bump", { p_metric: "realtime_joins", p_n: 1 });
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/collab/roles";

/** Mark one notification (or all) as read for the signed-in user. */
export async function markRead(id: string | null): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to continue." };
  if (id !== null && !isUuid(id)) return { error: "Unknown notification." };
  const { error } = await createAdminClient().rpc("collab_mark_read", { p_actor: user.id, p_ids: id ? [id] : null });
  if (error) return { error: "Could not update. Try again." };
  revalidatePath("/notifications");
  return {};
}

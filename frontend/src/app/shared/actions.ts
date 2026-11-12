"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { acceptInvitationById, acceptInvitationByToken, declineInvitation } from "@/lib/collab/service";

async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user && user.email_confirmed_at ? user : null;
}

/** Accept by secret token (the emailed link) or by invitation id (the list on the Shared with me page). The account's email must match. */
export async function acceptInvite(input: { token?: string; invitationId?: string }): Promise<{ error?: string; studyId?: string }> {
  const user = await me();
  if (!user) return { error: "Sign in with a confirmed email address to accept." };
  const db = createAdminClient();
  const r = input.token ? await acceptInvitationByToken(db, user.id, input.token)
    : input.invitationId ? await acceptInvitationById(db, user.id, input.invitationId)
    : ({ ok: false, error: "Unknown invitation." } as const);
  if (!r.ok) return { error: r.error };
  revalidatePath("/shared");
  return { studyId: r.studyId };
}

export async function declineInvite(invitationId: string): Promise<{ error?: string }> {
  const user = await me();
  if (!user) return { error: "Sign in to continue." };
  const r = await declineInvitation(createAdminClient(), user.id, invitationId);
  if (!r.ok) return { error: r.error };
  revalidatePath("/shared");
  return {};
}

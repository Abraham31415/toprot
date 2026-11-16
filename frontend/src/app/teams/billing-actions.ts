"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import { createCheckout, DodoError, loadDodoConfig, newDodoTxRef } from "@/lib/billing/dodo";
import { activeProvider, providerReady } from "@/lib/billing/provider";
import { isUuid } from "@/lib/collab/roles";

// Team billing and AI pool actions. Money is only ever taken through the provider's own checkout, after a pending payment row exists at the
// price stored in the database. Nothing is granted here: entitlements change only after the backend verifies the payment (dodo-fulfil.ts).

type Out = { error?: string; message?: string; url?: string };

const MESSAGES: Record<string, string> = {
  teams_billing_off: "Teams billing is not switched on yet.",
  not_team_owner: "Only the team owner can manage billing.",
  invalid_seats: "Choose a number of seats within the allowed range.",
  seats_in_use: "You have more people than that on paid seats. Remove some first.",
  already_subscribed: "This team already has a subscription that renews automatically.",
  no_active_subscription: "This team needs an active Teams plan first.",
  too_many_attempts: "You started several payments in the last hour. Wait a little and try again.",
  currency_unavailable: "That item is not available.",
  unknown_product: "That item is not available.",
  no_price: "That item has no price yet.",
  invalid_request: "That purchase could not be started.",
  use_add_seats: "To add seats, use Add seats.",
  pool_disabled: "Turn on the shared credit pool first.",
  not_team_admin: "Only a team owner or administrator can do that.",
  already_decided: "That request was already answered.",
  too_many_requests: "You already have several pending requests.",
  invalid_amount: "Enter a valid amount.",
};
const say = (code: string | undefined, fallback = "That did not work. Try again in a moment.") => (code && MESSAGES[code]) || fallback;

async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ? { id: user.id, email: user.email } : null;
}

async function checkout(teamId: string, kind: "team_subscription" | "team_seats" | "team_pack", args: { seats?: number; add?: number; pack?: string }): Promise<Out> {
  const user = await me();
  if (!user) return { error: "Sign in to continue." };
  if (!isUuid(teamId)) return { error: "Unknown team." };
  const ready = providerReady();
  if (!ready.ok) return { error: ready.message };
  if (activeProvider() !== "dodo") return { error: "Team billing uses Dodo Payments, which is not the configured provider." };
  const cfg = loadDodoConfig();
  if (!cfg) return { error: "Payments are not configured." };
  const admin = createAdminClient();
  const txRef = newDodoTxRef();

  const productId = async (k: "plan" | "pack", key: string) => ((await admin.from("billing_provider_products").select("product_id").eq("provider", "dodo").eq("kind", k).eq("product_key", key).maybeSingle()).data?.product_id as string | undefined) ?? null;

  let created: { ok: boolean; code?: string };
  let main: string | null; let extra: { productId: string; quantity: number }[] = []; let quantity = 1;
  if (kind === "team_subscription") {
    const seats = Number(args.seats);
    const base = Number((await admin.from("billing_settings").select("value_num").eq("key", "team_base_paid_seats").maybeSingle()).data?.value_num ?? 3);
    main = await productId("plan", "team");
    if (seats > base) { const seat = await productId("plan", "team_seat"); if (!seat) return { error: "Extra seats are not available for purchase yet." }; extra = [{ productId: seat, quantity: seats - base }]; }
    ({ data: created } = (await admin.rpc("team_create_payment", { p_actor: user.id, p_team: teamId, p_seats: seats, p_currency: "USD", p_tx_ref: txRef, p_provider: "dodo" })) as { data: typeof created });
  } else if (kind === "team_seats") {
    main = await productId("plan", "team_seat"); quantity = Math.floor(Number(args.add));
    ({ data: created } = (await admin.rpc("team_create_seats_payment", { p_actor: user.id, p_team: teamId, p_add: quantity, p_currency: "USD", p_tx_ref: txRef, p_provider: "dodo" })) as { data: typeof created });
  } else {
    if (!args.pack || !/^[a-z][a-z0-9_]{1,30}$/.test(args.pack)) return { error: say("invalid_request") };
    main = await productId("pack", args.pack);
    ({ data: created } = (await admin.rpc("team_create_pack_payment", { p_actor: user.id, p_team: teamId, p_pack: args.pack, p_currency: "USD", p_tx_ref: txRef, p_provider: "dodo" })) as { data: typeof created });
  }
  if (!created?.ok) return { error: say(created?.code) };
  if (!main) {
    await admin.from("payments").update({ status: "failed", failure_reason: "product_not_configured" }).eq("tx_ref", txRef).eq("status", "pending");
    return { error: "That item is not available for purchase yet." };
  }
  try {
    const { link, sessionId } = await createCheckout(cfg, {
      productId: main, quantity, extraItems: extra, returnUrl: `${SITE_URL}/billing/return?tx_ref=${txRef}`, email: user.email,
      metadata: { toprot_tx_ref: txRef, toprot_kind: kind, toprot_team: teamId },
    });
    await admin.from("payments").update({ meta: { checkout_session_id: sessionId } }).eq("tx_ref", txRef);
    return { url: link };
  } catch (e) {
    await admin.from("payments").update({ status: "failed", failure_reason: "checkout_creation_failed" }).eq("tx_ref", txRef).eq("status", "pending");
    return { error: e instanceof DodoError && e.retryable ? "The payment provider is not responding. Please try again in a moment." : "Could not open the checkout. Please try again later." };
  }
}

export async function startTeamSubscription(teamId: string, seats: number): Promise<Out> { return checkout(teamId, "team_subscription", { seats }); }
export async function startAddSeats(teamId: string, add: number): Promise<Out> { return checkout(teamId, "team_seats", { add }); }
export async function startTeamPack(teamId: string, pack: string): Promise<Out> { return checkout(teamId, "team_pack", { pack }); }

async function codeOf(fn: string, args: Record<string, unknown>): Promise<string | undefined> {
  const { error } = await createAdminClient().rpc(fn, args);
  return error?.message;
}
async function run(teamId: string, fn: string, args: (uid: string) => Record<string, unknown>, ok: string): Promise<Out> {
  const user = await me();
  if (!user) return { error: "Sign in to continue." };
  const msg = await codeOf(fn, args(user.id));
  if (msg) { const code = Object.keys(MESSAGES).find((c) => msg.includes(c)); return { error: say(code) }; }
  revalidatePath(`/teams/${teamId}`, "layout");
  revalidatePath("/billing");
  return { message: ok };
}

export async function lowerSeats(teamId: string, seats: number): Promise<Out> {
  return run(teamId, "team_set_next_seats", (u) => ({ p_actor: u, p_team: teamId, p_seats: Math.floor(seats) }), "Done. Fewer seats take effect at the next renewal.");
}
export async function setPool(teamId: string, enabled: boolean, teamLimitCredits: number | null, memberLimitCredits: number | null): Promise<Out> {
  return run(teamId, "team_ai_pool_set", (u) => ({ p_actor: u, p_team: teamId, p_enabled: enabled, p_team_limit: teamLimitCredits === null ? null : Math.round(teamLimitCredits * 1000), p_member_limit: memberLimitCredits === null ? null : Math.round(memberLimitCredits * 1000) }), enabled ? "Shared AI credits are on. Members choose whether to use them." : "Shared AI credits are off.");
}
export async function setMemberLimit(teamId: string, userId: string, credits: number | null): Promise<Out> {
  return run(teamId, "team_ai_member_limit_set", (u) => ({ p_actor: u, p_team: teamId, p_user: userId, p_limit: credits === null ? null : Math.round(credits * 1000) }), "Limit saved.");
}
export async function requestMoreCredits(teamId: string, credits: number, reason: string): Promise<Out> {
  return run(teamId, "team_ai_request_more", (u) => ({ p_actor: u, p_team: teamId, p_mcr: Math.round(credits * 1000), p_reason: reason }), "Request sent to the team administrators.");
}
export async function decideRequest(teamId: string, requestId: string, approve: boolean, grantedCredits: number | null): Promise<Out> {
  return run(teamId, "team_ai_decide", (u) => ({ p_actor: u, p_request: requestId, p_approve: approve, p_granted: grantedCredits === null ? null : Math.round(grantedCredits * 1000) }), approve ? "Approved." : "Declined.");
}
export async function chooseFunding(teamId: string | null): Promise<Out> {
  return run(teamId ?? "none", "team_ai_set_funding", (u) => ({ p_actor: u, p_team: teamId }), teamId ? "Your AI requests now use the team's shared credits." : "Your AI requests use your own credits.");
}

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseUtm } from "./track";

/**
 * Credits a new account to the campaign it came from, using the short-lived first-visit cookie. Called right after a registration.
 * One row per account at most (a unique index), nothing is stored when there was no campaign or referrer, and a failure here never
 * affects registration.
 */
export async function recordSignupAttribution(userId: string): Promise<void> {
  try {
    const raw = (await cookies()).get("tp_attr")?.value;
    if (!raw) return;
    const a = JSON.parse(raw) as { s?: string | null; m?: string | null; c?: string | null; r?: string | null };
    const utm = parseUtm(`utm_source=${a.s ?? ""}&utm_medium=${a.m ?? ""}&utm_campaign=${a.c ?? ""}`);
    const ref = typeof a.r === "string" && /^[a-z0-9.-]{1,80}$/i.test(a.r) ? a.r.toLowerCase() : null;
    if (!utm.source && !utm.medium && !utm.campaign && !ref) return;
    await createAdminClient().from("product_events").insert({ event: "signup_attribution", user_id: userId, authenticated: true, utm_source: utm.source, utm_medium: utm.medium, utm_campaign: utm.campaign, referrer_host: ref });
  } catch { /* a duplicate or a missing table is fine */ }
}

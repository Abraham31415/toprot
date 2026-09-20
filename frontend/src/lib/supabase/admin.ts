import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for trusted server-side operations only
// (e.g. document generation callbacks). Never import this from
// a Client Component or expose the service role key to the browser.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

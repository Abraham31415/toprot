import { createClient } from "@/lib/supabase/server";
import { recordSignupAttribution } from "@/lib/analytics/attribution";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // A first sign-in with Google or a first confirmed email creates the account moments earlier: credit it to its campaign.
      const { data: { user } } = await supabase.auth.getUser();
      if (user && Date.now() - new Date(user.created_at).getTime() < 15 * 60_000) await recordSignupAttribution(user.id);
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirmation_failed`);
}

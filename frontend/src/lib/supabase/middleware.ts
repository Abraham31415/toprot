import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touching getUser() refreshes the session cookie if it's expired.
  const { data: { user } } = await supabase.auth.getUser();

  // A suspended account is stopped on every page and action. The row is readable only by its owner, so this uses the signed-in
  // person's own session, and a lookup failure never locks anyone out. Webhooks, sign-out and the notice page are exempt.
  if (user && !/^\/(?:suspended|logout|auth|api)(?:\/|$)/.test(request.nextUrl.pathname)) {
    const { data: suspended } = await supabase.from("account_suspensions").select("user_id").eq("user_id", user.id).maybeSingle();
    if (suspended) {
      const redirect = NextResponse.redirect(new URL("/suspended", request.url), 303);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }

  return response;
}

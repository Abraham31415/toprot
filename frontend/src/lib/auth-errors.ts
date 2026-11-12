/** Turns what Supabase says into something a person can act on. Messages it does not recognise are passed through unchanged. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered") || m.includes("user already exists")) {
    return "An account with this email already exists. Log in instead, or reset your password if you have forgotten it.";
  }
  if (m.includes("invalid login credentials")) return "The email or password is not right. Check them and try again, or reset your password.";
  if (m.includes("email not confirmed")) return "Confirm your email first. Open the link we sent you, then log in.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a few minutes and try again.";
  if (m.includes("password") && (m.includes("weak") || m.includes("least"))) return "Choose a stronger password of at least 8 characters.";
  if (m.includes("valid email") || m.includes("invalid email")) return "Enter a valid email address.";
  if (m.includes("fetch") || m.includes("network")) return "We could not reach the server. Check your connection and try again.";
  return message;
}

/** Messages for the ?error= values the callback route and the sign-in pages use. */
export function callbackError(code: string | undefined): string | null {
  if (code === "confirmation_failed") return "That link did not work. It may have expired or been used already. Log in, or request a new one.";
  return null;
}

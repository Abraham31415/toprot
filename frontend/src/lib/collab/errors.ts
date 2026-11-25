// Database error codes raised by the collaboration functions, in words a person can act on.
const MESSAGES: Record<string, string> = {
  not_owner: "Only the project owner can do that.",
  forbidden: "You do not have access to this project.",
  invalid_role: "That role does not exist.",
  invalid_email: "Enter a valid email address.",
  cannot_invite_self: "You cannot invite yourself.",
  already_member: "That person is already on this project.",
  already_invited: "That email already has a pending invitation. Resend or revoke it instead.",
  role_not_in_plan: "Your plan does not include that role. Free projects can invite supervisors (reviewers) only. Upgrade to Pro or Advanced to invite editors and viewers.",
  role_limit_reached: "This project has reached the limit for that role on your plan.",
  rate_limited_owner: "You have sent a lot of invitations today. Try again tomorrow.",
  rate_limited_recipient: "That email address has received several invitations recently. Try again later.",
  too_many_pending: "This project has too many pending invitations. Revoke some first.",
  resend_too_soon: "This invitation was sent a moment ago. Wait a few minutes before resending.",
  resend_limit: "This invitation has been resent too many times. Revoke it and invite again.",
  not_pending: "That invitation is no longer pending.",
  invitation_invalid: "This invitation link is not valid for your account. Sign in with the email address the invitation was sent to.",
  invitation_closed: "This invitation has already been used, declined or withdrawn.",
  invitation_expired: "This invitation has expired. Ask the project owner to send a new one.",
  not_a_member: "That person is not on this project.",
  owner_cannot_be_member: "The project owner is already on the project.",
};

/** The first known code found in a database or RPC error message, else null. */
export function collabErrorCode(message: string | undefined | null): string | null {
  if (!message) return null;
  for (const code of Object.keys(MESSAGES)) if (message.includes(code)) return code;
  return null;
}

export function collabErrorMessage(message: string | undefined | null, fallback = "Something went wrong. Try again."): string {
  const code = collabErrorCode(message);
  return code ? MESSAGES[code] : fallback;
}

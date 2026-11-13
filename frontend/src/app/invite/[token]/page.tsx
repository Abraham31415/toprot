import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MailCheck } from "lucide-react";
import { AppFrame } from "@/components/app/app-frame";
import { ButtonLink, Container, PageHeader } from "@/components/ds";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABEL, ROLE_SUMMARY, TITLE_TEXT, type MemberRole, type TitleLabel } from "@/lib/collab/roles";
import { TEAM_ROLE_LABEL, TEAM_ROLE_SUMMARY, type TeamRole } from "@/lib/collab/teams";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Project invitation", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Preview = { kind?: "project" | "team"; state: "invalid" | "pending" | "accepted" | "declined" | "revoked" | "expired"; invitation_id?: string; study_title?: string; role?: MemberRole | "administrator" | "member" | "guest"; title_label?: TitleLabel | null; invited_by?: string; expires_at?: string };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Not signed in: the link only works for the invited email, so ask them to sign in first and come back here.
  if (!user) {
    const next = /^[0-9a-f]{64}$/.test(token) ? `?next=${encodeURIComponent(`/invite/${token}`)}` : "";
    return (
      <Container width="narrow">
        <PageHeader title="You have a project invitation" lead="Sign in with the email address the invitation was sent to. If you do not have a ToProt account yet, create one with that address, confirm it, then open this link again." />
        <div className="flex flex-wrap gap-3 pb-16">
          <ButtonLink href={`/login${next}`}>Log in</ButtonLink>
          <ButtonLink href="/register" variant="secondary">Create an account</ButtonLink>
        </div>
      </Container>
    );
  }
  if (!user.email_confirmed_at) redirect("/login");

  const { data } = await createAdminClient().rpc("collab_invitation_preview", { p_actor: user.id, p_token: token });
  const p = (data ?? { state: "invalid" }) as Preview;

  return (
    <AppFrame>
      <Container width="narrow">
        <PageHeader title={p.state === "pending" ? (p.kind === "team" ? "Join a team" : "Join a research project") : "Invitation"} eyebrow="Invitation" />
        <div className="pb-16">
          {p.state === "pending" && p.invitation_id && p.role ? (
            <div className="rounded-card border border-line bg-surface p-6 shadow-card">
              <MailCheck className="h-6 w-6 text-primary" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-semibold text-ink">{p.study_title}</h2>
              {p.kind === "team" ? (
                <>
                  <p className="mt-1 text-sm text-ink-soft">
                    {p.invited_by ? `${p.invited_by} invited you` : "You are invited"} to join this team as <strong className="text-ink">{TEAM_ROLE_LABEL[p.role as TeamRole]}</strong>.
                  </p>
                  <p className="mt-2 text-sm text-ink-soft">{TEAM_ROLE_SUMMARY[p.role as TeamRole]} Joining a team does not give you access to any project until its owner adds you.</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm text-ink-soft">
                    {p.invited_by ? `${p.invited_by} invited you` : "You are invited"} as <strong className="text-ink">{ROLE_LABEL[p.role as MemberRole]}</strong>
                    {p.title_label ? ` (${TITLE_TEXT[p.title_label]})` : ""}.
                  </p>
                  <p className="mt-2 text-sm text-ink-soft">{ROLE_SUMMARY[p.role as MemberRole]}</p>
                </>
              )}
              <AcceptForm token={token} invitationId={p.invitation_id} />
            </div>
          ) : (
            <div className="rounded-card border border-line bg-surface p-6">
              <p className="font-medium text-ink">
                {p.state === "expired" ? "This invitation has expired."
                  : p.state === "accepted" ? "This invitation was already accepted."
                  : p.state === "declined" ? "This invitation was declined."
                  : p.state === "revoked" ? "This invitation was withdrawn."
                  : "This invitation is not valid for your account."}
              </p>
              <p className="mt-2 text-sm text-ink-soft">
                {p.state === "expired" ? "Ask the project owner to send a new one."
                  : p.state === "invalid" ? "Check that you are signed in with the email address the invitation was sent to. For privacy, we show nothing else about it."
                  : "You can open shared projects from your list."}
              </p>
              <p className="mt-4"><Link href="/shared" className="text-sm font-medium text-primary hover:underline">Go to Shared with me</Link></p>
            </div>
          )}
        </div>
      </Container>
    </AppFrame>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { Container, EmptyState, PageHeader } from "@/components/ds";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABEL, TITLE_TEXT, type MemberRole, type TitleLabel } from "@/lib/collab/roles";
import { InvitationRow, type PendingInvitation } from "./invitation-row";

export const metadata: Metadata = { title: "Shared with me", robots: { index: false } };
export const dynamic = "force-dynamic";

type Shared = { study_id: string; title: string; role: MemberRole; title_label: TitleLabel | null; owner_name: string; status: string; last_activity_at: string; active: boolean };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function SharedWithMePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const db = createAdminClient();
  const [{ data: shared }, { data: invites }] = await Promise.all([
    db.rpc("collab_shared_with", { p_actor: user.id }),
    db.rpc("collab_my_invitations", { p_actor: user.id }),
  ]);
  const projects = (shared ?? []) as Shared[];
  const pending = (invites ?? []) as PendingInvitation[];

  return (
    <Container width="default">
      <PageHeader title="Shared with me" eyebrow="Collaboration" lead="Projects other researchers have given you access to, and invitations waiting for your answer. Your own projects are on the dashboard." />
      <div className="flex flex-col gap-10 pb-16">
        {pending.length > 0 && (
          <section aria-labelledby="inv-h">
            <h2 id="inv-h" className="type-eyebrow mb-2">Invitations</h2>
            <ul className="divide-y divide-line rounded-card border border-line bg-surface">{pending.map((i) => <InvitationRow key={i.invitation_id} inv={i} />)}</ul>
          </section>
        )}
        <section aria-labelledby="shared-h">
          <h2 id="shared-h" className="type-eyebrow mb-2">Projects</h2>
          {projects.length === 0 ? (
            <EmptyState icon={FolderOpen} title="Nothing has been shared with you yet" description="When a researcher invites you to a project and you accept, it appears here." />
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line bg-surface">
              {projects.map((p) => (
                <li key={p.study_id}>
                  {p.active ? (
                    <Link href={`/studies/${p.study_id}/protocol`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-hover">
                      <Row p={p} />
                    </Link>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4 opacity-80"><Row p={p} paused /></div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Container>
  );
}

function Row({ p, paused = false }: { p: Shared; paused?: boolean }) {
  return (
    <>
      <div>
        <p className="font-medium text-ink">{p.title}</p>
        <p className="text-sm text-ink-soft">Owner: {p.owner_name || "Unnamed"}. Last activity {when(p.last_activity_at)}.</p>
        {paused && <p className="text-sm text-warning-ink">Access is paused because the owner&apos;s plan does not currently include this role.</p>}
      </div>
      <span className="rounded-full bg-surface-soft px-2.5 py-0.5 text-xs font-medium text-ink">{ROLE_LABEL[p.role]}{p.title_label ? `, ${TITLE_TEXT[p.title_label].toLowerCase()}` : ""}</span>
    </>
  );
}

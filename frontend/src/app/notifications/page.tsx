import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { Container, EmptyState, PageHeader } from "@/components/ds";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationItem } from "@/lib/collab/review";
import { MarkReadButton } from "./mark-read";

export const metadata: Metadata = { title: "Notifications", robots: { index: false } };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await createAdminClient().rpc("collab_notifications", { p_actor: user.id, p_limit: 100 });
  const items = (data ?? []) as NotificationItem[];
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <Container width="default">
      <PageHeader title="Notifications" eyebrow="Collaboration" lead="Reviews, comments and invitations on your projects. These are always kept here, whether or not email is set up."
        actions={unread > 0 ? <MarkReadButton id={null} label="Mark all as read" /> : undefined} />
      <div className="pb-16">
        {items.length === 0 ? (
          <EmptyState icon={Bell} title="Nothing yet" description="When a supervisor reviews your work or someone comments on a project, it shows up here." />
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {items.map((n) => (
              <li key={n.id} className={`flex flex-wrap items-start justify-between gap-3 p-4 ${n.read_at ? "" : "bg-surface-soft"}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{!n.read_at && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-primary align-middle" aria-label="Unread" />}{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
                  {n.body && <p className="mt-0.5 text-sm text-ink-soft">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-ink-muted">{when(n.created_at)}</p>
                </div>
                {!n.read_at && <MarkReadButton id={n.id} label="Mark read" />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Container>
  );
}

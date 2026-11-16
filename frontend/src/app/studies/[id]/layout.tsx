import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/ds/breadcrumbs";
import { ShareProjectDialog } from "@/components/collab/share-project-dialog";
import { createClient } from "@/lib/supabase/server";
import { roleOf } from "@/lib/collab/access";
import { ROLE_LABEL } from "@/lib/collab/roles";

export default async function StudyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: study } = await supabase.from("studies").select("title").eq("id", id).single();
  const role = study ? await roleOf(supabase, id) : null;
  const { count } = role ? await supabase.from("project_memberships").select("user_id", { count: "exact", head: true }).eq("study_id", id) : { count: 0 };
  return (
    <>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 pt-6">
        <div className="min-w-0 flex-1">
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: study?.title ?? "Study", href: `/studies/${id}/protocol` },
            ]}
          />
        </div>
        {role && (
          <div className="flex items-center gap-3">
            {role !== "owner" && <span className="rounded-full bg-surface-soft px-2.5 py-0.5 text-xs font-medium text-ink">{ROLE_LABEL[role]} access</span>}
            <ShareProjectDialog studyId={id} role={role} memberCount={count ?? 0} />
          </div>
        )}
      </div>
      {children}
    </>
  );
}

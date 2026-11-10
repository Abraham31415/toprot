import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/app/breadcrumbs";
import { createClient } from "@/lib/supabase/server";

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
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: study?.title ?? "Study", href: `/studies/${id}/protocol` },
        ]}
      />
      {children}
    </>
  );
}

import { Breadcrumbs as DsBreadcrumbs, type Crumb } from "@/components/ds/breadcrumbs";

export type { Crumb };

/** Breadcrumbs for signed-in pages: the shared trail, placed in the workspace's content width. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <div className="mx-auto max-w-5xl px-6 pt-6">
      <DsBreadcrumbs items={items} />
    </div>
  );
}

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mx-auto max-w-5xl px-6 pt-6">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-navy/65">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
            {c.href ? (
              <Link href={c.href} className="hover:text-cobalt">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-navy">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

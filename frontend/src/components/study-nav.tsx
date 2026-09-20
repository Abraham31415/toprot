import Link from "next/link";

const TABS = [
  { slug: "protocol", label: "Protocol" },
  { slug: "references", label: "References" },
  { slug: "milestones", label: "Milestones" },
  { slug: "deviations", label: "Deviations" },
  { slug: "outputs", label: "Outputs" },
  { slug: "deviation-report", label: "Final report" },
] as const;

export function StudyNav({ studyId, active }: { studyId: string; active: (typeof TABS)[number]["slug"] }) {
  return (
    <nav className="mb-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((tab) => (
        <Link
          key={tab.slug}
          href={`/studies/${studyId}/${tab.slug}`}
          className={`px-3 py-2 text-sm font-medium ${
            active === tab.slug
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

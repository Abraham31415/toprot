import Link from "next/link";

const TABS = [
  { slug: "protocol", label: "Protocol" },
  { slug: "references", label: "References" },
  { slug: "calculations", label: "Calculations" },
  { slug: "milestones", label: "Milestones" },
  { slug: "deviations", label: "Deviations" },
  { slug: "outputs", label: "Outputs" },
  { slug: "deviation-report", label: "Final report" },
] as const;

export function StudyNav({ studyId, active }: { studyId: string; active: (typeof TABS)[number]["slug"] }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((tab) => (
        <Link
          key={tab.slug}
          href={`/studies/${studyId}/${tab.slug}`}
          className={`whitespace-nowrap px-3 py-2 text-sm font-medium ${
            active === tab.slug
              ? "border-b-2 border-cobalt text-teal-ink"
              : "text-navy/65 hover:text-navy"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

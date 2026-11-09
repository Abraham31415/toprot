import Link from "next/link";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/examples", label: "Examples" },
      { href: "/pricing", label: "Pricing" },
      { href: "/calculator", label: "Sample size calculator" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/resources", label: "Resources" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div>
          <p className="text-lg font-semibold text-navy">ToProt</p>
          <p className="mt-2 max-w-xs text-sm text-navy/70">
            Enter your study once. Generate the documents that follow from it.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="text-sm font-semibold text-navy">{c.title}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-navy/70 hover:text-teal">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line px-4 py-4 text-center text-xs text-navy/60 sm:px-6">
        &copy; {new Date().getFullYear()} ToProt. ToProt does not provide medical or legal advice, and has no
        regulatory certification or institutional endorsement.
      </div>
    </footer>
  );
}

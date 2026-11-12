import Link from "next/link";
import { Container } from "@/components/ds/layout";

// Every public page is reachable from here, including the secondary ones the header keeps under "More".
const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/tools", label: "Research tools" },
      { href: "/literature", label: "Literature" },
      { href: "/pricing", label: "Pricing" },
      { href: "/calculator", label: "Sample size calculator" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/resources", label: "Resources" },
      { href: "/docs", label: "Documentation" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/examples", label: "Examples" },
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
    <footer className="print:hidden border-t border-line bg-surface">
      <Container className="grid gap-8 py-12 md:grid-cols-4">
        <div>
          <p className="text-lg font-semibold text-ink">ToProt</p>
          <p className="type-support mt-2 max-w-xs">Enter your study once. Generate the documents that follow from it.</p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="type-label">{c.title}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {c.links.map((l) => (
                <li key={l.href}><Link href={l.href} className="type-support rounded-sm hover:text-primary hover:underline">{l.label}</Link></li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <div className="type-caption border-t border-line px-4 py-4 text-center sm:px-6">
        &copy; {new Date().getFullYear()} ToProt. ToProt does not provide medical or legal advice, and has no regulatory certification or institutional endorsement.
      </div>
    </footer>
  );
}

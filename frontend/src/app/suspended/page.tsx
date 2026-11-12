import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Account suspended", robots: { index: false, follow: false } };

export default function SuspendedPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="type-page">Your account is suspended</h1>
      <p className="type-body mt-3 !text-base">You cannot use ToProt while your account is suspended. Your projects and documents have not been deleted.</p>
      <p className="type-body mt-3 !text-base">If you think this is a mistake, <Link href="/contact" className="font-medium text-primary underline">contact us</Link> and mention the email address you signed up with.</p>
      <form action="/logout" method="post" className="mt-6">
        <button type="submit" className="h-10 rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:border-primary">Log out</button>
      </form>
    </main>
  );
}

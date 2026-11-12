"use client";

import Link from "next/link";

// Shown when a page fails while it renders. It never shows the technical message: that can contain details a visitor should
// not see. The reference code lets us find the matching entry in the server logs.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-6 py-16 text-navy">
      <p className="text-sm font-semibold uppercase tracking-wide text-teal-ink">Something went wrong</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">This page could not be loaded</h1>
      <p className="mt-4 text-navy/75">
        The problem is on our side. Your work is saved. Try again, and if it keeps happening, go back to the dashboard and contact us with the reference below.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="rounded-md bg-cobalt px-5 py-3 text-sm font-medium text-white hover:bg-cobalt-dark">Try again</button>
        <Link href="/dashboard" className="rounded-md border border-navy/25 bg-white px-5 py-3 text-sm font-medium text-navy hover:border-cobalt">Go to the dashboard</Link>
      </div>
      {error.digest && <p className="mt-6 text-xs text-navy/55">Reference: {error.digest}</p>}
    </main>
  );
}

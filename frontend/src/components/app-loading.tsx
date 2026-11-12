// A light placeholder shown instantly while a signed-in page fetches its data, so navigation feels responsive.
export function AppLoading({ label }: { label: string }) {
  return (
    <div className="min-h-screen bg-paper" role="status" aria-live="polite">
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <span className="sr-only">Loading {label}</span>
        <div className="h-7 w-56 animate-pulse rounded bg-navy/10" />
        <div className="mt-3 h-4 w-80 max-w-full animate-pulse rounded bg-navy/5" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="h-40 animate-pulse rounded-xl border border-line bg-white" />
          <div className="h-40 animate-pulse rounded-xl border border-line bg-white" />
        </div>
        <div className="mt-4 h-56 animate-pulse rounded-xl border border-line bg-white" />
      </main>
    </div>
  );
}

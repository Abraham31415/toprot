import { LogoLoader } from "@/components/brand";

// Shown instantly while a signed-in page fetches its data, so navigation feels responsive: the ToProt mark draws,
// holds and fades on a loop, with faint placeholders below so the page does not jump when the content arrives.
export function AppLoading({ label }: { label: string }) {
  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-center gap-3 py-10">
          <LogoLoader size={56} label={`Loading ${label}`} />
          <p aria-hidden="true" className="type-caption">Loading {label}</p>
        </div>
        <div aria-hidden="true" className="grid gap-4 opacity-60 sm:grid-cols-2">
          <div className="h-40 rounded-xl border border-line bg-white" />
          <div className="h-40 rounded-xl border border-line bg-white" />
        </div>
        <div aria-hidden="true" className="mt-4 h-56 rounded-xl border border-line bg-white opacity-60" />
      </main>
    </div>
  );
}

import Link from "next/link";
import type { Profile } from "@/lib/supabase/profile";

export function AppHeader({ profile }: { profile: Profile }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <div>
        <p className="font-semibold text-navy dark:text-zinc-50">ToProt</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {profile.full_name} · <span className="capitalize">{profile.role}</span>
        </p>
      </div>
      <div className="flex items-center gap-3">
      <Link
        href="/ai-usage"
        className="text-sm font-medium text-zinc-600 hover:underline dark:text-zinc-400"
      >
        AI credits
      </Link>
      <form action="/logout" method="post">
        <button
          type="submit"
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Log out
        </button>
      </form>
      </div>
    </header>
  );
}

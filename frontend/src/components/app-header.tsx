import Link from "next/link";
import type { Profile } from "@/lib/supabase/profile";

export function AppHeader({ profile }: { profile: Profile }) {
  return (
    <header className="flex items-center justify-between border-b border-line px-6 py-4">
      <div>
        <p className="font-semibold text-navy">ToProt</p>
        <p className="text-sm text-navy/65">
          {profile.full_name} · <span className="capitalize">{profile.role}</span>
        </p>
      </div>
      <div className="flex items-center gap-3">
      <Link
        href="/ai-usage"
        className="text-sm font-medium text-navy/75 hover:underline"
      >
        AI credits
      </Link>
      <form action="/logout" method="post">
        <button
          type="submit"
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-navy/85 transition-colors hover:bg-navy/5"
        >
          Log out
        </button>
      </form>
      </div>
    </header>
  );
}

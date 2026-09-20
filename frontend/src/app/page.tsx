import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";

export default async function Home() {
  const profile = await getCurrentProfile();

  if (profile) {
    if (!profile.role) redirect("/onboarding");
    redirect(profile.role === "supervisor" ? "/supervisor" : "/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          ToProt
        </h1>
        <div className="flex flex-col gap-1.5">
          <p className="text-lg font-medium text-zinc-800 dark:text-zinc-200">
            Plan. Run. Prove.
          </p>
          <p className="text-zinc-600 dark:text-zinc-400">
            Enter it once, generate everything else.
          </p>
        </div>
        <div className="flex w-full gap-3">
          <Link
            href="/register"
            className="flex-1 rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Get started
          </Link>
          <Link
            href="/login"
            className="flex-1 rounded-lg border border-zinc-200 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Log in
          </Link>
        </div>
      </main>
    </div>
  );
}

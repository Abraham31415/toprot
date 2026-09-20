import { ConnectionStatus } from "../connection-status";

export default function StatusPage() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            System status
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Live connectivity check for Supabase and the document service.
          </p>
        </div>
        <ConnectionStatus />
      </main>
    </div>
  );
}

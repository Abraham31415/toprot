import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { AssistantView } from "@/components/assistant/assistant-view";
import { listThreads, loadProjectOptions } from "./actions";

export const metadata = { title: "AI research assistant" };
// A request may run several model passes and tool calls; give it time (each request also has its own 55 second cap).
export const maxDuration = 60;

export default async function AssistantPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const [threads, options] = await Promise.all([listThreads(), loadProjectOptions()]);
  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6">
        <h1 className="text-xl font-semibold text-navy">AI research assistant</h1>
        <p className="mt-1 text-sm text-navy/65">
          Works from your own projects, saved references, PDFs and manuscripts. It reads them with limited, read-only tools and cannot change anything. Answers are labelled as AI, and sources are checked against your documents.
        </p>
        <div className="mt-5"><AssistantView initialThreads={threads} options={options} /></div>
      </main>
    </div>
  );
}

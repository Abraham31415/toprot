"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TEMPLATES, type TemplateId } from "@/lib/writing/templates";
import { createManuscript } from "./actions";

const field = "w-full min-w-0 rounded-md border border-navy/25 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20";

export function NewManuscriptForm({ studyId }: { studyId: string }) {
  const router = useRouter();
  const [template, setTemplate] = useState<TemplateId>("original_article");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = TEMPLATES.find((t) => t.id === template)!;

  const create = () => start(async () => {
    setError(null);
    const r = await createManuscript(studyId, template, title, "apa");
    if (r.error || !r.id) { setError(r.error ?? "Could not create the manuscript."); return; }
    router.push(`/studies/${studyId}/writing/${r.id}`);
  });

  return (
    <section aria-labelledby="new-ms" className="rounded-md border border-line bg-white p-4">
      <h2 id="new-ms" className="text-sm font-semibold text-navy">New manuscript</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ms-template" className="text-xs font-medium text-navy">Template</label>
          <select id="ms-template" className={`${field} mt-1`} value={template} onChange={(e) => setTemplate(e.target.value as TemplateId)}>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ms-title" className="text-xs font-medium text-navy">Title</label>
          <input id="ms-title" className={`${field} mt-1`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && title.trim() && create()} placeholder="Working title" />
        </div>
      </div>
      <p className="mt-2 text-xs text-navy/65">{chosen.description}{chosen.guideline ? ` ${chosen.guideline}` : ""} Templates add headings only, never sample text.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <button type="button" disabled={pending || !title.trim()} onClick={create} className="mt-3 rounded-md bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50">
        {pending ? "Creating..." : "Create and open"}
      </button>
    </section>
  );
}

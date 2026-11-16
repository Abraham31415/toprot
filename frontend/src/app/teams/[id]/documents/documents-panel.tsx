"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ds";
import { createClient } from "@/lib/supabase/client";
import { formatBytes, type TeamDocument, type TeamRole } from "@/lib/collab/teams";
import { deleteDocument, documentDownloadUrl, finalizeDocument, registerDocument } from "@/app/teams/actions";

const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg";
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function DocumentsPanel({ teamId, userId, role, canUpload, docs, projects }: { teamId: string; userId: string; role: TeamRole; canUpload: boolean; docs: TeamDocument[]; projects: { id: string; title: string }[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const ids = { file: useId(), project: useId() };
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mime = MIME_BY_EXT[ext];
    if (!mime) { setNotice({ error: "That file type is not allowed. Use PDF, Word, Excel, CSV, text, PNG or JPEG." }); return; }
    setBusy(true); setNotice(null);
    try {
      const reg = await registerDocument(teamId, file.name, mime, file.size, project || null);
      if (reg.error || !reg.id || !reg.path) { setNotice({ error: reg.error ?? "Could not start the upload." }); return; }
      // The file goes straight to private storage under the user's own session; storage rules allow only this pending upload.
      const { error } = await createClient().storage.from("team-documents").upload(reg.path, file, { contentType: mime, upsert: false });
      if (error) { setNotice({ error: "The upload failed. Try again." }); return; }
      const fin = await finalizeDocument(teamId, reg.id);
      setNotice(fin.error ? { error: fin.error } : { message: "Uploaded." });
      if (input.current) input.current.value = "";
      router.refresh();
    } finally { setBusy(false); }
  }

  const download = (id: string) => start(async () => { const r = await documentDownloadUrl(id); if (r.url) window.open(r.url, "_blank", "noopener"); else setNotice({ error: r.error }); });
  const remove = (id: string, name: string) => { if (confirm(`Delete ${name}? This cannot be undone.`)) start(async () => { const r = await deleteDocument(teamId, id); setNotice(r); if (!r.error) router.refresh(); }); };

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-ink-soft">Files are stored privately. {role === "guest" ? "You can open documents attached to projects you are on." : "Team members can open team files. A file attached to a project is also visible to that project's people, including guest reviewers."} PDF, Word, Excel, CSV, text, PNG and JPEG, up to 10 MB each.</p>
      <div role="status" aria-live="polite" className="empty:hidden">
        {notice?.error && <p className="rounded-control border border-danger-line bg-danger-bg p-3 text-sm text-danger-ink">{notice.error}</p>}
        {notice?.message && !notice.error && <p className="rounded-control border border-line bg-surface-soft p-3 text-sm">{notice.message}</p>}
      </div>
      {canUpload && (
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div><label htmlFor={ids.file} className="mb-1 block text-sm font-medium">File</label><input id={ids.file} ref={input} type="file" accept={ACCEPT} className="block text-sm" /></div>
            <div><label htmlFor={ids.project} className="mb-1 block text-sm font-medium">Attach to a project <span className="font-normal text-ink-soft">(optional)</span></label>
              <select id={ids.project} value={project} onChange={(e) => setProject(e.target.value)} className="min-h-10 rounded-control border border-line-strong bg-surface px-3 text-sm"><option value="">Team only</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
            <Button loading={busy} onClick={upload}><Upload className="h-4 w-4" aria-hidden="true" />Upload</Button>
          </div>
        </div>
      )}
      {docs.length === 0 ? <p className="text-sm text-ink-soft">No documents yet.</p> : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0"><p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink"><FileText className="h-4 w-4 flex-none text-ink-soft" aria-hidden="true" />{d.name}</p>
                <p className="text-xs text-ink-soft">{formatBytes(d.size_bytes)}. {d.uploaded_by ?? "Former member"}, {new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.{d.project ? ` Project: ${d.project}.` : ""}</p></div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => download(d.id)} aria-label={`Download ${d.name}`}><Download className="h-4 w-4" aria-hidden="true" />Download</Button>
                {(d.uploaded_by_id === userId || role === "owner" || role === "administrator") && <button type="button" disabled={pending} onClick={() => remove(d.id, d.name)} aria-label={`Delete ${d.name}`} className="rounded-control p-2 text-ink-soft hover:bg-hover hover:text-danger-ink"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Link from "next/link";
import { Download } from "lucide-react";
import { Badge, Notice, PageTitle, Pager, Section, Table } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dateTime, num } from "@/lib/admin/format";
import { loadReport } from "@/lib/admin/load";
import { adminTimeZone } from "@/lib/admin/range";

export const metadata = { title: "Audit Logs" };
const PAGE = 50;
const KINDS = [["", "All"], ["account.", "Account changes"], ["credits.", "Credits"], ["setting.", "Settings"], ["user.view", "Account views"], ["export.", "Exports"], ["alert.", "Alerts"]] as const;

type Page = { total: number; rows: { id: number; created_at: string; actor_email: string | null; action: string; target_type: string | null; target_id: string | null; reason: string | null; details: Record<string, unknown>; ip: string | null; hash: string }[] };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const kind = KINDS.some(([k]) => k === (sp.kind ?? "")) ? sp.kind ?? "" : "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const tz = adminTimeZone();
  const [r, v] = await Promise.all([
    loadReport<Page>(s, "admin_audit_page", { p_action: kind || null, p_limit: PAGE, p_offset: (page - 1) * PAGE }),
    loadReport<{ intact: boolean; first_bad_id: number | null; checked: number }>(s, "admin_audit_verify"),
  ]);
  return (
    <>
      <PageTitle title="Audit Logs" lead="Every administrative change, and every look at an account's private page. Entries cannot be edited or deleted, and each one is chained to the one before it so tampering is detectable."
        actions={<Link href="/admin/export/audit" className="inline-flex h-9 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium hover:border-primary"><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Link>} />
      {v.data && (v.data.intact ? <Notice tone="info" title="Integrity check passed">{num(v.data.checked)} entries were recomputed and every one matches the chain.</Notice>
        : <Notice tone="danger" title="Integrity check failed">Entry {v.data.first_bad_id} does not match the chain. Treat the log as untrustworthy and investigate.</Notice>)}
      {r.error && <Notice tone="danger">{r.error}</Notice>}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by kind">
        {KINDS.map(([k, label]) => <Link key={k || "all"} href={k ? `/admin/audit?kind=${encodeURIComponent(k)}` : "/admin/audit"} aria-current={kind === k ? "true" : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium ${kind === k ? "border-primary bg-primary text-white" : "border-line-strong bg-surface text-ink hover:border-primary"}`}>{label}</Link>)}
      </div>
      {r.data && (
        <Section title={`${num(r.data.total)} entries`}>
          <Table caption="Audit log" head={["#", "When", "Administrator", "Action", "Target", "Reason", "Details", "Chain"]} empty="No entries."
            rows={r.data.rows.map((e) => [e.id, dateTime(e.created_at, tz), e.actor_email ?? "-", <Badge key="a" tone={e.action.startsWith("user.view") ? "neutral" : "info"}>{e.action}</Badge>, e.target_type ? `${e.target_type} ${e.target_id ?? ""}`.slice(0, 48) : "-", e.reason ?? "-",
              <code key="d" className="text-xs">{Object.keys(e.details).length ? JSON.stringify(e.details) : "-"}</code>, <code key="h" className="text-xs">{e.hash}</code>])} />
          <Pager total={r.data.total} page={page} pageSize={PAGE} hrefFor={(p) => `/admin/audit?${new URLSearchParams({ ...(kind ? { kind } : {}), page: String(p) }).toString()}`} />
        </Section>
      )}
    </>
  );
}

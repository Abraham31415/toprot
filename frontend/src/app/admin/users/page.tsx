import Link from "next/link";
import { Download } from "lucide-react";
import { Badge, Notice, PageTitle, Pager, Table, inputCls } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dateTime, dec, money, num } from "@/lib/admin/format";
import { adminTimeZone } from "@/lib/admin/range";
import { loadReport } from "@/lib/admin/load";

export const metadata = { title: "Users" };
const PAGE = 25;
const FILTERS = [["all", "All"], ["free", "Free"], ["pro", "Pro"], ["team", "Team"], ["active", "Active (30 days)"], ["inactive", "Inactive (30 days)"], ["suspended", "Suspended"], ["recent", "Registered this week"]] as const;

type Row = { id: string; name: string; email: string; role: string | null; registered_at: string; suspended: boolean; is_admin: boolean; plan: string; last_activity: string | null; projects: number; credits_available: number; verified_payments: { currency: string; amount: number; payments: number }[] };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const sp = await searchParams;
  const filter = FILTERS.some(([k]) => k === sp.filter) ? sp.filter! : "all";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const q = (sp.q ?? "").slice(0, 100);
  const tz = adminTimeZone();
  const r = await loadReport<{ total: number; rows: Row[] }>(s, "admin_users_page", { p_search: q || null, p_filter: filter, p_limit: PAGE, p_offset: (page - 1) * PAGE });
  const href = (over: Record<string, string>) => { const p = new URLSearchParams({ ...(q ? { q } : {}), ...(filter !== "all" ? { filter } : {}), ...over }); return `/admin/users?${p.toString()}`; };

  return (
    <>
      <PageTitle title="Users" lead="Everyone who has registered. Open an account to see its subscription, payments, credits and AI usage. Project titles and research content are never shown here."
        actions={<Link href={`/admin/export/users?${new URLSearchParams({ ...(q ? { q } : {}), filter }).toString()}`} className="inline-flex h-9 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium hover:border-primary"><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Link>} />
      <form action="/admin/users" method="get" role="search" className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="user-q" className="sr-only">Search by name or email</label>
        <input id="user-q" name="q" defaultValue={q} placeholder="Search by name or email" className={`${inputCls} max-w-sm`} />
        {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
        <button type="submit" className="h-9 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium hover:border-primary">Search</button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter accounts">
        {FILTERS.map(([k, label]) => <Link key={k} href={href({ filter: k })} aria-current={filter === k ? "true" : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === k ? "border-primary bg-primary text-white" : "border-line-strong bg-surface text-ink hover:border-primary"}`}>{label}</Link>)}
      </div>
      {r.error && <Notice tone="danger">{r.error}</Notice>}
      {r.data && (
        <div className="mt-4">
          <Table caption="Registered users" numeric={[5, 6, 7]}
            head={["Name and email", "Registered", "Status", "Plan", "Last activity", "Projects", "AI credits left", "Verified payments"]}
            empty="No accounts match."
            rows={r.data.rows.map((u) => [
              <Link key="n" href={`/admin/users/${u.id}`} className="block min-w-0 font-medium text-primary hover:underline">{u.name || "(no name)"}<span className="block truncate text-xs font-normal text-ink-muted">{u.email}</span></Link>,
              dateTime(u.registered_at, tz),
              <span key="s" className="flex flex-wrap gap-1">{u.suspended ? <Badge tone="danger">Suspended</Badge> : <Badge tone="success">Active</Badge>}{u.is_admin && <Badge tone="info">Admin</Badge>}</span>,
              <Badge key="p" tone={u.plan === "free" ? "neutral" : "info"}>{u.plan}</Badge>,
              u.last_activity ? dateTime(u.last_activity, tz) : "No recorded activity",
              num(u.projects), dec(u.credits_available, 1),
              u.verified_payments.length ? u.verified_payments.map((p) => `${money(p.amount, p.currency)} (${p.payments})`).join(", ") : "-",
            ])} />
          <Pager total={r.data.total} page={page} pageSize={PAGE} hrefFor={(p) => href({ page: String(p) })} />
        </div>
      )}
    </>
  );
}

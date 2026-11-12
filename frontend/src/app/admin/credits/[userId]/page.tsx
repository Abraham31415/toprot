import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageTitle, Pager, Table } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dateTime, dec } from "@/lib/admin/format";
import { loadReport } from "@/lib/admin/load";
import { adminTimeZone } from "@/lib/admin/range";

export const metadata = { title: "Credit ledger" };
const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tx = { id: number; created_at: string; user_id: string; kind: string; pool: string; credits: number; note: string | null; pool_running_balance: number; operation: string | null; model: string | null; billing_period_start: string | null; credit_source: string | null };

export default async function UserLedgerPage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const { userId } = await params;
  if (!UUID.test(userId)) notFound();
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const tz = adminTimeZone();
  const r = await loadReport<{ total: number; rows: Tx[] }>(s, "admin_credit_transactions", { p_user: userId, p_limit: PAGE, p_offset: (page - 1) * PAGE });
  return (
    <>
      <p className="type-support"><Link href={`/admin/users/${userId}`} className="text-primary hover:underline">Back to the account</Link></p>
      <PageTitle title="Credit ledger" lead="Every credit movement for this account, newest first. The running balance is the sum of all movements in that pool up to and including the row, so it is exact when the ledger covers the account's whole history." />
      {r.error && <Notice tone="danger">{r.error}</Notice>}
      {r.data && (
        <div className="mt-4">
          <Table caption="Credit transactions" numeric={[4, 5]} empty="No credit movements recorded for this account."
            head={["When", "User id", "Type", "Source and pool", "Credits", "Pool balance", "Operation", "Model", "Billing period"]}
            rows={r.data.rows.map((t) => [dateTime(t.created_at, tz), <code key="u" className="text-xs">{t.user_id.slice(0, 8)}</code>, t.kind, `${t.credit_source ?? (t.pool === "subscription" ? "plan allowance" : "purchased")} (${t.pool})`, dec(t.credits, 2), dec(t.pool_running_balance, 2), t.operation ?? t.note ?? "-", t.model ?? "-", t.billing_period_start ? dateTime(t.billing_period_start, tz) : "-"])} />
          <Pager total={r.data.total} page={page} pageSize={PAGE} hrefFor={(p) => `/admin/credits/${userId}?page=${p}`} />
        </div>
      )}
    </>
  );
}

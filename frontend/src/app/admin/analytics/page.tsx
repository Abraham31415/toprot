import { Bars, Kpi, KpiGrid, LineChart, Notice, PageTitle, RangeFilter, Section, Table } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dateTime, num, pct, NA } from "@/lib/admin/format";
import { iso, loadReport } from "@/lib/admin/load";
import { parseRange } from "@/lib/admin/range";

export const metadata = { title: "Traffic and funnel" };

type Traffic = {
  tracking_since: string | null;
  totals: { page_views: number; visitor_days: number; authenticated_views: number; anonymous_views: number };
  series: { day: string; page_views: number; visitors: number }[];
  top_pages: { path: string; views: number; visitors: number }[]; referrers: { referrer: string; views: number }[]; sources: { source: string; views: number }[];
  countries: { country: string; views: number }[]; devices: { device: string; views: number }[]; landing_pages: { path: string; entries: number }[];
};
type Funnel = { tracking_since: string | null; visitors: number; stages: { key: string; label: string; count: number }[]; campaigns: { campaign: string; source: string; registrations: number; active: number; with_project: number; paid: number }[] };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const range = parseRange(await searchParams);
  const args = { p_from: iso(range.from), p_to: iso(range.to) };
  const [t, f] = await Promise.all([loadReport<Traffic>(s, "admin_traffic", { ...args, p_tz: range.tz }), loadReport<Funnel>(s, "admin_funnel", args)]);
  const since = t.data?.tracking_since;

  return (
    <>
      <PageTitle title="Traffic and funnel" lead="Where visitors come from and how many become researchers, project owners and paying customers." />
      <RangeFilter range={range} base="/admin/analytics" />
      <Notice tone={since ? "info" : "warning"} title="How traffic is counted">
        {since ? <>ToProt records page views itself, without cookies and without storing addresses. Recording began on <strong>{dateTime(since, range.tz)}</strong>; there is no earlier history, so periods that start before that are incomplete.</>
          : <>No page views have been recorded yet. Recording starts once this version is live and visitors browse the site.</>}
        {" "}Vercel Web Analytics has no query interface, so its dashboard cannot be shown here; it can be added later through a Vercel drain if you want it. Visitors are counted per day with a daily-changing code, so a person who returns on another day counts again. Do Not Track and Global Privacy Control are respected.
      </Notice>
      {t.error && <Notice tone="danger">{t.error}</Notice>}
      {t.data && (
        <>
          <Section title="Traffic">
            <KpiGrid>
              <Kpi label="Page views" value={num(t.data.totals.page_views)} />
              <Kpi label="Visitors (visitor-days)" value={num(t.data.totals.visitor_days)} note="Distinct visitors per day, added up" />
              <Kpi label="Anonymous page views" value={num(t.data.totals.anonymous_views)} note="Not signed in" />
              <Kpi label="Signed-in page views" value={num(t.data.totals.authenticated_views)} note="A sign-in cookie was present" />
            </KpiGrid>
            <div className="mt-4"><LineChart title="Page views and visitors by day" labels={t.data.series.map((x) => x.day.slice(5))} series={[{ name: "Page views", values: t.data.series.map((x) => Number(x.page_views)), color: "primary" }, { name: "Visitors", values: t.data.series.map((x) => Number(x.visitors)), color: "teal" }]} /></div>
          </Section>
          <div className="grid gap-8 lg:grid-cols-2">
            <Section title="Top pages"><Table caption="Top pages" numeric={[1, 2]} head={["Page", "Views", "Visitors"]} empty="No page views." rows={t.data.top_pages.map((p) => [p.path, num(p.views), num(p.visitors)])} /></Section>
            <Section title="Landing pages" lead="The first page a visitor saw that day."><Table caption="Landing pages" numeric={[1]} head={["Page", "Entries"]} empty="No page views." rows={t.data.landing_pages.map((p) => [p.path, num(p.entries)])} /></Section>
            <Section title="Referring websites"><Bars rows={t.data.referrers.map((r) => ({ label: r.referrer, value: Number(r.views) }))} /></Section>
            <Section title="Traffic sources" lead="A campaign source (utm_source) when present, otherwise direct or referral."><Bars rows={t.data.sources.map((r) => ({ label: r.source, value: Number(r.views) }))} /></Section>
            <Section title="Countries" lead="From the country the hosting platform reports for the request."><Bars rows={t.data.countries.map((r) => ({ label: r.country, value: Number(r.views) }))} /></Section>
            <Section title="Device categories"><Bars rows={t.data.devices.map((r) => ({ label: r.device, value: Number(r.views) }))} /></Section>
          </div>
        </>
      )}
      <Section title="Acquisition funnel" lead="Built from account and activity records, so it is complete for people who registered in the period even before page tracking began. Only the visitor count depends on page tracking.">
        {f.error && <Notice tone="danger">{f.error}</Notice>}
        {f.data && (() => {
          const st = f.data.stages; const reg = st[0]?.count ?? 0;
          return (
            <>
              <Table caption="Funnel" numeric={[1, 2, 3]} head={["Stage", "People", "Of registered", "From previous stage"]}
                rows={[["Website visitors (anonymous visitor-days)", f.data.visitors ? num(f.data.visitors) : since ? num(0) : NA, "-", "-"],
                  ...st.map((x, i) => [x.label, num(x.count), pct(x.count, reg), i === 0 ? (f.data!.visitors ? `${pct(x.count, f.data!.visitors)} of visitors` : "-") : `${pct(x.count, st[i - 1].count)} (${num(st[i - 1].count - x.count)} dropped off)`])]} />
              <p className="type-caption mt-2">Registered means an account created in the period. Research activity means any recorded action. Paid means a verified subscription payment at any time. Visitors and registrations are different populations (visitor-days are not people), so the first row is a rough guide.</p>
              <h3 className="mt-6 text-sm font-semibold text-ink">Campaigns that produced research activity</h3>
              <p className="type-support">Registrations attributed by the campaign tags (utm parameters) on the visitor&apos;s first visit, and what those people did afterwards.</p>
              <div className="mt-2"><Table caption="Campaign results" numeric={[2, 3, 4, 5]} head={["Campaign", "Source", "Registrations", "Active", "Created a project", "Paid"]} empty="No registrations have a campaign recorded in this period. Add utm_source and utm_campaign to your links."
                rows={f.data.campaigns.map((c) => [c.campaign, c.source, num(c.registrations), num(c.active), num(c.with_project), num(c.paid)])} /></div>
            </>
          );
        })()}
      </Section>
      <Section title="Product events" lead="What is recorded, and from when.">
        <Table caption="Event definitions" head={["Event", "What it means", "Source"]} rows={[
          ["Registration completed", "An account was created", "Account records (complete history)"],
          ["Project created", "A study was created", "Project records (complete history)"],
          ["Reference saved", "A reference was added to a study", "Reference records (complete history)"],
          ["Document generated", "A study document was generated", "Document records (complete history)"],
          ["AI operation completed", "An AI request finished", "AI usage records (complete history)"],
          ["Subscription or credit top-up purchased", "A payment was verified", "Payment records (complete history)"],
          ["Calculator completed", "A calculator produced a result", "Page tracking, only since recording began"],
          ["Literature search", "A search was run in the Literature Explorer", "Page tracking, only since recording began"],
          ["Page view", "A page was opened", "Page tracking, only since recording began"],
        ]} />
        <p className="type-caption mt-2">No research content, titles, search terms or personal details are sent to any outside analytics service. Page tracking stays in ToProt&apos;s own database.</p>
      </Section>
    </>
  );
}

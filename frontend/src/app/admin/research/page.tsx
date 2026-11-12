import { Bars, Kpi, KpiGrid, LineChart, Notice, PageTitle, RangeFilter, Section } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/auth";
import { dateTime, num, NA } from "@/lib/admin/format";
import { iso, loadReport } from "@/lib/admin/load";
import { parseRange } from "@/lib/admin/range";

export const metadata = { title: "Research Activity" };
type Research = {
  tracking_since: string | null;
  counts: { projects_created: number; protocols_locked: number; sample_size_and_stat_calculations_saved: number; calculator_completions_tracked: number; references_saved: number; references_by_source: Record<string, number>; literature_searches_tracked: number; documents_generated: number; documents_by_type: Record<string, number>; manuscripts_created: number; pdfs_uploaded: number; assistant_messages: number; supervisor_review_requests: number; supervisor_invitations: number; supervisors_attached: number; active_supervisor_workspaces: number };
  top_tools: { tool_slug: string; name: string; saved: number }[]; top_tools_tracked: { tool: string | null; completions: number }[]; ai_features: { feature_key: string; requests: number }[];
  series: { day: string; projects: number; calculations: number; refs: number; documents: number }[];
};

export default async function ResearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireAdmin();
  const range = parseRange(await searchParams);
  const r = await loadReport<Research>(s, "admin_research", { p_from: iso(range.from), p_to: iso(range.to), p_tz: range.tz });
  const tracked = (v: number | undefined) => (r.data?.tracking_since ? num(v ?? 0) : NA);
  return (
    <>
      <PageTitle title="Research Activity" lead="Aggregate use of ToProt's research tools. These are counts and trends only; no research content is shown." />
      <RangeFilter range={range} base="/admin/research" />
      {r.error && <Notice tone="danger">{r.error}</Notice>}
      {r.data && (() => {
        const c = r.data.counts;
        return (
          <>
            <Section title="What people did" lead={`${range.label} (${range.tz}). Counts come from the records themselves, so they cover the whole period.`}>
              <KpiGrid>
                <Kpi label="Projects created" value={num(c.projects_created)} />
                <Kpi label="Protocols locked" value={num(c.protocols_locked)} note="A final version was registered" />
                <Kpi label="Calculations saved" value={num(c.sample_size_and_stat_calculations_saved)} note="Sample size and statistical tools, saved to a study" />
                <Kpi label="References saved" value={num(c.references_saved)} note={Object.entries(c.references_by_source).map(([k, v]) => `${v} ${k}`).join(", ") || undefined} />
                <Kpi label="Documents generated" value={num(c.documents_generated)} note={Object.entries(c.documents_by_type).map(([k, v]) => `${v} ${k}`).join(", ") || undefined} />
                <Kpi label="Manuscripts created" value={num(c.manuscripts_created)} />
                <Kpi label="PDFs uploaded" value={num(c.pdfs_uploaded)} />
                <Kpi label="Assistant messages" value={num(c.assistant_messages)} />
                <Kpi label="Supervisor review requests" value={num(c.supervisor_review_requests)} />
                <Kpi label="Supervisor invitations" value={num(c.supervisor_invitations)} note={`${num(c.supervisors_attached)} supervisors attached`} />
                <Kpi label="Calculator runs (tracked)" value={tracked(c.calculator_completions_tracked)} note="Includes free calculators that are not saved" />
                <Kpi label="Literature searches (tracked)" value={tracked(c.literature_searches_tracked)} />
              </KpiGrid>
              {!r.data.tracking_since && <Notice tone="warning" title="Tracked counts are not available yet">Calculator runs and literature searches are recorded by page tracking, which has not recorded anything yet. They are never estimated from other data.</Notice>}
              {r.data.tracking_since && <p className="type-caption mt-2">Tracked counts started on {dateTime(r.data.tracking_since, range.tz)} and are incomplete for earlier dates.</p>}
            </Section>
            <Section title="Trends"><LineChart title="Projects, calculations, references and documents by day" labels={r.data.series.map((x) => x.day.slice(5))} series={[{ name: "Projects", values: r.data.series.map((x) => Number(x.projects)), color: "primary" }, { name: "Calculations", values: r.data.series.map((x) => Number(x.calculations)), color: "teal" }, { name: "References", values: r.data.series.map((x) => Number(x.refs)), color: "navy" }]} /></Section>
            <div className="grid gap-8 lg:grid-cols-2">
              <Section title="Most used tools, saved calculations"><Bars rows={r.data.top_tools.map((t) => ({ label: t.name || t.tool_slug, value: Number(t.saved) }))} /></Section>
              <Section title="Most used tools, tracked runs"><Bars rows={r.data.top_tools_tracked.map((t) => ({ label: t.tool ?? "(unnamed)", value: Number(t.completions) }))} /></Section>
              <Section title="AI features used" lead="Completed requests."><Bars rows={r.data.ai_features.map((t) => ({ label: t.feature_key, value: Number(t.requests) }))} /></Section>
            </div>
          </>
        );
      })()}
    </>
  );
}

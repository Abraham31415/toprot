import { FeatureLimitsForm, SettingForm } from "@/components/admin/setting-forms";
import { Badge, Notice, PageTitle, Section, Table } from "@/components/admin/ui";
import { requireAdmin, mfaRequired } from "@/lib/admin/auth";
import { date } from "@/lib/admin/format";
import { EDITABLE } from "@/lib/admin/editable";

export const metadata = { title: "Settings" };

// Which integrations are configured, by name only. Values and keys are never read into the page.
const INTEGRATIONS: [string, string, boolean][] = [
  ["Supabase service key", "SUPABASE_SERVICE_ROLE_KEY", true], ["Anthropic API key (AI requests)", "ANTHROPIC_API_KEY", true],
  ["Anthropic Admin key (cost reconciliation)", "ANTHROPIC_ADMIN_API_KEY", false], ["Dodo Payments key", "DODO_PAYMENTS_API_KEY", false], ["Dodo webhook secret", "DODO_PAYMENTS_WEBHOOK_SECRET", false],
  ["Scheduled job secret", "CRON_SECRET", true], ["Email (Resend)", "RESEND_API_KEY", false], ["Alert recipient", "AI_ADMIN_ALERT_EMAIL", false],
  ["Vercel API token (deployments)", "VERCEL_API_TOKEN", false], ["Traffic salt", "ANALYTICS_SALT", true],
];

export default async function SettingsPage() {
  const s = await requireAdmin();
  const [ai, billing, features, admins] = await Promise.all([
    s.db.from("ai_settings").select("key, value_num"), s.db.from("billing_settings").select("key, value_num"),
    s.db.from("ai_features").select("feature_key, enabled, max_iterations, max_tool_calls, max_op_cost_micro_usd").order("feature_key"),
    s.db.from("app_admins").select("user_id, role, created_at, note"),
  ]);
  const value = (id: string): number | null => {
    const [scope, key] = id.split(".");
    const row = (scope === "ai" ? ai.data : billing.data)?.find((r) => r.key === key);
    return row ? Number(row.value_num) : null;
  };
  const shown = (id: keyof typeof EDITABLE) => { const v = value(id); return v === null ? "Not set" : (v / EDITABLE[id].scale).toLocaleString("en-GB", { maximumFractionDigits: 3 }); };
  const readOnly = s.role === "viewer";
  const emails = new Map<string, string>();
  for (const a of admins.data ?? []) { const { data } = await s.db.auth.admin.getUserById(a.user_id); emails.set(a.user_id, data.user?.email ?? "(unknown)"); }

  return (
    <>
      <PageTitle title="Settings" lead="Budgets, limits and cost figures. Every change needs a reason and is recorded in the audit log with the old and new value." />
      {readOnly && <Notice tone="setup">Your administrator role is read-only, so these settings cannot be changed.</Notice>}
      <Section title="AI budgets and limits" lead="Enforced by the application before a request starts, not only reported afterwards.">
        <div className="space-y-2">
          {(["ai.platform_daily_budget_micro_usd", "ai.platform_monthly_budget_micro_usd", "ai.max_concurrent_ops_per_user", "ai.max_ops_per_minute_per_user"] as const).map((id) => (
            <SettingForm key={id} id={id} label={EDITABLE[id].label} hint={EDITABLE[id].hint} current={shown(id)} disabled={readOnly} />
          ))}
        </div>
        <h3 className="mt-6 text-sm font-semibold text-ink">Per-feature limits</h3>
        <p className="type-support">The most iterations, tool calls and cost one operation may use. A feature switched off refuses new requests.</p>
        <div className="mt-2 space-y-2">
          {(features.data ?? []).map((f) => <FeatureLimitsForm key={f.feature_key} feature={f.feature_key} iterations={f.max_iterations} toolCalls={f.max_tool_calls} opCostUsd={Number(f.max_op_cost_micro_usd) / 1_000_000} enabled={f.enabled} disabled={readOnly} />)}
        </div>
        <p className="type-caption mt-3">Each person&apos;s own spending limit is their credit balance: a request is refused when the balance cannot cover its worst case.</p>
      </Section>
      <Section title="Cost figures" lead="Your own numbers, used only in estimates. They are shown as not available until you enter them.">
        <div className="space-y-2">
          {(["billing.payment_fee_pct", "billing.payment_fee_fixed_usd", "billing.monthly_infrastructure_cost_usd", "billing.storage_budget_bytes"] as const).map((id) => (
            <SettingForm key={id} id={id} label={EDITABLE[id].label} hint={EDITABLE[id].hint} current={shown(id)} disabled={readOnly} />
          ))}
        </div>
      </Section>
      <Section title="Administrator safeguards">
        <div className="space-y-2">
          {(["billing.admin_grant_max_credits", "billing.admin_grant_daily_max_credits", "billing.admin_sensitive_ops_per_hour"] as const).map((id) => (
            <SettingForm key={id} id={id} label={EDITABLE[id].label} hint={EDITABLE[id].hint} current={shown(id)} disabled={readOnly} />
          ))}
        </div>
      </Section>
      <Section title="Administrators" lead="Administrators are added only with SQL by the project owner, never through the website. See docs/ADMIN.md.">
        <Table caption="Administrators" head={["Email", "Role", "Added", "Note"]} rows={(admins.data ?? []).map((a) => [emails.get(a.user_id) ?? "-", <Badge key="r" tone={a.role === "owner" ? "info" : "neutral"}>{a.role}</Badge>, date(a.created_at), a.note ?? "-"])} />
        <p className="type-caption mt-2">Two-step verification for administrators is {mfaRequired() ? "required" : "OFF (ADMIN_MFA_REQUIRED=false)"}.</p>
      </Section>
      <Section title="Integrations" lead="Whether each is configured on the server. Values are never shown.">
        <Table caption="Integrations" head={["Integration", "Variable", "Status", "Needed for"]} rows={INTEGRATIONS.map(([label, env, required]) => [label, <code key="c" className="text-xs">{env}</code>, process.env[env]?.trim() ? <Badge key="s" tone="success">Set</Badge> : <Badge key="s" tone={required ? "danger" : "neutral"}>Not set</Badge>, required ? "Core features" : "Optional"])} />
      </Section>
    </>
  );
}

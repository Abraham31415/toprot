// The settings an administrator may change from the console, with their units. Values are stored in the unit the database uses
// (for example micro-USD) and shown in the unit people think in (USD), so each has a scale.

export const EDITABLE = {
  "ai.platform_daily_budget_micro_usd": { label: "Daily AI budget (USD)", scale: 1_000_000, min: 0, hint: "The most the platform may spend on AI per UTC day. New requests are refused once it is reached." },
  "ai.platform_monthly_budget_micro_usd": { label: "Monthly AI budget (USD)", scale: 1_000_000, min: 0, hint: "The most per UTC month. 0 turns the monthly ceiling off." },
  "ai.max_concurrent_ops_per_user": { label: "AI requests running at once, per user", scale: 1, min: 1, hint: "Stops one person flooding the AI service." },
  "ai.max_ops_per_minute_per_user": { label: "AI requests per minute, per user", scale: 1, min: 1, hint: "" },
  "billing.payment_fee_pct": { label: "Estimated payment fee (percent)", scale: 1, min: 0, hint: "Used only for margin estimates. Check your merchant agreement." },
  "billing.payment_fee_fixed_usd": { label: "Estimated fixed fee per payment (USD)", scale: 1, min: 0, hint: "Used only for margin estimates." },
  "billing.monthly_infrastructure_cost_usd": { label: "Hosting and infrastructure per month (USD)", scale: 1, min: 0, hint: "Your own figure for Vercel, Supabase and other services. Included in contribution estimates once set." },
  "billing.storage_budget_bytes": { label: "Storage budget (MB)", scale: 1_048_576, min: 0, hint: "Your plan's file storage limit. An alert is raised at 80 percent of uploaded PDFs." },
  "billing.admin_grant_max_credits": { label: "Largest promotional grant (credits)", scale: 1, min: 1, hint: "" },
  "billing.admin_grant_daily_max_credits": { label: "Promotional credits per administrator per day", scale: 1, min: 1, hint: "" },
  "billing.admin_sensitive_ops_per_hour": { label: "Account and credit changes per administrator per hour", scale: 1, min: 1, hint: "" },
} as const;
export type EditableKey = keyof typeof EDITABLE;


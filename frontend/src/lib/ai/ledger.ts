import type { AiConfig, AiErrorCode, RpcClient, UsageReport } from "./types";

// Thin typed wrappers over the SECURITY DEFINER functions in
// supabase/migrations/20261109120000_ai_usage_credits.sql. All accounting logic lives in
// Postgres so it is atomic; this file only marshals arguments. Requires a service-role client.

export interface ReserveOk {
  ok: true;
  eventId: string;
  periodId: string;
  plan: "pro" | "intro";
  reservedMcr: number;
}
export interface ReserveFail {
  ok: false;
  code: AiErrorCode;
  eventId?: string;
}

export interface CommitResult {
  chargedMcr: number;
  costMicroUsd: number;
  duplicate: boolean;
}

export interface Headroom {
  plan: "pro" | "intro";
  periodStart: string | null;
  periodEnd: string | null;
  allowanceMcr: number;
  usedMcr: number;
  reservedMcr: number;
  availableMcr: number;
  platformRemainingMicroUsd: number;
  creditValueMicroUsd: number;
}

async function call(db: RpcClient, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return (data ?? {}) as Record<string, unknown>;
}

export async function loadConfig(db: RpcClient, feature: string): Promise<AiConfig | null> {
  const { data, error } = await db.rpc("ai_load_config", { p_feature: feature });
  if (error || !data) return null;
  const cfg = data as AiConfig;
  if (!cfg.feature || !Array.isArray(cfg.models)) return null;
  return cfg;
}

export async function reserve(
  db: RpcClient,
  args: { userId: string; key: string; feature: string; model: string; reserveMicroUsd: number; meta?: Record<string, unknown> },
): Promise<ReserveOk | ReserveFail> {
  const r = await call(db, "ai_reserve", {
    p_user: args.userId,
    p_key: args.key,
    p_feature: args.feature,
    p_model: args.model,
    p_reserve_micro_usd: args.reserveMicroUsd,
    p_meta: args.meta ?? {},
  });
  if (r.ok === true) {
    return {
      ok: true,
      eventId: r.event_id as string,
      periodId: r.period_id as string,
      plan: r.plan as "pro" | "intro",
      reservedMcr: Number(r.reserved_mcr),
    };
  }
  return { ok: false, code: (r.code as AiErrorCode) ?? "internal", eventId: r.event_id as string | undefined };
}

export async function commit(
  db: RpcClient,
  eventId: string,
  usage: UsageReport,
  opts: { errorCode?: string; platformExposureMicroUsd?: number; usageKnown?: boolean } = {},
): Promise<CommitResult> {
  const r = await call(db, "ai_commit", {
    p_event: eventId,
    p_input: usage.input,
    p_output: usage.output,
    p_cache_read: usage.cacheRead,
    p_cache_write_5m: usage.cacheWrite5m,
    p_cache_write_1h: usage.cacheWrite1h,
    p_tool_usage: usage.toolUsage,
    p_iterations: usage.iterations,
    p_error_code: opts.errorCode ?? null,
    p_platform_exposure_micro_usd: opts.platformExposureMicroUsd ?? 0,
    p_usage_known: opts.usageKnown ?? true,
  });
  if (r.ok !== true) throw new Error(`ai_commit rejected: ${String(r.code)}`);
  return {
    chargedMcr: Number(r.charged_mcr),
    costMicroUsd: Number(r.cost_micro_usd),
    duplicate: r.duplicate === true,
  };
}

export async function release(
  db: RpcClient,
  eventId: string,
  opts: { errorCode?: string; platformExposureMicroUsd?: number; usageKnown?: boolean } = {},
): Promise<void> {
  const r = await call(db, "ai_release", {
    p_event: eventId,
    p_error_code: opts.errorCode ?? null,
    p_platform_exposure_micro_usd: opts.platformExposureMicroUsd ?? 0,
    p_usage_known: opts.usageKnown ?? true,
  });
  if (r.ok !== true) throw new Error(`ai_release rejected: ${String(r.code)}`);
}

export async function getHeadroom(db: RpcClient, userId: string): Promise<Headroom> {
  const r = await call(db, "ai_get_headroom", { p_user: userId });
  return {
    plan: r.plan as "pro" | "intro",
    periodStart: (r.period_start as string | null) ?? null,
    periodEnd: (r.period_end as string | null) ?? null,
    allowanceMcr: Number(r.allowance_mcr),
    usedMcr: Number(r.used_mcr),
    reservedMcr: Number(r.reserved_mcr),
    availableMcr: Number(r.available_mcr),
    platformRemainingMicroUsd: Number(r.platform_remaining_micro_usd),
    creditValueMicroUsd: Number(r.credit_value_micro_usd),
  };
}

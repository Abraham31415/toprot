import { dispatchPendingAlerts, type AlertSender } from "./alerts";
import { costMicroUsd } from "./cost";
import { monthlyBudgetExceeded } from "./monthly";
import * as ledger from "./ledger";
import { BudgetGuard } from "./limits";
import { routeCandidates } from "./route";
import {
  AiCallFailure,
  USER_MESSAGES,
  type AiErrorCode,
  type AiOutcome,
  type ModelPrice,
  type RpcClient,
  type UsageReport,
} from "./types";
import { detectInjectionAttempt } from "./untrusted";

export interface CallContext {
  model: string;
  maxOutputTokens: number;
  signal: AbortSignal;
  guard: BudgetGuard;
}

export interface CallOutcome<T> {
  value: T;
  usage: UsageReport;
}

export interface RunOptions<T> {
  db: RpcClient;
  userId: string;
  feature: string;
  /** Client-generated unique id for this user action. Retrying with the same key never double-charges. */
  idempotencyKey: string;
  /** Total characters (system prompt + user content) that will be sent. Used to size the reservation. */
  inputChars: number;
  /** Raw user-supplied text, scanned for injection attempts. Logged only; never gates the request. */
  untrustedText?: string;
  timeoutMs?: number;
  /** The provider call. Must report real usage; throw AiCallFailure to describe failures. */
  call: (ctx: CallContext) => Promise<CallOutcome<T>>;
  alertSender?: AlertSender;
  /** Backoff for settling retries; tests set this to 0. */
  settleRetryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 90_000;

function fail<T>(code: AiErrorCode, eventId?: string): AiOutcome<T> {
  return { ok: false, code, message: USER_MESSAGES[code], eventId };
}

function log(evt: string, data: Record<string, unknown>): void {
  console.error(JSON.stringify({ evt, ...data }));
}

async function withRetries<R>(fn: () => Promise<R>, attempts: number, delayMs: number): Promise<R> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}

/**
 * Runs one metered AI operation:
 *   1. load limits and prices from the database (fail closed if unavailable)
 *   2. reject oversize input, route to the cheapest acceptable model chain
 *   3. atomically reserve credits (and platform budget) BEFORE calling the provider
 *   4. run the call under a hard timeout and cost guard
 *   5. settle against the provider's ACTUAL reported usage (retrying the settle if needed)
 * Credits are only ever changed by Postgres functions that this server calls with the
 * service role; nothing the client or the model says can alter a balance.
 */
export async function runAiOperation<T>(opts: RunOptions<T>): Promise<AiOutcome<T>> {
  const { db, userId, feature, idempotencyKey } = opts;
  const retryDelay = opts.settleRetryDelayMs ?? 250;

  if (!userId) return fail("unauthenticated");

  let config;
  try {
    config = await ledger.loadConfig(db, feature);
  } catch {
    config = null;
  }
  if (!config) return fail("unavailable");
  if (!config.feature.enabled) return fail("feature_disabled");
  if (!Number.isFinite(opts.inputChars) || opts.inputChars <= 0) return fail("invalid_request");
  if (opts.inputChars > config.feature.max_input_chars) return fail("input_too_large");

  const candidates = routeCandidates(config, opts.inputChars);
  if (candidates.length === 0) return fail("op_cost_too_high");

  if (opts.untrustedText) {
    const hits = detectInjectionAttempt(opts.untrustedText);
    if (hits.length) log("ai_injection_suspected", { userId, feature, patterns: hits.length });
  }

  // The platform's monthly ceiling (see monthly.ts). Nothing has been reserved or charged at this point.
  if (await monthlyBudgetExceeded(db)) return fail("platform_monthly_budget_exceeded");

  // Reserve: try the preferred model first, fall back to cheaper ones if the user's remaining
  // credits or the platform's remaining budget cannot cover the worst case.
  let reserved: ledger.ReserveOk | null = null;
  let chosen: { model: ModelPrice; worstCaseMicroUsd: number } | null = null;
  let lastFail: ledger.ReserveFail | null = null;
  for (const c of candidates) {
    let r: ledger.ReserveOk | ledger.ReserveFail;
    try {
      r = await ledger.reserve(db, {
        userId,
        key: idempotencyKey,
        feature,
        model: c.model.model_id,
        reserveMicroUsd: c.worstCaseMicroUsd,
      });
    } catch (e) {
      log("ai_reserve_error", { userId, feature, err: String(e) });
      return fail("unavailable");
    }
    if (r.ok) {
      reserved = r;
      chosen = c;
      break;
    }
    lastFail = r;
    if (r.code !== "insufficient_credits" && r.code !== "platform_budget_exceeded") break;
  }
  if (!reserved || !chosen) return fail(lastFail?.code ?? "internal", lastFail?.eventId);

  const eventId = reserved.eventId;
  const guard = new BudgetGuard(config.feature, chosen.model, chosen.worstCaseMicroUsd);
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settle = async <R,>(fn: () => Promise<R>, what: string): Promise<R | null> => {
    try {
      return await withRetries(fn, 3, retryDelay);
    } catch (e) {
      // The reservation lease will expire and free the held credits. Usage that could not be
      // recorded is logged so it can be reconciled by hand.
      log("ai_settle_failed", { what, eventId, userId, err: String(e) });
      return null;
    }
  };

  let outcome: CallOutcome<T>;
  let timedOut = false;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Flag first: aborting makes the provider call reject too, and whichever rejection
        // wins the race must still be classified as a timeout.
        timedOut = true;
        reject(new AiCallFailure("timed out", "timeout"));
        controller.abort();
      }, timeoutMs);
    });
    outcome = await Promise.race([
      opts.call({ model: chosen.model.model_id, maxOutputTokens: config.feature.max_output_tokens, signal: controller.signal, guard }),
      timeout,
    ]);
  } catch (err) {
    if (timer) clearTimeout(timer);
    controller.abort();
    const kind = timedOut ? "timeout" : err instanceof AiCallFailure ? err.kind : "provider_error";
    const usage = err instanceof AiCallFailure ? err.usage : undefined;

    if (kind === "timeout") {
      // Outcome unknown: the user is not charged, but the platform may have been, so the
      // worst case counts against today's platform budget.
      await settle(
        () => ledger.release(db, eventId, { errorCode: "timeout", platformExposureMicroUsd: chosen.worstCaseMicroUsd, usageKnown: false }),
        "release_timeout",
      );
      return fail("timeout", eventId);
    }
    if (kind === "stream_interrupted") {
      // Charge only what is known (input tokens); the unknown output is platform exposure.
      const known = usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, toolUsage: {}, iterations: 1 };
      const exposure = Math.max(chosen.worstCaseMicroUsd - costMicroUsd(chosen.model, { ...known, output: 0 }), 0);
      await settle(
        () => ledger.commit(db, eventId, { ...known, output: 0 }, { errorCode: "stream_interrupted", platformExposureMicroUsd: exposure, usageKnown: false }),
        "commit_interrupted",
      );
      return fail("stream_interrupted", eventId);
    }
    if (kind === "invalid_output" && usage) {
      // The provider did the work and reported usage, so that real usage is recorded.
      await settle(() => ledger.commit(db, eventId, usage, { errorCode: "invalid_output" }), "commit_invalid_output");
      return fail("invalid_output", eventId);
    }
    // Provider error before any generation: nothing used, nothing charged.
    await settle(() => ledger.release(db, eventId, { errorCode: "provider_error" }), "release_provider_error");
    return fail("provider_error", eventId);
  }
  if (timer) clearTimeout(timer);

  // Success: charge actual usage. The reservation is only a hold; the charge is computed in
  // Postgres from these token counts and may be lower (refunded difference) or higher
  // (recorded as overrun) than the reservation.
  const committed = await settle(() => ledger.commit(db, eventId, outcome.usage), "commit");

  void dispatchPendingAlerts(db, opts.alertSender);

  return {
    ok: true,
    value: outcome.value,
    model: chosen.model.model_id,
    chargedCredits: committed ? committed.chargedMcr / 1000 : 0,
    eventId,
  };
}

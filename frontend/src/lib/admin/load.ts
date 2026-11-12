import type { AdminSession } from "./auth";
import { adminErrorMessage } from "./format";

export type Loaded<T> = { data: T; error: null } | { data: null; error: string; setup: boolean };

/**
 * Calls an admin report. When the report functions are not installed yet (the admin migration has not been applied to this
 * database) the page shows a setup message instead of failing, so an unfinished setup is obvious and nothing is guessed.
 */
export async function loadReport<T>(s: AdminSession, fn: string, args: Record<string, unknown> = {}): Promise<Loaded<T>> {
  const { data, error } = await s.db.rpc(fn, { p_actor: s.userId, ...args });
  if (!error) return { data: data as T, error: null };
  const setup = error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message);
  if (!setup) console.error(JSON.stringify({ evt: "admin_report_failed", fn, code: error.code, msg: String(error.message).slice(0, 160) }));
  return { data: null, error: setup ? "The admin reporting functions are not installed in this database. Apply the migration 20261119090000_admin_console.sql, then reload." : adminErrorMessage(error.message), setup };
}

export const iso = (d: Date) => d.toISOString();

/** Runs something and says how long it took, in milliseconds. Kept out of the page so the page itself stays a pure function of its data. */
export async function timed<T>(fn: () => PromiseLike<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
}

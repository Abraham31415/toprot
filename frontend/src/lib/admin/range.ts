// Date ranges for the admin console. Every report states its range and timezone, and the range is parsed here, in one place,
// so "today", "last 7 days" and a custom range mean the same thing on every page.

export type RangeKey = "today" | "7d" | "30d" | "90d" | "custom";
export const RANGE_KEYS: RangeKey[] = ["today", "7d", "30d", "90d", "custom"];
export const RANGE_LABEL: Record<RangeKey, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", custom: "Custom range" };
const MAX_DAYS = 400;

export type DateRange = { key: RangeKey; from: Date; to: Date; tz: string; label: string; fromDay: string; toDay: string; error?: string };

export const isValidTimeZone = (tz: string): boolean => {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
};

/** The timezone reports use. Set ADMIN_TIMEZONE to an IANA name such as Africa/Kampala; the default is UTC, which is also what AI budgets use. */
export const adminTimeZone = (): string => {
  const tz = process.env.ADMIN_TIMEZONE?.trim();
  return tz && isValidTimeZone(tz) ? tz : "UTC";
};

/** Offset of a timezone from UTC at an instant, in minutes. */
function offsetMinutes(at: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(at).reduce<Record<string, number>>((o, x) => { if (x.type !== "literal") o[x.type] = Number(x.value); return o; }, {});
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000) / 60000;
}

/** The instant at which a calendar day (YYYY-MM-DD) begins in a timezone. */
export function startOfDay(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  t = guess - offsetMinutes(new Date(t), tz) * 60000; // second pass for days that cross a daylight saving change
  return new Date(t);
}

/** The calendar day (YYYY-MM-DD) an instant falls on in a timezone. */
export const dayOf = (at: Date, tz: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

const addDays = (ymd: string, n: number): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const VALID_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns the address parameters (?range=30d, or ?range=custom&from=2026-11-01&to=2026-11-12) into a range. The end is exclusive:
 * "to" is the start of the day after the last day shown. An invalid custom range falls back to the last 30 days and says so.
 */
export function parseRange(params: { range?: string; from?: string; to?: string }, tz: string = adminTimeZone(), now: Date = new Date()): DateRange {
  const today = dayOf(now, tz);
  const key = (RANGE_KEYS as string[]).includes(params.range ?? "") ? (params.range as RangeKey) : "30d";
  const make = (k: RangeKey, firstDay: string, lastDay: string, error?: string): DateRange => ({
    key: k, tz, from: startOfDay(firstDay, tz), to: startOfDay(addDays(lastDay, 1), tz), fromDay: firstDay, toDay: lastDay,
    label: firstDay === lastDay ? `${firstDay}` : `${firstDay} to ${lastDay}`, error,
  });
  if (key === "today") return make("today", today, today);
  if (key === "7d") return make("7d", addDays(today, -6), today);
  if (key === "30d") return make("30d", addDays(today, -29), today);
  if (key === "90d") return make("90d", addDays(today, -89), today);
  const { from, to } = params;
  const okDays = !!from && !!to && VALID_DAY.test(from) && VALID_DAY.test(to);
  if (!okDays) return make("30d", addDays(today, -29), today, "Enter both dates as YYYY-MM-DD. Showing the last 30 days.");
  if (from! > to!) return make("30d", addDays(today, -29), today, "The start date is after the end date. Showing the last 30 days.");
  if (to! > today) return make("custom", from!, today, "The end date was in the future, so it was set to today.");
  const span = (Date.parse(to!) - Date.parse(from!)) / 86400000 + 1;
  if (span > MAX_DAYS) return make("30d", addDays(today, -29), today, `A range can cover at most ${MAX_DAYS} days. Showing the last 30 days.`);
  return make("custom", from!, to!);
}
